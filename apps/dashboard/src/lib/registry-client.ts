/**
 * Shared viem + AgentRegistry client factories.
 * Not a Server Action — safe to import from both actions/ and API routes.
 */

import { AgentRegistry } from "@tee-agent/agent/registry";
import { createPublicClient, http } from "viem";
import { cfg } from "@/lib/config";
import type { AgentConfig } from "@tee-agent/agent/types";

/** Build an AgentConfig from the current server-side cfg singleton. */
export function toAgentConfig(): AgentConfig {
  return {
    rpcUrl: cfg.rpcUrl ?? "",
    chain: cfg.chain,
    registryAddress: cfg.registryAddress ?? ("0x" as `0x${string}`),
    identityRegistryAddress: cfg.identityRegistryAddress,
    reputationRegistryAddress: cfg.reputationAddress,
    validationRegistryAddress: cfg.validationAddress,
    teeVerifierAddress: cfg.teeVerifierAddress,
    oracleUrl: cfg.oracleUrl,
    pinataJwt: cfg.pinataJwt,
    zeroGPrivateKey: cfg.zeroGKey,
    zeroGRpcUrl: cfg.zeroGRpcUrl,
    zeroGIndexerUrl: cfg.zeroGIndexerUrl,
  };
}

export function makePublicClient() {
  if (!cfg.rpcUrl) return null;
  return createPublicClient({
    chain: cfg.chain as Parameters<typeof createPublicClient>[0]["chain"],
    transport: http(cfg.rpcUrl),
  });
}
export type PublicClient = NonNullable<ReturnType<typeof makePublicClient>>;

export function makeAgentRegistryClient() {
  if (!cfg.registryAddress) return null;
  const publicClient = makePublicClient();
  if (!publicClient) return null;

  return new AgentRegistry({
    agentRegistryAddress: cfg.registryAddress,
    publicClient: publicClient as any,
  });
}
export type AgentRegistryClient = NonNullable<
  ReturnType<typeof makeAgentRegistryClient>
>;

// ─── On-chain proof data resolution ──────────────────────────────────────────
// Delegated to @tee-agent/agent/resolve — use resolveAgentProofData(toAgentConfig(), agentId).
