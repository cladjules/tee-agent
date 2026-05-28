/**
 * Server-only configuration. Never import from Client Components.
 * Extends ClientConfig with secrets and server-side-only fields.
 */

import { base, baseSepolia, type Chain } from "viem/chains";
import { defaultIdentityRegistry } from "@tee-agent/agent/config";
import type { ServerConfig } from "@tee-agent/agent/types";
import { clientCfg, type ClientConfig } from "./client-config";

export { clientCfg, type ClientConfig };
export type { ServerConfig };

export const NETWORKS = { base, baseSepolia } as const;

const chain: Chain = clientCfg.network === "base" ? base : baseSepolia;
export const APP_CHAIN: Chain = chain;

export const cfg: ServerConfig = {
  ...clientCfg,
  identityRegistryAddress: defaultIdentityRegistry(chain),
  teeVerifierAddress: process.env.NEXT_PUBLIC_TEE_VERIFIER_ADDRESS as
    | `0x${string}`
    | undefined,
  rpcUrl: process.env.RPC_URL,
  deployerKey: process.env.PRIVATE_KEY as `0x${string}` | undefined,
  zeroGKey: (process.env.ZERO_G_PRIVATE_KEY || process.env.PRIVATE_KEY) as
    | `0x${string}`
    | undefined,
  zeroGRpcUrl: process.env.ZERO_G_RPC_URL,
  zeroGIndexerUrl: process.env.ZERO_G_INDEXER_URL,
  pinataJwt: process.env.PINATA_JWT,
  registryFromBlock: BigInt(process.env.AGENT_REGISTRY_FROM_BLOCK ?? "0"),
  chain,
  chainId: chain.id,
  isConfigured: !!(
    clientCfg.registryAddress &&
    process.env.RPC_URL &&
    process.env.PRIVATE_KEY
  ),
};
