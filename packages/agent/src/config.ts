/**
 * Chain network constants and AgentConfig helpers.
 *
 * Single source of truth for all chain-specific addresses and URLs.
 * Used by packages/server, apps/dashboard, and any other consumer.
 *
 * Usage:
 *   import { getNetworkConfigByChainId } from "@tee-agent/agent/config";
 *   const nc = getNetworkConfigByChainId(chainId); // resolve from active wallet chain
 */

import { base, baseSepolia } from "viem/chains";
import type { Address, Chain } from "viem";
import type { AgentConfig } from "./types.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type NetworkName = "base" | "baseSepolia";

export interface NetworkConfig {
  /** Canonical network key used in env vars (NETWORK). */
  name: NetworkName;
  /** Viem chain object — use for viem clients and WalletProvider. */
  chain: Chain;
  /** Chain ID as bigint — use for ethers.js / ABI encoding. */
  chainId: bigint;
  /**
   * True when the chain is a testnet.
   * Derived from the chain name containing "sepolia" or "testnet", or viem's `testnet` flag.
   */
  isTestnet: boolean;
  /** Official ERC-8004 Identity Registry singleton for this chain. */
  identityRegistryAddress: Address;
  /** Official ERC-8004 Reputation Registry singleton for this chain. */
  reputationRegistryAddress: Address;
  /** Block explorer base URL (e.g. https://basescan.org). */
  explorerUrl: string;
  /** 8004scan base URL for ERC-8004 agent pages. */
  erc8004ScanUrl: string;
  /** Chain slug used in 8004scan URLs (e.g. "base" or "base-sepolia"). */
  erc8004ChainSlug: string;
  /** OpenSea NFT base URL for this chain. */
  openseaUrl: string;
}

export type ContractDeployments = {
  agentRegistry?: Address;
  validationRegistry?: Address;
};

export type RawDeployments = Record<
  string,
  {
    name?: string;
    contracts?: Record<string, string | undefined>;
    fromBlock?: string | number;
  }
>;

export type NetworkDeployment = {
  name?: string;
  contracts: ContractDeployments;
  fromBlock?: bigint;
};

// ─── Network registry ─────────────────────────────────────────────────────────
// Official ERC-8004 singletons — one set per mainnet, one per testnet.
// Derived from isTestnet so any new chain automatically gets the right addresses.

const IDENTITY_REGISTRY = {
  mainnet: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" as Address,
  testnet: "0x8004A818BFB912233c491871b3d84c89A494BD9e" as Address,
};

const REPUTATION_REGISTRY = {
  mainnet: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63" as Address,
  testnet: "0x8004B663056A597Dffe9eCcC1965A193B7388713" as Address,
};

export const NETWORK_CONFIG = {
  base: {
    name: "base" as const,
    chain: base,
    chainId: 8453n,
    isTestnet: false,
    identityRegistryAddress: IDENTITY_REGISTRY.mainnet,
    reputationRegistryAddress: REPUTATION_REGISTRY.mainnet,
    explorerUrl: "https://basescan.org",
    erc8004ScanUrl: "https://8004scan.io",
    erc8004ChainSlug: "base",
    openseaUrl: "https://opensea.io/assets/base",
  },
  baseSepolia: {
    name: "baseSepolia" as const,
    chain: baseSepolia,
    chainId: 84532n,
    isTestnet: true,
    identityRegistryAddress: IDENTITY_REGISTRY.testnet,
    reputationRegistryAddress: REPUTATION_REGISTRY.testnet,
    explorerUrl: "https://sepolia.basescan.org",
    erc8004ScanUrl: "https://testnet.8004scan.io",
    erc8004ChainSlug: "base-sepolia",
    openseaUrl: "https://testnets.opensea.io/assets/base-sepolia",
  },
} satisfies Record<NetworkName, NetworkConfig>;

// ─── Primary helper ───────────────────────────────────────────────────────────

/**
 * Returns the `NetworkConfig` for the given network name string.
 * Falls back to `baseSepolia` when the value is missing or unknown.
 *
 * Pass the env var directly — used in oracle/server only:
 *   `getNetworkConfig(process.env.NETWORK)`
 */
export function getNetworkConfig(network?: string): NetworkConfig {
  return NETWORK_CONFIG[network as NetworkName] ?? NETWORK_CONFIG.baseSepolia;
}

/**
 * Returns the `NetworkConfig` for the given EVM chain ID (number).
 * Falls back to `baseSepolia` when the chain ID is unrecognised.
 *
 *   const nc = getNetworkConfigByChainId(useChainId()); // client component
 *   const nc = getNetworkConfigByChainId(8453);         // Base mainnet
 */
export function getNetworkConfigByChainId(chainId: number): NetworkConfig {
  const entry = Object.values(NETWORK_CONFIG).find(
    (n) => Number(n.chainId) === chainId,
  );
  return entry ?? NETWORK_CONFIG.baseSepolia;
}

/**
 * Returns mutable deployment data for a chain: app-owned contract addresses and
 * the first block to scan. Pass the app's own deployments.json as the second arg.
 */
export function getNetworkDeploymentByChainId(
  chainId: number | bigint,
  deployments: RawDeployments = {},
): NetworkDeployment {
  const raw = deployments[String(chainId)];
  const contracts: ContractDeployments = {};
  const addr = (v: string | undefined): Address | undefined =>
    v ? (v as Address) : undefined;
  const agentRegistry = addr(raw?.contracts?.agentRegistry);
  const validationRegistry = addr(raw?.contracts?.validationRegistry);
  if (agentRegistry) contracts.agentRegistry = agentRegistry;
  if (validationRegistry) contracts.validationRegistry = validationRegistry;
  const deployment: NetworkDeployment = { contracts };
  if (raw?.name) deployment.name = raw.name;
  if (raw?.fromBlock !== undefined)
    deployment.fromBlock = BigInt(raw.fromBlock);
  return deployment;
}

/** Returns the official ERC-8004 Identity Registry address for a viem Chain. */
export function defaultIdentityRegistry(chain: Chain): Address {
  const entry = Object.values(NETWORK_CONFIG).find(
    (n) => n.chain.id === chain.id,
  );
  return (
    entry?.identityRegistryAddress ??
    NETWORK_CONFIG.baseSepolia.identityRegistryAddress
  );
}

/** Returns the official ERC-8004 Reputation Registry address for a viem Chain. */
export function defaultReputationRegistry(chain: Chain): Address {
  const entry = Object.values(NETWORK_CONFIG).find(
    (n) => n.chain.id === chain.id,
  );
  return (
    entry?.reputationRegistryAddress ??
    NETWORK_CONFIG.baseSepolia.reputationRegistryAddress
  );
}

/**
 * Create an AgentConfig from a named network.
 * Minimal factory for standalone usage — applications typically construct
 * AgentConfig directly from their own env-var layer.
 */
export function createConfig(
  network: NetworkName,
  overrides: Partial<AgentConfig> & { chain?: Chain },
  deployments: RawDeployments = {},
): AgentConfig {
  const nc = NETWORK_CONFIG[network] ?? NETWORK_CONFIG.baseSepolia;
  const chain = overrides.chain ?? nc.chain;
  const deployment = getNetworkDeploymentByChainId(nc.chainId, deployments);
  const registryAddress =
    overrides.registryAddress ?? deployment.contracts.agentRegistry;
  const validationRegistryAddress =
    overrides.validationRegistryAddress ??
    deployment.contracts.validationRegistry;
  const config: AgentConfig = {
    ...overrides,
    chain,
    identityRegistryAddress:
      overrides.identityRegistryAddress ?? nc.identityRegistryAddress,
    reputationRegistryAddress:
      overrides.reputationRegistryAddress ?? nc.reputationRegistryAddress,
  };

  if (registryAddress) config.registryAddress = registryAddress;
  if (validationRegistryAddress) {
    config.validationRegistryAddress = validationRegistryAddress;
  }

  return config;
}
