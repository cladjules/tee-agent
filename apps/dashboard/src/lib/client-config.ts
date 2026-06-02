/**
 * Client-safe configuration — safe to import from both Server and Client Components.
 * Contract addresses are non-secret (public on-chain data). Sensitive server-only
 * vars (PRIVATE_KEY, PINATA_JWT, RPC_URL, etc.) live in config.ts only.
 *
 * Public deployment addresses come from the root deployments.json so both
 * networks are available simultaneously for chain switching.
 *
 * ERC-8004 identity/reputation registries are always the official on-chain singletons
 * defined in NETWORK_CONFIG — never overridden by env vars.
 */

import deploymentsJson from "../../../../deployments.json" with { type: "json" };
import type { AgentConfig } from "@tee-agent/agent/types";
import type { Address } from "viem";
import { base, baseSepolia } from "viem/chains";

type RawDeployments = Record<
  string,
  {
    contracts?: {
      agentRegistry?: string;
      validationRegistry?: string;
    };
    fromBlock?: string | number;
  }
>;

const deployments = deploymentsJson as RawDeployments;

export type { AgentConfig };

const BASE_CHAIN_ID = base.id;
const BASE_SEPOLIA_CHAIN_ID = baseSepolia.id;

const IDENTITY_REGISTRY = {
  base: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" as const,
  baseSepolia: "0x8004A818BFB912233c491871b3d84c89A494BD9e" as const,
};

const REPUTATION_REGISTRY = {
  base: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63" as const,
  baseSepolia: "0x8004B663056A597Dffe9eCcC1965A193B7388713" as const,
};

export function getDeploymentForChain(chainId: number): {
  agentRegistry?: Address;
  validationRegistry?: Address;
  fromBlock: bigint;
} {
  const raw = deployments[String(chainId)];
  return {
    agentRegistry: raw?.contracts?.agentRegistry as Address | undefined,
    validationRegistry: raw?.contracts?.validationRegistry as
      | Address
      | undefined,
    fromBlock: raw?.fromBlock === undefined ? BigInt(0) : BigInt(raw.fromBlock),
  };
}

/**
 * Returns the client-safe AgentConfig for the given EVM chain ID.
 * Deployment JSON is baked in at build time — both networks are
 * available simultaneously so callers can switch at runtime.
 */
export function getClientConfigForChain(chainId: number): AgentConfig {
  const isBase = chainId === BASE_CHAIN_ID;
  const chain = isBase ? base : baseSepolia;
  const deployment = getDeploymentForChain(chain.id);
  const config: AgentConfig = {
    chain,
    identityRegistryAddress: isBase
      ? IDENTITY_REGISTRY.base
      : IDENTITY_REGISTRY.baseSepolia,
    reputationRegistryAddress: isBase
      ? REPUTATION_REGISTRY.base
      : REPUTATION_REGISTRY.baseSepolia,
  };

  if (deployment.agentRegistry) {
    config.registryAddress = deployment.agentRegistry;
  }
  if (deployment.validationRegistry) {
    config.validationRegistryAddress = deployment.validationRegistry;
  }

  return config;
}

export { BASE_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID };

// Default chain; active chain is set per-request via cookie.
export const clientCfg: AgentConfig = getClientConfigForChain(
  BASE_SEPOLIA_CHAIN_ID,
);
