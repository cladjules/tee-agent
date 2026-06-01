/**
 * Server-only configuration. Never import from Client Components.
 * Extends the client config with secrets and server-side-only fields.
 */

import { defaultIdentityRegistry } from "@tee-agent/agent/config";
import type { AgentConfig } from "@tee-agent/agent/types";
import { clientCfg } from "./client-config";

export { clientCfg };
export type { AgentConfig };

export const APP_CHAIN = clientCfg.chain;

export const cfg: AgentConfig = {
  ...clientCfg,
  identityRegistryAddress: defaultIdentityRegistry(clientCfg.chain),
  rpcUrl: process.env.RPC_URL,
  zeroGPrivateKey: (process.env.ZERO_G_PRIVATE_KEY ||
    process.env.PRIVATE_KEY) as string | undefined,
  zeroGRpcUrl: process.env.ZERO_G_RPC_URL ?? "https://evmrpc-testnet.0g.ai",
  zeroGIndexerUrl:
    process.env.ZERO_G_INDEXER_URL ??
    "https://indexer-storage-testnet-turbo.0g.ai",
  pinataJwt: process.env.PINATA_JWT,
};

/** Deployer / server-side signer key. Server use only — never expose to browser. */
export const deployerKey = process.env.PRIVATE_KEY as `0x${string}` | undefined;

/** Chain ID shorthand for cache keys and client-side checks. */
export const chainId = clientCfg.chain.id;

/** Starting block for AgentRegistry event log queries. */
export const registryFromBlock = BigInt(
  process.env.AGENT_REGISTRY_FROM_BLOCK ?? "0",
);

/** True when the minimum required env vars are present. */
export const isConfigured = !!(
  clientCfg.registryAddress &&
  process.env.RPC_URL &&
  process.env.PRIVATE_KEY
);
