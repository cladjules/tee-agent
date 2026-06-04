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
  addCachedValidationResponses,
  getCachedAgents,
  type IndexedValidationResponse,
  setCachedAgents,
} from "@/lib/agent-cache";
import { AgentRegistry } from "@tee-agent/agent/registry";
import { createPublicClient, http, type PublicClient } from "viem";
import { getServerConfigForChain } from "@/lib/config";
import {
  REGISTERED_EVENT,
  VALIDATION_REQUEST_EVENT,
  VALIDATION_RESPONSE_EVENT,
} from "@tee-agent/agent/abis";
import type { RegisteredAgent } from "@tee-agent/agent/types";
import {
  resolveOwnedValidationOracleUrl,
  submitOracleValidation,
} from "@/lib/oracle-validation";

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

type ValidationRequestLog = {
  args: {
    validatorAddress: `0x${string}`;
    agentId: bigint;
    requestURI: string;
    requestHash: `0x${string}`;
  };
};

type ValidationResponseLog = {
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

type ValidationLogs = {
  requests: ValidationRequestLog[];
  responses: ValidationResponseLog[];
};

type UnansweredValidationRequest = {
  agentId: bigint;
  validatorAddress: `0x${string}`;
  requestURI: string;
  requestHash: `0x${string}`;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function decodeJsonDataUri(uri: string): Record<string, unknown> | undefined {
  const prefix = "data:application/json;base64,";
  if (!uri.startsWith(prefix)) return undefined;

  try {
    const parsed = JSON.parse(
      Buffer.from(uri.slice(prefix.length), "base64").toString("utf8"),
    ) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function validationKey(agentId: bigint, requestHash: string): string {
  return `${agentId.toString()}:${requestHash.toLowerCase()}`;
}

async function collectValidationLogs(
  publicClient: PublicClient,
  validationRegistryAddress: `0x${string}`,
  fromBlock: bigint,
  latestBlock: bigint,
  pageSize: bigint,
): Promise<ValidationLogs> {
  const requests: ValidationRequestLog[] = [];
  const responses: ValidationResponseLog[] = [];

  for (let from = fromBlock; from <= latestBlock; from += pageSize) {
    const to =
      from + pageSize - 1n < latestBlock ? from + pageSize - 1n : latestBlock;
    const [requestChunk, responseChunk] = await Promise.all([
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
    requests.push(...(requestChunk as ValidationRequestLog[]));
    responses.push(...(responseChunk as ValidationResponseLog[]));
  }

  return { requests, responses };
}

function validationResponsesFromLogs(
  responses: ValidationResponseLog[],
): IndexedValidationResponse[] {
  return responses.map((res) => {
    const evidence = decodeJsonDataUri(res.args.responseURI);
    return {
      requestHash: res.args.requestHash,
      agentId: res.args.agentId.toString(),
      validatorAddress: res.args.validatorAddress,
      score: res.args.response,
      txHash: res.transactionHash,
      timestamp: Math.floor(Date.now() / 1000),
      responseURI: res.args.responseURI,
      responseHash: res.args.responseHash,
      tag: res.args.tag,
      reasoning:
        typeof evidence?.reasoning === "string"
          ? evidence.reasoning
          : undefined,
      evidence,
    };
  });
}

function unansweredValidationRequestsFromLogs({
  requests,
  responses,
}: ValidationLogs): UnansweredValidationRequest[] {
  const responseKeys = new Set(
    responses.map((res) =>
      validationKey(res.args.agentId, res.args.requestHash),
    ),
  );
  const seenRequests = new Set<string>();

  return requests.flatMap((req) => {
    const key = validationKey(req.args.agentId, req.args.requestHash);
    if (seenRequests.has(key) || responseKeys.has(key)) return [];
    seenRequests.add(key);
    return [
      {
        agentId: req.args.agentId,
        validatorAddress: req.args.validatorAddress,
        requestURI: req.args.requestURI,
        requestHash: req.args.requestHash,
      },
    ];
  });
}

async function submitUnansweredValidationResponses(
  chainId: number,
  validationRegistryAddress: `0x${string}`,
  submissions: UnansweredValidationRequest[],
): Promise<number> {
  if (submissions.length === 0) return 0;

  const byAgent = new Map<string, UnansweredValidationRequest[]>();
  for (const submission of submissions) {
    const agentId = submission.agentId.toString();
    const current = byAgent.get(agentId);
    if (current) current.push(submission);
    else byAgent.set(agentId, [submission]);
  }

  const results = await Promise.all(
    [...byAgent.entries()].map(
      async ([erc8004AgentId, agentSubmissions]): Promise<number> => {
        let oracleUrl: string | undefined;
        try {
          oracleUrl = await resolveOwnedValidationOracleUrl(
            chainId,
            erc8004AgentId,
          );
        } catch (err) {
          console.error(
            `[indexer] resolve validation oracle failed agentId=${erc8004AgentId}:`,
            err instanceof Error ? err.message : err,
          );
          return 0;
        }
        if (!oracleUrl) return 0;

        const agentResults = await Promise.all(
          agentSubmissions.map(async (submission): Promise<number> => {
            const payload = decodeJsonDataUri(submission.requestURI);
            if (!payload) {
              console.error(
                `[indexer] validation request ${submission.requestHash} has invalid requestURI`,
              );
              return 0;
            }

            const submitted = await submitOracleValidation(chainId, {
              erc8004AgentId,
              validatorAddress: submission.validatorAddress,
              requestHash: submission.requestHash,
              payload,
              validationRegistryAddress,
              oracleUrl,
            });
            if (!submitted.ok) {
              console.error(
                `[indexer] validation submit failed requestHash=${submission.requestHash}:`,
                submitted.error,
              );
              return 0;
            }
            return 1;
          }),
        );
        return agentResults.reduce((total, count) => total + count, 0);
      },
    ),
  );
  return results.reduce((total, count) => total + count, 0);
}

/**
 * Scans validation events and submits oracle responses for requests that do not
 * have a matching ValidationResponse event yet.
 *
 * ValidationResponse events are written to Redis for page reads.
 */
async function syncValidations(
  chainId: number,
  fromBlock: bigint,
  latestBlock: bigint,
  publicClient: PublicClient,
  validationRegistryAddress: `0x${string}`,
  pageSize: bigint,
): Promise<{ submitted: number; responses: number }> {
  const logs = await collectValidationLogs(
    publicClient,
    validationRegistryAddress,
    fromBlock,
    latestBlock,
    pageSize,
  );
  if (!logs.requests.length && !logs.responses.length)
    return { submitted: 0, responses: 0 };

  await addCachedValidationResponses(
    chainId,
    validationRegistryAddress,
    validationResponsesFromLogs(logs.responses),
  );

  const submissions = unansweredValidationRequestsFromLogs(logs);
  const submitted = await submitUnansweredValidationResponses(
    chainId,
    validationRegistryAddress,
    submissions,
  );

  return {
    submitted,
    responses: logs.responses.length,
  };
}

// ─── Main export ─────────────────────────────────────────────────────────────

/** Scan new blocks since the last cached block, update the agent cache, and sync pending validations. */
export async function syncEvents(chainId: number): Promise<IndexResult> {
  const cfg = getServerConfigForChain(chainId);

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

  const cached = await getCachedAgents(chainId, cfg.registryAddress);
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

  const { submitted: validationsProcessed, responses: validationsUpdated } =
    cfg.validationRegistryAddress
      ? await syncValidations(
          chainId,
          fromBlock,
          latestBlock,
          publicClient,
          cfg.validationRegistryAddress,
          PAGE,
        )
      : { submitted: 0, responses: 0 };

  // Advance lastBlock only after all processing for this range is complete.
  await setCachedAgents(chainId, cfg.registryAddress, merged, latestBlock);

  return {
    ok: true,
    newAgents: newAgents.length,
    totalAgents: merged.length,
    scannedFrom: fromBlock.toString(),
    latestBlock: latestBlock.toString(),
    validationsProcessed,
    validationsUpdated: validationsUpdated,
  };
}
