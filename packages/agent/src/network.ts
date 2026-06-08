import { base, baseSepolia } from "viem/chains";
import type { Address } from "viem";

const IDENTITY_REGISTRY = {
  mainnet: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
  testnet: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
} as const satisfies Record<string, Address>;

const REPUTATION_REGISTRY = {
  mainnet: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63",
  testnet: "0x8004B663056A597Dffe9eCcC1965A193B7388713",
} as const satisfies Record<string, Address>;

export const NETWORK_CONFIG = {
  base: {
    chain: base,
    chainId: 8453n,
    isTestnet: false,
    label: "Base",
    identityRegistryAddress: IDENTITY_REGISTRY.mainnet,
    reputationRegistryAddress: REPUTATION_REGISTRY.mainnet,
    explorerUrl: "https://basescan.org",
    erc8004ScanUrl: "https://8004scan.io",
    erc8004ChainSlug: "base",
    openseaUrl: "https://opensea.io/assets/base",
    rpcEnvVar: "RPC_URL_BASE",
  },
  baseSepolia: {
    chain: baseSepolia,
    chainId: 84532n,
    isTestnet: true,
    label: "Base Sepolia",
    identityRegistryAddress: IDENTITY_REGISTRY.testnet,
    reputationRegistryAddress: REPUTATION_REGISTRY.testnet,
    explorerUrl: "https://sepolia.basescan.org",
    erc8004ScanUrl: "https://testnet.8004scan.io",
    erc8004ChainSlug: "base-sepolia",
    openseaUrl: "https://testnets.opensea.io/assets/base-sepolia",
    rpcEnvVar: "RPC_URL_BASE_SEPOLIA",
  },
} as const;

export type NetworkName = keyof typeof NETWORK_CONFIG;
export type NetworkConfig = (typeof NETWORK_CONFIG)[NetworkName];

export const DEFAULT_NETWORK = NETWORK_CONFIG.baseSepolia;

export function getNetworkConfig(network: string): NetworkConfig {
  const net = NETWORK_CONFIG[network as NetworkName];
  if (!net) throw new Error(`Unsupported network: ${network}.`);
  return net;
}

export function getNetworkConfigByChainId(
  chainId: number | bigint,
): NetworkConfig {
  const id = Number(chainId);
  const network = Object.values(NETWORK_CONFIG).find(
    (item) => item.chain.id === id,
  );
  if (!network) throw new Error(`Unsupported chain ID: ${chainId}.`);
  return network;
}
