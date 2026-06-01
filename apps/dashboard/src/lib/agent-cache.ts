/**
 * Redis-backed agent index cache.
 *
 * Stores two keys per (chainId, registryAddress) pair:
 *   agents:{chainId}:{registryAddress}          — JSON array of RegisteredAgent (oldest-first)
 *   lastBlock:{chainId}:{registryAddress}        — last block number scanned (string)
 *
 * Requires UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN env vars.
 * Falls back to null (no-op) when those vars are absent.
 */

import { Redis } from "@upstash/redis";
import type { RegisteredAgent } from "@tee-agent/agent/types";
import { cfg } from "@/lib/config";

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

function agentsKey() {
  return `agents:${cfg.chain.id}:${cfg.registryAddress ?? "none"}`;
}

function lastBlockKey() {
  return `lastBlock:${cfg.chain.id}:${cfg.registryAddress ?? "none"}`;
}

/**
 * Reads the cached agent list and the last indexed block.
 * Returns null if Redis is not configured or the cache is empty.
 */
export async function getCachedAgents(): Promise<{
  agents: RegisteredAgent[];
  lastBlock: bigint;
} | null> {
  const redis = getRedis();
  if (!redis) return null;

  try {
    const [storedAgents, storedBlock] = await Promise.all([
      redis.get<StoredAgent[]>(agentsKey()),
      redis.get<string>(lastBlockKey()),
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
  agents: RegisteredAgent[],
  lastBlock: bigint,
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  try {
    await Promise.all([
      redis.set(agentsKey(), toStored(agents)),
      redis.set(lastBlockKey(), lastBlock.toString()),
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
  /** On-chain tx hash. */
  txHash?: string;
  /** Oracle's TEE-derived signing address. */
  oracleAddress?: string;
  /** Original input payload sent to /run — stored so the owner can target validation at a specific run. */
  payload?: Record<string, unknown>;
};

const MAX_RUNS_PER_AGENT = 100;

function oracleRunsKey(agentId: bigint) {
  return `oracleRuns:${cfg.chain.id}:${cfg.registryAddress ?? "none"}:${agentId.toString()}`;
}

/**
 * Returns the oracle run history for an agent, newest-first.
 * Returns an empty array on cache miss or Redis unavailability.
 */
export async function getCachedOracleRuns(
  agentId: bigint,
): Promise<CachedOracleRun[]> {
  const redis = getRedis();
  if (!redis) return [];
  try {
    const items = await redis.lrange<CachedOracleRun>(
      oracleRunsKey(agentId),
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
  agentId: bigint,
  run: CachedOracleRun,
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    const key = oracleRunsKey(agentId);
    await redis.lpush(key, run);
    await redis.ltrim(key, 0, MAX_RUNS_PER_AGENT - 1);
  } catch (err) {
    console.error("[agent-cache] oracle run write failed:", err);
  }
}

// ─── Validation request cache ─────────────────────────────────────────────────

/** Persisted pending (or completed) ValidationRequest event. */
export type CachedValidation = {
  requestHash: string;
  requestURI: string;
  agentId: string;
  validatorAddress: string;
  /** Present once the on-chain ValidationResponse event has been indexed. */
  response?: {
    score: number;
    txHash?: string;
    timestamp: number;
  };
};

function validationRequestsKey(agentId: bigint) {
  return `validationRequests:${cfg.chain.id}:${cfg.registryAddress ?? "none"}:${agentId.toString()}`;
}

/** Returns pending validation requests for an agent (no on-chain response yet). */
export async function getCachedValidations(
  agentId: bigint,
): Promise<CachedValidation[]> {
  const redis = getRedis();
  if (!redis) return [];
  try {
    return (
      (await redis.get<CachedValidation[]>(validationRequestsKey(agentId))) ??
      []
    );
  } catch (err) {
    console.error("[agent-cache] validation requests read failed:", err);
    return [];
  }
}

/**
 * Atomically replaces the pending validation request list for an agent.
 * Call with the complete current pending set (indexer owns this).
 */
export async function setCachedValidations(
  agentId: bigint,
  items: CachedValidation[],
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(validationRequestsKey(agentId), items);
  } catch (err) {
    console.error("[agent-cache] validation requests write failed:", err);
  }
}
