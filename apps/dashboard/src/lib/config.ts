/**
 * Dashboard config: public deployment addresses and server-only secrets layered
 * on top of NETWORK_CONFIG.
 */

import deploymentsJson from "../../../../deployments.json" with { type: "json" };
import type { AgentConfig } from "@tee-agent/agent/types";
import type { Address } from "viem";
import {
  DEFAULT_NETWORK,
  getNetworkConfigByChainId,
  NETWORK_CONFIG,
} from "@tee-agent/agent/network";

type RawDeployments = Record<
  string,
  {
    contracts?: {
      agentRegistry?: string;
      mockDcapAttestation?: string;
      teeVerifier?: string;
      validationRegistry?: string;
    };
    fromBlock?: string | number;
  }
>;

export type DashboardClientConfig = AgentConfig & {
  registryAddress: Address;
  teeVerifierAddress: Address;
  validationRegistryAddress: Address;
};

export type DashboardReadConfig = DashboardClientConfig & {
  registryFromBlock: bigint;
  rpcUrl?: string;
};

export type DashboardServerConfig = DashboardReadConfig & {
  privateKey: string;
  zeroGRpcUrl: string;
  zeroGIndexerUrl: string;
  pinataJwt: string;
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

const RPC_MAP = Object.fromEntries(
  Object.values(NETWORK_CONFIG).map((network) => [
    network.chain.id,
    process.env[network.rpcEnvVar],
  ]),
) as Record<number, string | undefined>;

export function getAvailableChainId(chainId?: number): number {
  if (!chainId) {
    return DEFAULT_NETWORK.chain.id;
  }

  return (
    getNetworkConfigByChainId(chainId)?.chain.id ?? DEFAULT_NETWORK.chain.id
  );
}

export function getDeploymentForChain(chainId: number): {
  agentRegistry: Address;
  teeVerifier: Address;
  validationRegistry: Address;
  fromBlock: bigint;
} {
  const activeChainId = getAvailableChainId(chainId);
  const raw = (deploymentsJson as RawDeployments)[String(activeChainId)];
  if (!raw?.contracts?.agentRegistry) {
    throw new Error(
      `AgentRegistry deployment missing for chain ${activeChainId}.`,
    );
  }
  if (!raw.contracts.teeVerifier) {
    throw new Error(
      `TeeVerifier deployment missing for chain ${activeChainId}.`,
    );
  }
  if (!raw.contracts.validationRegistry) {
    throw new Error(
      `ValidationRegistry deployment missing for chain ${activeChainId}.`,
    );
  }
  return {
    agentRegistry: raw.contracts.agentRegistry as Address,
    teeVerifier: raw.contracts.teeVerifier as Address,
    validationRegistry: raw.contracts.validationRegistry as Address,
    fromBlock: raw?.fromBlock === undefined ? 0n : BigInt(raw.fromBlock),
  };
}

export function getConfiguredChainIds(): number[] {
  return Object.values(NETWORK_CONFIG).map((network) => network.chain.id);
}

export function getClientConfigForChain(
  chainId?: number,
): DashboardClientConfig {
  const activeChainId = getAvailableChainId(chainId);
  const network = getNetworkConfigByChainId(activeChainId) ?? DEFAULT_NETWORK;
  const deployment = getDeploymentForChain(network.chain.id);
  const config: DashboardClientConfig = {
    chain: network.chain,
    identityRegistryAddress: network.identityRegistryAddress,
    reputationRegistryAddress: network.reputationRegistryAddress,
    registryAddress: deployment.agentRegistry,
    teeVerifierAddress: deployment.teeVerifier,
    validationRegistryAddress: deployment.validationRegistry,
  };

  return config;
}

/**
 * Returns public/read-only config for routes that only verify chain state.
 * This intentionally does not require private keys or storage credentials.
 */
export function getReadConfigForChain(chainId?: number): DashboardReadConfig {
  const activeChainId = getAvailableChainId(chainId);
  const clientConfig = getClientConfigForChain(activeChainId);
  const deployment = getDeploymentForChain(activeChainId);

  return {
    ...clientConfig,
    rpcUrl: RPC_MAP[activeChainId],
    registryFromBlock: deployment.fromBlock,
  };
}

/**
 * Returns the full server-side config for the given EVM chain ID.
 */
export function getServerConfigForChain(
  chainId?: number,
): DashboardServerConfig {
  const activeChainId = getAvailableChainId(chainId);
  const readConfig = getReadConfigForChain(activeChainId);

  return {
    ...readConfig,
    privateKey: requiredEnv("PRIVATE_KEY"),
    zeroGRpcUrl: requiredEnv("RPC_URL_ZERO_G"),
    zeroGIndexerUrl: requiredEnv("INDEXER_URL_ZERO_G"),
    pinataJwt: requiredEnv("PINATA_JWT"),
  };
}
