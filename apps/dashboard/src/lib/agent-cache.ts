/**
 * Redis-backed agent index cache.
 *
 * Stores these keys per (chainId, registryAddress) pair:
 *   agents:{chainId}:{registryAddress}          — JSON array of RegisteredAgent (oldest-first)
 *   lastBlock:{chainId}:{registryAddress}        — last block number scanned (string)
 *   oracleRuns:{chainId}:{registryAddress}:{id}  — off-chain oracle run history (newest-first)
 *   validationResponses:{chainId}:{registry}:{id} — ValidationResponse events (newest-first)
 *
 * Requires UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN env vars.
 * Falls back to null (no-op) when those vars are absent.
 */

import { Redis } from "@upstash/redis";
import type { RegisteredAgent } from "@tee-agent/agent/types";

export type IndexedValidationResponse = {
  requestHash: `0x${string}`;
  agentId: string;
  validatorAddress: `0x${string}`;
  score: number;
  txHash?: `0x${string}`;
  timestamp: number;
  responseURI?: string;
  responseHash?: `0x${string}`;
  tag?: string;
  reasoning?: string;
  evidence?: Record<string, unknown>;
};

// RegisteredAgent serialised for Redis (agentId as string — JSON can't hold bigint).
type StoredAgent = Omit<RegisteredAgent, "agentId"> & { agentId: string };

function toStored(agents: RegisteredAgent[]): StoredAgent[] {
  return agents.map(({ agentId, ...rest }) => ({
    ...rest,
    agentId: agentId.toString(),
  }));
}

function fromStored(stored: StoredAgent[]): RegisteredAgent[] {
  return stored.map(({ agentId, ...rest }) => ({
    ...rest,
    agentId: BigInt(agentId),
  }));
}

let _redis: Redis | null = null;

function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  if (!_redis) _redis = new Redis({ url, token });
  return _redis;
}

function agentsKey(
  chainId: number,
  registryAddress: `0x${string}` | undefined,
) {
  return `agents:${chainId}:${registryAddress ?? "none"}`;
}

function lastBlockKey(
  chainId: number,
  registryAddress: `0x${string}` | undefined,
) {
  return `lastBlock:${chainId}:${registryAddress ?? "none"}`;
}

/**
 * Reads the cached agent list and the last indexed block.
 * Returns null if Redis is not configured or the cache is empty.
 */
export async function getCachedAgents(
  chainId: number,
  registryAddress: `0x${string}` | undefined,
): Promise<{
  agents: RegisteredAgent[];
  lastBlock: bigint;
} | null> {
  const redis = getRedis();
  if (!redis) return null;

  try {
    const [storedAgents, storedBlock] = await Promise.all([
      redis.get<StoredAgent[]>(agentsKey(chainId, registryAddress)),
      redis.get<string>(lastBlockKey(chainId, registryAddress)),
    ]);

    if (storedAgents === null || storedBlock === null) return null;

    return { agents: fromStored(storedAgents), lastBlock: BigInt(storedBlock) };
  } catch (err) {
    console.error("[agent-cache] read failed:", err);
    return null;
  }
}

/**
 * Persists the agent list and the last indexed block to Redis.
 * Agents must be in oldest-first order.
 */
export async function setCachedAgents(
  chainId: number,
  registryAddress: `0x${string}` | undefined,
  agents: RegisteredAgent[],
  lastBlock: bigint,
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  try {
    await Promise.all([
      redis.set(agentsKey(chainId, registryAddress), toStored(agents)),
      redis.set(lastBlockKey(chainId, registryAddress), lastBlock.toString()),
    ]);
  } catch (err) {
    console.error("[agent-cache] write failed:", err);
  }
}

// ─── Oracle run history ───────────────────────────────────────────────────────

/** Persisted record of a single oracle run or validation. */
export type CachedOracleRun = {
  /** Agent ID as string (bigint serialization). */
  agentId: string;
  /** Decoded result object from the oracle. */
  result: {
    outcome?: {
      verdict?: string;
      confidence?: number;
      reasoning?: string;
      statusCode?: number;
      contentHash?: string;
      value?: unknown;
    };
    extra?: Record<string, unknown>;
  };
  /** Raw TDX quote hex from the oracle response. Not present for on-chain indexed runs. */
  quote?: string;
  /** TDX event log hex — stored so the owner can POST /verify on historical runs. */
  event_log?: string;
  /** Unix timestamp in seconds (from oracle response). */
  timestamp: number;
  /** Oracle's TEE-derived signing address. */
  oracleAddress?: string;
  /** Original input payload sent to /run — stored so the owner can target validation at a specific run. */
  payload?: Record<string, unknown>;
};

const MAX_RUNS_PER_AGENT = 100;
const MAX_VALIDATION_RESPONSES_PER_AGENT = 100;

function oracleRunsKey(
  chainId: number,
  registryAddress: `0x${string}` | undefined,
  agentId: bigint,
) {
  return `oracleRuns:${chainId}:${registryAddress ?? "none"}:${agentId.toString()}`;
}

/**
 * Returns the oracle run history for an agent, newest-first.
 * Returns an empty array on cache miss or Redis unavailability.
 */
export async function getCachedOracleRuns(
  chainId: number,
  registryAddress: `0x${string}` | undefined,
  agentId: bigint,
): Promise<CachedOracleRun[]> {
  const redis = getRedis();
  if (!redis) return [];
  try {
    const items = await redis.lrange<CachedOracleRun>(
      oracleRunsKey(chainId, registryAddress, agentId),
      0,
      -1,
    );
    return items ?? [];
  } catch (err) {
    console.error("[agent-cache] oracle runs read failed:", err);
    return [];
  }
}

/**
 * Prepends a run record for the given agent.
 * Caps the list at MAX_RUNS_PER_AGENT entries (oldest are dropped).
 */
export async function addCachedOracleRun(
  chainId: number,
  registryAddress: `0x${string}` | undefined,
  agentId: bigint,
  run: CachedOracleRun,
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    const key = oracleRunsKey(chainId, registryAddress, agentId);
    await redis.lpush(key, run);
    await redis.ltrim(key, 0, MAX_RUNS_PER_AGENT - 1);
  } catch (err) {
    console.error("[agent-cache] oracle run write failed:", err);
  }
}

// ─── Validation response history ─────────────────────────────────────────────

function validationResponsesKey(
  chainId: number,
  validationRegistryAddress: `0x${string}` | undefined,
  agentId: bigint,
) {
  return `validationResponses:${chainId}:${validationRegistryAddress ?? "none"}:${agentId.toString()}`;
}

export async function getCachedValidationResponses(
  chainId: number,
  validationRegistryAddress: `0x${string}` | undefined,
  agentId: bigint,
): Promise<IndexedValidationResponse[]> {
  const redis = getRedis();
  if (!redis) return [];
  try {
    return (
      (await redis.get<IndexedValidationResponse[]>(
        validationResponsesKey(chainId, validationRegistryAddress, agentId),
      )) ?? []
    );
  } catch (err) {
    console.error("[agent-cache] validation response read failed:", err);
    return [];
  }
}

export async function addCachedValidationResponses(
  chainId: number,
  validationRegistryAddress: `0x${string}` | undefined,
  responses: IndexedValidationResponse[],
): Promise<void> {
  const redis = getRedis();
  if (!redis || responses.length === 0) return;

  const byAgent = new Map<string, IndexedValidationResponse[]>();
  for (const response of responses) {
    const current = byAgent.get(response.agentId);
    if (current) current.push(response);
    else byAgent.set(response.agentId, [response]);
  }

  try {
    await Promise.all(
      [...byAgent.entries()].map(async ([agentId, agentResponses]) => {
        const key = validationResponsesKey(
          chainId,
          validationRegistryAddress,
          BigInt(agentId),
        );
        const existing =
          (await redis.get<IndexedValidationResponse[]>(key)) ?? [];
        const merged = new Map<string, IndexedValidationResponse>();
        for (const item of existing) {
          merged.set(item.requestHash.toLowerCase(), item);
        }
        for (const item of agentResponses) {
          merged.set(item.requestHash.toLowerCase(), item);
        }
        const ordered = [...merged.values()]
          .sort((a, b) => b.timestamp - a.timestamp)
          .slice(0, MAX_VALIDATION_RESPONSES_PER_AGENT);
        await redis.set(key, ordered);
      }),
    );
  } catch (err) {
    console.error("[agent-cache] validation response write failed:", err);
  }
}
