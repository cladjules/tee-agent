/**
 * Chain network constants and AgentConfig helpers.
 */

import { base, baseSepolia } from "viem/chains";
import type { Address, Chain } from "viem";
import type { AgentConfig } from "./types.js";

export const CHAIN_NETWORKS = {
  base,
  baseSepolia,
} as const;

export type ChainNetwork = keyof typeof CHAIN_NETWORKS;

// Official ERC-8004 singletons — hardcoded per chain, never change.
const IDENTITY_REGISTRY: Record<number, Address> = {
  8453: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
  84532: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
};

const REPUTATION_REGISTRY: Record<number, Address> = {
  8453: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63",
  84532: "0x8004B663056A597Dffe9eCcC1965A193B7388713",
};

export function defaultIdentityRegistry(chain: Chain): Address {
  return (
    IDENTITY_REGISTRY[chain.id] ??
    ("0x8004A818BFB912233c491871b3d84c89A494BD9e" as Address)
  );
}

export function defaultReputationRegistry(chain: Chain): Address {
  return (
    REPUTATION_REGISTRY[chain.id] ??
    ("0x8004B663056A597Dffe9eCcC1965A193B7388713" as Address)
  );
}

/**
 * Create an AgentConfig from a named network.
 * Minimal factory for standalone usage — applications typically construct
 * AgentConfig directly from their own env-var layer.
 */
export function createConfig(
  network: ChainNetwork,
  overrides: Omit<AgentConfig, "chain"> & Partial<Pick<AgentConfig, "chain">>,
): AgentConfig {
  const chain = overrides.chain ?? CHAIN_NETWORKS[network];
  return {
    ...overrides,
    chain,
    identityRegistryAddress:
      overrides.identityRegistryAddress ?? defaultIdentityRegistry(chain),
    reputationRegistryAddress:
      overrides.reputationRegistryAddress ?? defaultReputationRegistry(chain),
  };
}
