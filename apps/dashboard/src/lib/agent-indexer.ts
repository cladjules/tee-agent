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
  setCachedProofs,
  addPendingValidation,
  getPendingValidationsForAgent,
  removePendingValidation,
} from "@/lib/agent-cache";
import {
  makePublicClient,
  makeAgentRegistryClient,
  toAgentConfig,
  type PublicClient,
} from "@/lib/registry-client";
import { resolveAgentProofData } from "@tee-agent/agent/resolve";
import { ValidationRegistry } from "@tee-agent/agent/registry";
import { cfg } from "@/lib/config";
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
      validationsSkipped: number;
    }
  | { ok: false; skipped: true; reason: string };

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Pre-populate the proof cache for a batch of newly resolved agents (best-effort). */
async function populateProofCache(agents: RegisteredAgent[]): Promise<void> {
  if (agents.length === 0) return;
  const agentConfig = toAgentConfig();
  await Promise.allSettled(
    agents.map(async (agent) => {
      const data = await resolveAgentProofData(agentConfig, agent.agentId);
      await setCachedProofs(agent.agentId, data);
    }),
  );
}

/**
/**
 * Sync ValidationRequest / ValidationResponse events for a block range:
 *   - Phase 1: scan ValidationResponse events → remove resolved pending jobs.
 *   - Phase 2: scan ValidationRequest events → queue new pending validations.
 *
 * Returns { processed, skipped } counts.
 */
async function syncValidations(
  fromBlock: bigint,
  latestBlock: bigint,
  publicClient: PublicClient,
  validationAddress: `0x${string}`,
  PAGE: bigint,
): Promise<{ processed: number; skipped: number }> {
  let processed = 0;
  let skipped = 0;

  type ResponseLog = {
    args: { agentId: bigint; requestHash: `0x${string}` };
  };
  type RequestLog = {
    args: {
      validatorAddress: `0x${string}`;
      agentId: bigint;
      requestURI: string;
      requestHash: `0x${string}`;
    };
  };

  const responseLogs: ResponseLog[] = [];
  const requestLogs: RequestLog[] = [];

  for (let from = fromBlock; from <= latestBlock; from += PAGE) {
    const to = from + PAGE - 1n < latestBlock ? from + PAGE - 1n : latestBlock;
    const [resChunk, reqChunk] = await Promise.all([
      publicClient.getLogs({
        address: validationAddress,
        event: VALIDATION_RESPONSE_EVENT,
        fromBlock: from,
        toBlock: to,
      }),
      publicClient.getLogs({
        address: validationAddress,
        event: VALIDATION_REQUEST_EVENT,
        fromBlock: from,
        toBlock: to,
      }),
    ]);
    responseLogs.push(...(resChunk as unknown as ResponseLog[]));
    requestLogs.push(...(reqChunk as unknown as RequestLog[]));
  }

  // Phase 1: remove pending jobs that now have an on-chain response.
  for (const log of responseLogs) {
    const { agentId, requestHash } = log.args;
    await removePendingValidation(agentId.toString(), requestHash);
    skipped++;
  }

  // Phase 2: queue new ValidationRequest events not yet in Redis.
  for (const log of requestLogs) {
    const { agentId, requestHash, requestURI, validatorAddress } = log.args;

    const agentJobs = await getPendingValidationsForAgent(agentId.toString());
    if (agentJobs.some((j) => j.requestHash === requestHash)) continue;

    // Skip requests that already received a response before this scan window.
    try {
      const validationRegistry = new ValidationRegistry({
        address: validationAddress,
        publicClient: publicClient as any,
      });
      const { lastUpdate } =
        await validationRegistry.getValidationStatus(requestHash);
      if (lastUpdate > 0n) {
        skipped++;
        continue;
      }
    } catch {
      // Request exists but no response yet — proceed.
    }

    await addPendingValidation({
      requestHash,
      requestURI,
      agentId: agentId.toString(),
      validatorAddress,
      queuedAt: Math.floor(Date.now() / 1000),
      attempts: 0,
    });
    processed++;
  }

  return { processed, skipped };
}

// ─── Main export ─────────────────────────────────────────────────────────────

/** Scan new blocks since the last cached block, update the agent cache, and sync pending validations. */
export async function syncEvents(): Promise<IndexResult> {
  if (!cfg.registryAddress) {
    return { ok: false, skipped: true, reason: "no registry address" };
  }

  const publicClient = makePublicClient();
  const registry = makeAgentRegistryClient();
  if (!publicClient || !registry) {
    return { ok: false, skipped: true, reason: "no rpc/registry" };
  }

  const cached = await getCachedAgents();
  const existingAgents = cached?.agents ?? [];
  const fromBlock = cached ? cached.lastBlock + 1n : cfg.registryFromBlock;
  const latestBlock = await publicClient.getBlockNumber();

  if (fromBlock > latestBlock) {
    return {
      ok: true,
      newAgents: 0,
      totalAgents: existingAgents.length,
      scannedFrom: fromBlock.toString(),
      latestBlock: latestBlock.toString(),
      validationsProcessed: 0,
      validationsSkipped: 0,
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

  await populateProofCache(newAgents);

  const { processed: validationsProcessed, skipped: validationsSkipped } =
    cfg.validationAddress
      ? await syncValidations(
          fromBlock,
          latestBlock,
          publicClient,
          cfg.validationAddress,
          PAGE,
        )
      : { processed: 0, skipped: 0 };

  // Advance lastBlock only after all processing for this range is complete.
  await setCachedAgents(merged, latestBlock);

  return {
    ok: true,
    newAgents: newAgents.length,
    totalAgents: merged.length,
    scannedFrom: fromBlock.toString(),
    latestBlock: latestBlock.toString(),
    validationsProcessed,
    validationsSkipped,
  };
}
