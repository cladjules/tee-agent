/**
 * Core agent indexer — scans new Registered events, resolves agent identities,
 * and persists the result to the Redis cache.
 *
 * Called by:
 *   - getRegisteredAgents()  (on-demand, skips scan if cache is fresh)
 *   - /api/cron/sync-events  (Vercel Cron, production)
 *   - instrumentation.ts  (setInterval, development)
 */

import {
  getCachedAgents,
  setCachedAgents,
  getCachedValidations,
  setCachedValidations,
  type CachedValidation,
} from "@/lib/agent-cache";
import { AgentRegistry } from "@tee-agent/agent/registry";
import { createPublicClient, http, type PublicClient } from "viem";
import { cfg, registryFromBlock } from "@/lib/config";
import {
  REGISTERED_EVENT,
  VALIDATION_REQUEST_EVENT,
  VALIDATION_RESPONSE_EVENT,
} from "@tee-agent/agent/abis";
import type { RegisteredAgent } from "@tee-agent/agent/types";

type IndexResult =
  | {
      ok: true;
      newAgents: number;
      totalAgents: number;
      scannedFrom: string;
      latestBlock: string;
      validationsProcessed: number;
      validationsUpdated: number;
    }
  | { ok: false; skipped: true; reason: string };

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Incrementally sync ValidationRequest / ValidationResponse events
 * for the given block range only.
 *
 * Loads each affected agent's existing pending set from Redis, applies
 * the delta (add new requests, remove newly-responded ones), and writes back.
 *
 * Returns { added, updated } = number of *newly added* and *updated* pending requests this run.
 */
async function syncValidations(
  fromBlock: bigint,
  latestBlock: bigint,
  publicClient: PublicClient,
  validationRegistryAddress: `0x${string}`,
  PAGE: bigint,
): Promise<{ added: number; updated: number }> {
  type RequestLog = {
    args: {
      validatorAddress: `0x${string}`;
      agentId: bigint;
      requestURI: string;
      requestHash: `0x${string}`;
    };
  };
  type ResponseLog = {
    args: {
      validatorAddress: `0x${string}`;
      agentId: bigint;
      requestHash: `0x${string}`;
      response: number;
      responseURI: string;
      responseHash: `0x${string}`;
      tag: string;
    };
    transactionHash?: `0x${string}`;
  };

  const newRequestLogs: RequestLog[] = [];
  const newResponseLogs: ResponseLog[] = [];

  // Scan only new blocks since last run.
  for (let from = fromBlock; from <= latestBlock; from += PAGE) {
    const to = from + PAGE - 1n < latestBlock ? from + PAGE - 1n : latestBlock;
    const [reqChunk, resChunk] = await Promise.all([
      publicClient.getLogs({
        address: validationRegistryAddress,
        event: VALIDATION_REQUEST_EVENT,
        fromBlock: from,
        toBlock: to,
      }),
      publicClient.getLogs({
        address: validationRegistryAddress,
        event: VALIDATION_RESPONSE_EVENT,
        fromBlock: from,
        toBlock: to,
      }),
    ]);
    newRequestLogs.push(...(reqChunk as RequestLog[]));
    newResponseLogs.push(...(resChunk as ResponseLog[]));
  }

  if (!newRequestLogs.length && !newResponseLogs.length)
    return { added: 0, updated: 0 };

  // Collect all affected agentIds.
  const affectedIds = new Set<bigint>([
    ...newRequestLogs.map((l) => l.args.agentId),
    ...newResponseLogs.map((l) => l.args.agentId),
  ]);

  let addedCount = 0;
  let updatedCount = 0;

  await Promise.all(
    [...affectedIds].map(async (agentId) => {
      // Load existing pending set for this agent.
      const existing = await getCachedValidations(agentId);
      const pendingMap = new Map<string, CachedValidation>(
        existing.map((r) => [r.requestHash.toLowerCase(), r]),
      );

      // Mark responded entries with their score (keep in map; don't delete).
      for (const res of newResponseLogs) {
        if (res.args.agentId === agentId) {
          const hash = res.args.requestHash.toLowerCase();
          const original = pendingMap.get(hash);

          console.log("UP", original, res.args.response, res.transactionHash);

          // Only update if we have the original request in Redis.
          if (!original) continue;

          pendingMap.set(hash, {
            ...original,
            response: {
              score: res.args.response,
              txHash: res.transactionHash,
              timestamp: Math.floor(Date.now() / 1000),
            },
          } satisfies CachedValidation);

          updatedCount++;
        }
      }

      // Add new requests (skip if already present).
      for (const req of newRequestLogs) {
        if (req.args.agentId !== agentId) continue;
        const hash = req.args.requestHash.toLowerCase();
        if (!pendingMap.has(hash)) {
          pendingMap.set(hash, {
            requestHash: req.args.requestHash,
            requestURI: req.args.requestURI,
            agentId: agentId.toString(),
            validatorAddress: req.args.validatorAddress,
          } satisfies CachedValidation);
          addedCount++;
        }
      }

      await setCachedValidations(agentId, [
        ...pendingMap.values(),
      ] as CachedValidation[]);
    }),
  );

  return { added: addedCount, updated: updatedCount };
}

// ─── Main export ─────────────────────────────────────────────────────────────

/** Scan new blocks since the last cached block, update the agent cache, and sync pending validations. */
export async function syncEvents(): Promise<IndexResult> {
  if (!cfg.registryAddress) {
    return { ok: false, skipped: true, reason: "no registry address" };
  }

  if (!cfg.rpcUrl)
    return { ok: false, skipped: true, reason: "no rpc/registry" };
  const publicClient = createPublicClient({
    chain: cfg.chain,
    transport: http(cfg.rpcUrl),
  });
  const registry = new AgentRegistry({
    address: cfg.registryAddress,
    publicClient,
  });
  if (!publicClient || !registry) {
    return { ok: false, skipped: true, reason: "no rpc/registry" };
  }

  const cached = await getCachedAgents();
  const existingAgents = cached?.agents ?? [];
  const fromBlock = cached ? cached.lastBlock + 1n : registryFromBlock;
  const latestBlock = await publicClient.getBlockNumber();

  if (fromBlock > latestBlock) {
    return {
      ok: true,
      newAgents: 0,
      totalAgents: existingAgents.length,
      scannedFrom: fromBlock.toString(),
      latestBlock: latestBlock.toString(),
      validationsProcessed: 0,
      validationsUpdated: 0,
    };
  }

  // Paginate in 2000-block chunks (Base Sepolia public RPC limit).
  const PAGE = 2000n;

  // Scan Registered events.
  const allLogs: any[] = [];
  for (let from = fromBlock; from <= latestBlock; from += PAGE) {
    const to = from + PAGE - 1n < latestBlock ? from + PAGE - 1n : latestBlock;
    const chunk = await publicClient.getLogs({
      address: cfg.registryAddress,
      event: REGISTERED_EVENT,
      fromBlock: from,
      toBlock: to,
    });
    allLogs.push(...chunk);
  }

  const newAgents: RegisteredAgent[] = [];
  if (allLogs.length > 0) {
    const settled = await Promise.allSettled(
      allLogs.map((log) => registry.resolve(log.args.agentId as bigint)),
    );
    settled.forEach((r, i) => {
      if (r.status === "rejected")
        console.error(
          `[indexer] resolve agentId=${allLogs[i]?.args.agentId} failed:`,
          r.reason,
        );
      else newAgents.push(r.value);
    });
  }

  const merged = [...existingAgents, ...newAgents];

  const { added: validationsAdded, updated: validationsUpdated } =
    cfg.validationRegistryAddress
      ? await syncValidations(
          fromBlock,
          latestBlock,
          publicClient,
          cfg.validationRegistryAddress,
          PAGE,
        )
      : { added: 0, updated: 0 };

  // Advance lastBlock only after all processing for this range is complete.
  await setCachedAgents(merged, latestBlock);

  return {
    ok: true,
    newAgents: newAgents.length,
    totalAgents: merged.length,
    scannedFrom: fromBlock.toString(),
    latestBlock: latestBlock.toString(),
    validationsProcessed: validationsAdded,
    validationsUpdated: validationsUpdated,
  };
}
