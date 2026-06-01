/**
 * Client-safe configuration — safe to import from both Server and Client Components.
 * Contract addresses are non-secret (public on-chain data). Sensitive server-only
 * vars (PRIVATE_KEY, PINATA_JWT, RPC_URL, etc.) live in config.ts only.
 */

import { base, baseSepolia } from "viem/chains";
import { defaultReputationRegistry } from "@tee-agent/agent/config";
import type { AgentConfig } from "@tee-agent/agent/types";

export type { AgentConfig };

const chain = process.env.NEXT_PUBLIC_NETWORK === "base" ? base : baseSepolia;

export const clientCfg: AgentConfig = {
  chain,
  registryAddress: (process.env.NEXT_PUBLIC_AGENT_REGISTRY_ADDRESS ||
    undefined) as `0x${string}` | undefined,
  reputationRegistryAddress: (process.env
    .NEXT_PUBLIC_REPUTATION_REGISTRY_ADDRESS ||
    defaultReputationRegistry(chain)) as `0x${string}`,
  validationRegistryAddress: (process.env
    .NEXT_PUBLIC_VALIDATION_REGISTRY_ADDRESS || undefined) as
    | `0x${string}`
    | undefined,
  teeVerifierAddress: (process.env.NEXT_PUBLIC_TEE_VERIFIER_ADDRESS ||
    undefined) as `0x${string}` | undefined,
  oracleUrl: process.env.NEXT_PUBLIC_ORACLE_URL ?? "",
};
