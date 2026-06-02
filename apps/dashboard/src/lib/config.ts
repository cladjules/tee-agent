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

export {
  getClientConfigForChain,
  clientCfg,
  BASE_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
};
export type { AgentConfig };

// Chain IDs are imported from client-config which derives them from NETWORK_CONFIG.
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
    zeroGPrivateKey: process.env.PRIVATE_KEY as string | undefined,
    zeroGRpcUrl: process.env.ZERO_G_RPC_URL ?? "https://evmrpc-testnet.0g.ai",
    zeroGIndexerUrl:
      process.env.ZERO_G_INDEXER_URL ??
      "https://indexer-storage-testnet-turbo.0g.ai",
    pinataJwt: process.env.PINATA_JWT,
    registryFromBlock: deployment.fromBlock,
  };
}

export const APP_CHAIN = clientCfg.chain;

// Default chain; active chain is set per-request via cookie.
export const cfg = getServerConfigForChain(BASE_SEPOLIA_CHAIN_ID);

/** Deployer / server-side signer key. Server use only — never expose to browser. */
export const deployerKey = process.env.PRIVATE_KEY as `0x${string}` | undefined;

/** Chain ID shorthand for cache keys and client-side checks. */
export const chainId = clientCfg.chain.id;

/** Starting block for AgentRegistry event log queries on the default chain. */
export const registryFromBlock = cfg.registryFromBlock;

/** True when the minimum required env vars are present for the default chain. */
export const isConfigured = !!(
  clientCfg.registryAddress &&
  RPC_URL_MAP[BASE_SEPOLIA_CHAIN_ID] &&
  process.env.PRIVATE_KEY
);
