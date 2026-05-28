/**
 * Client-safe configuration — safe to import from both Server and Client Components.
 * Contract addresses are non-secret (public on-chain data). Sensitive server-only
 * vars (PRIVATE_KEY, PINATA_JWT, RPC_URL, etc.) live in config.ts only.
 */

import { base, baseSepolia } from "viem/chains";
import { defaultReputationRegistry } from "@tee-agent/agent/config";
import type { ChainNetwork, ClientConfig } from "@tee-agent/agent/types";

export type { ChainNetwork, ClientConfig };

const network = (process.env.NEXT_PUBLIC_NETWORK ??
  "baseSepolia") as ChainNetwork;
const chain = network === "base" ? base : baseSepolia;

export const clientCfg: ClientConfig = {
  network,
  registryAddress: (process.env.AGENT_REGISTRY_ADDRESS || undefined) as
    | `0x${string}`
    | undefined,
  reputationAddress: (process.env.REPUTATION_REGISTRY_ADDRESS ||
    defaultReputationRegistry(chain)) as `0x${string}`,
  validationAddress: (process.env.VALIDATION_REGISTRY_ADDRESS || undefined) as
    | `0x${string}`
    | undefined,
  oracleUrl: process.env.NEXT_PUBLIC_ORACLE_URL ?? "",
};
