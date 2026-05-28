/**
 * Redis-backed agent index cache.
 *
 * Stores two keys per (chainId, registryAddress) pair:
 *   agents:v1:{chainId}:{registryAddress}          — JSON array of RegisteredAgent (oldest-first)
 *   lastBlock:v1:{chainId}:{registryAddress}        — last block number scanned (string)
 *   intelligentData:v1:{chainId}:{registryAddress}:{agentId} — per-agent proof entries
 *
 * Requires UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN env vars.
 * Falls back to null (no-op) when those vars are absent.
 */

import { Redis } from "@upstash/redis";
import type {
  RegisteredAgent,
  AgentIntelligentDataEntry,
} from "@tee-agent/agent/types";
import { cfg } from "@/lib/config";

// RegisteredAgent serialised for Redis (agentId as string — JSON can't hold bigint).
type StoredAgent = Omit<RegisteredAgent, "agentId"> & { agentId: string };

export type CachedProofs = {
  verifierAddress?: `0x${string}`;
  erc8004AgentId?: string;
  intelligentData: AgentIntelligentDataEntry[];
};

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
  return `agents:v1:${cfg.chainId}:${cfg.registryAddress ?? "none"}`;
}

function lastBlockKey() {
  return `lastBlock:v1:${cfg.chainId}:${cfg.registryAddress ?? "none"}`;
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

function intelligentDataKey(agentId: bigint) {
  return `intelligentData:v1:${cfg.chainId}:${cfg.registryAddress ?? "none"}:${agentId.toString()}`;
}

/**
 * Returns cached proof entries for a single agent, or null on miss.
 */
export async function getCachedProofs(
  agentId: bigint,
): Promise<CachedProofs | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    return await redis.get<CachedProofs>(intelligentDataKey(agentId));
  } catch (err) {
    console.error("[agent-cache] proofs read failed:", err);
    return null;
  }
}

/**
 * Persists proof entries for a single agent.
 */
export async function setCachedProofs(
  agentId: bigint,
  data: CachedProofs,
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(intelligentDataKey(agentId), data);
  } catch (err) {
    console.error("[agent-cache] proofs write failed:", err);
  }
}

// ─── Oracle run history ───────────────────────────────────────────────────────

/** Persisted record of a single oracle run or validation. */
export type CachedOracleRun = {
  /** Agent ID as string (bigint serialization). */
  agentId: string;
  /** "run" = POST /run, "validate" = POST /validate */
  kind: "run" | "validate";
  /** Oracle handler type label (e.g. "prediction-verifier", "web-fetcher"). */
  type: string;
  /** Decoded result object from the oracle. */
  result: Record<string, unknown>;
  /** 0–100 score; only present for "validate" runs. */
  score?: number;
  /** TEE attestation signature hex. */
  proof: string;
  /** Unix timestamp in seconds (from oracle response). */
  timestamp: number;
  /** On-chain tx hash (validate only). */
  txHash?: string;
  /** Address that initiated the run. */
  runBy?: string;
  /** Oracle's TEE-derived signing address. */
  oracleAddress?: string;
  /** Original input payload sent to /run — stored so the owner can target validation at a specific run. */
  payload?: Record<string, unknown>;
  /** On-chain requestHash once a validation has been submitted for this run. Prevents re-requesting. */
  validationRequestHash?: string;
};

const MAX_RUNS_PER_AGENT = 100;

function oracleRunsKey(agentId: bigint) {
  return `oracleRuns:v1:${cfg.chainId}:${cfg.registryAddress ?? "none"}:${agentId.toString()}`;
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

/**
 * Stamps validationRequestHash onto a cached run (identified by timestamp).
 * Reads the list, updates the matching entry, and writes it back.
 */
export async function updateOracleRunValidationHash(
  agentId: bigint,
  runTimestamp: number,
  requestHash: string,
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    const key = oracleRunsKey(agentId);
    const items = (await redis.lrange<CachedOracleRun>(key, 0, -1)) ?? [];
    if (!items.length) return;
    const updated = items.map((run) =>
      run.timestamp === runTimestamp
        ? { ...run, validationRequestHash: requestHash }
        : run,
    );
    await redis.del(key);
    await redis.rpush(key, ...updated);
  } catch (err) {
    console.error(
      "[agent-cache] oracle run validation hash update failed:",
      err,
    );
  }
}

// ─── Pending validations ───────────────────────────────────────────────────────

/**
 * Off-chain job data queued by the client after the on-chain validationRequest TX is confirmed.
 * agentId / registryAddress / validationRegistryAddress are NOT stored here — they are derived
 * from on-chain ValidationRequest events by the cron (source of truth).
 * The owner triggers the oracle call explicitly from the dashboard.
 */
export type PendingValidation = {
  requestHash: string;
  /** On-chain requestURI — data:application/json;base64,… encoding the payload. */
  requestURI: string;
  /** agentId from the ValidationRequest event. */
  agentId: string;
  /** Oracle EOA address designated as validatorAddress on-chain. */
  validatorAddress: string;
  /** Unix timestamp when the cron discovered this request. */
  queuedAt: number;
  /** Attempt count — incremented on each failed oracle call from the UI. */
  attempts: number;
};

// ─── Keys: one JSON array per agentId ────────────────────────────────────────

/** Per-agent list of pending validation jobs. */
function pendingValidationsAgentKey(agentId: string) {
  return `pendingValidations:v2:${cfg.chainId}:${cfg.registryAddress ?? "none"}:agent:${agentId}`;
}

/** Global set of agentIds that have ≥1 pending validation — lets Phase 1 iterate all agents. */
function pendingValidationAgentsSetKey() {
  return `pendingValidationAgents:v2:${cfg.chainId}:${cfg.registryAddress ?? "none"}`;
}

// ─── Write ────────────────────────────────────────────────────────────────────

/** Queue a validation job. No-op if the requestHash is already queued for this agent. */
export async function addPendingValidation(
  job: PendingValidation,
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    const key = pendingValidationsAgentKey(job.agentId);
    const existing = (await redis.get<PendingValidation[]>(key)) ?? [];
    if (existing.some((j) => j.requestHash === job.requestHash)) return;
    await redis.set(key, [...existing, job]);
    await redis.sadd(pendingValidationAgentsSetKey(), job.agentId);
  } catch (err) {
    console.error("[agent-cache] pending validation write failed:", err);
  }
}

/** Remove a single pending validation for the given agent. Cleans up the agent index when empty. */
export async function removePendingValidation(
  agentId: string,
  requestHash: string,
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    const key = pendingValidationsAgentKey(agentId);
    const existing = (await redis.get<PendingValidation[]>(key)) ?? [];
    const updated = existing.filter((j) => j.requestHash !== requestHash);
    if (updated.length === 0) {
      await redis.del(key);
      await redis.srem(pendingValidationAgentsSetKey(), agentId);
    } else {
      await redis.set(key, updated);
    }
  } catch (err) {
    console.error("[agent-cache] pending validation remove failed:", err);
  }
}

// ─── Read ─────────────────────────────────────────────────────────────────────

/** Return all pending validation jobs for a specific agent (empty array if none). */
export async function getPendingValidationsForAgent(
  agentId: string,
): Promise<PendingValidation[]> {
  const redis = getRedis();
  if (!redis) return [];
  try {
    return (
      (await redis.get<PendingValidation[]>(
        pendingValidationsAgentKey(agentId),
      )) ?? []
    );
  } catch (err) {
    console.error("[agent-cache] pending validations read failed:", err);
    return [];
  }
}

// ─── Eviction ─────────────────────────────────────────────────────────────────

/**
 * Removes a single agent from the cache by agentId (e.g. after a burn/transfer).
 * No-op if Redis is not configured.
 */
export async function evictCachedAgent(agentId: bigint): Promise<void> {
  const cached = await getCachedAgents();
  if (!cached) return;

  const filtered = cached.agents.filter((a) => a.agentId !== agentId);
  if (filtered.length === cached.agents.length) return; // not found, skip write

  await setCachedAgents(filtered, cached.lastBlock);
}
