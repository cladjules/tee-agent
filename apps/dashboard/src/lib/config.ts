/**
 * Server-only configuration. Never import from Client Components.
 * Extends the client config with secrets and server-side-only fields.
 *
 * Per-network RPC_URL_* vars allow both chains to be configured simultaneously.
 * Public contract addresses and scan start blocks come from deployments.json.
 * `getServerConfigForChain(chainId)` returns the full config for the requested
 * chain.
 */

import type { AgentConfig } from "@tee-agent/agent/types";

import {
  getClientConfigForChain,
  getDeploymentForChain,
  clientCfg,
  BASE_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
} from "./client-config";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

// Chain IDs are public Base/Base Sepolia constants from client-config.
const RPC_URL_MAP: Record<number, string | undefined> = {
  [BASE_CHAIN_ID]: process.env.RPC_URL_BASE,
  [BASE_SEPOLIA_CHAIN_ID]: process.env.RPC_URL_BASE_SEPOLIA,
};

/**
 * Returns the full server-side config for the given EVM chain ID.
 */
export function getServerConfigForChain(chainId: number): AgentConfig & {
  registryFromBlock: bigint;
} {
  const clientConfig = getClientConfigForChain(chainId);
  const deployment = getDeploymentForChain(chainId);

  return {
    ...clientConfig,
    rpcUrl: RPC_URL_MAP[chainId],
    zeroGPrivateKey: process.env.PRIVATE_KEY,
    zeroGRpcUrl: process.env.ZERO_G_RPC_URL,
    zeroGIndexerUrl: process.env.ZERO_G_INDEXER_URL,
    pinataJwt: process.env.PINATA_JWT,
    registryFromBlock: deployment.fromBlock,
  };
}

export function getMutationConfigForChain(
  chainId: number,
): AgentConfig & { registryFromBlock: bigint } {
  return {
    ...getServerConfigForChain(chainId),
    zeroGPrivateKey: requiredEnv("PRIVATE_KEY"),
    zeroGRpcUrl: requiredEnv("ZERO_G_RPC_URL"),
    zeroGIndexerUrl: requiredEnv("ZERO_G_INDEXER_URL"),
    pinataJwt: requiredEnv("PINATA_JWT"),
  };
}

/** Chain ID shorthand for cache keys and client-side checks. */
export const chainId = clientCfg.chain.id;

/** True when the minimum required env vars are present for the default chain. */
export const isConfigured = !!(
  clientCfg.registryAddress && RPC_URL_MAP[BASE_SEPOLIA_CHAIN_ID]
);
