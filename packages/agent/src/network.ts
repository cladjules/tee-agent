import { arbitrumSepolia, hardhat } from "viem/chains";
import type { Address } from "viem";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const IDENTITY_REGISTRY = {
  mainnet: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
  testnet: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
} as const satisfies Record<string, Address>;

const REPUTATION_REGISTRY = {
  mainnet: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63",
  testnet: "0x8004B663056A597Dffe9eCcC1965A193B7388713",
} as const satisfies Record<string, Address>;

export const NETWORK_CONFIG = {
  arbitrumSepolia: {
    chain: arbitrumSepolia,
    chainId: 421614n,
    isTestnet: true,
    label: "Arbitrum Sepolia",
    identityRegistryAddress: IDENTITY_REGISTRY.testnet,
    reputationRegistryAddress: REPUTATION_REGISTRY.testnet,
    explorerUrl: "https://sepolia.arbiscan.io",
    erc8004ScanUrl: "https://testnet.8004scan.io",
    erc8004ChainSlug: "arbitrum-sepolia",
    openseaUrl: "https://testnets.opensea.io/assets/arbitrum-sepolia",
    rpcEnvVar: "RPC_URL_ARBITRUM_SEPOLIA",
  },
} as const;

export const LOCAL_NETWORK_CONFIG = {
  local: {
    chain: hardhat,
    chainId: 31337n,
    isTestnet: true,
    label: "Local Hardhat",
    identityRegistryAddress: ZERO_ADDRESS,
    reputationRegistryAddress: ZERO_ADDRESS,
    explorerUrl: "",
    erc8004ScanUrl: "",
    erc8004ChainSlug: "local",
    openseaUrl: "",
    rpcEnvVar: "LOCAL_RPC_URL",
  },
} as const;

const RUNTIME_NETWORK_CONFIG = {
  ...NETWORK_CONFIG,
  ...LOCAL_NETWORK_CONFIG,
} as const;

export type NetworkName = keyof typeof RUNTIME_NETWORK_CONFIG;
export type NetworkConfig = (typeof RUNTIME_NETWORK_CONFIG)[NetworkName];

export const DEFAULT_NETWORK = NETWORK_CONFIG.arbitrumSepolia;

export function getNetworkConfig(network: string): NetworkConfig {
  const net = RUNTIME_NETWORK_CONFIG[network as NetworkName];
  if (!net) throw new Error(`Unsupported network: ${network}.`);
  return net;
}

export function getNetworkConfigByChainId(
  chainId: number | bigint,
): NetworkConfig | undefined {
  const id = Number(chainId);
  const network = Object.values(RUNTIME_NETWORK_CONFIG).find(
    (item) => item.chain.id === id,
  );
  return network;
}
