/**
 * Dashboard config: public deployment addresses, active chain cookie state,
 * and server-only secrets layered on top of NETWORK_CONFIG.
 */

import deploymentsJson from "../../../../deployments.json" with { type: "json" };
import { cookies } from "next/headers";
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

export const ACTIVE_CHAIN_COOKIE = "active_chain_id";

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

export function getDeploymentForChain(chainId: number): {
  agentRegistry?: Address;
  teeVerifier?: Address;
  validationRegistry?: Address;
  fromBlock: bigint;
} {
  const raw = (deploymentsJson as RawDeployments)[String(chainId)];
  const deployment: {
    agentRegistry?: Address;
    teeVerifier?: Address;
    validationRegistry?: Address;
    fromBlock: bigint;
  } = {
    fromBlock: raw?.fromBlock === undefined ? 0n : BigInt(raw.fromBlock),
  };
  if (raw?.contracts?.agentRegistry) {
    deployment.agentRegistry = raw.contracts.agentRegistry as Address;
  }
  if (raw?.contracts?.teeVerifier) {
    deployment.teeVerifier = raw.contracts.teeVerifier as Address;
  }
  if (raw?.contracts?.validationRegistry) {
    deployment.validationRegistry = raw.contracts.validationRegistry as Address;
  }
  return deployment;
}

export async function getActiveChainId(): Promise<number> {
  const store = await cookies();
  const val = store.get(ACTIVE_CHAIN_COOKIE)?.value;
  const id = val ? parseInt(val, 10) : NaN;
  try {
    return getNetworkConfigByChainId(id).chain.id;
  } catch {
    return DEFAULT_NETWORK.chain.id;
  }
}

export function getClientConfigForChain(chainId: number): AgentConfig {
  const network = getNetworkConfigByChainId(chainId);
  const deployment = getDeploymentForChain(network.chain.id);
  const config: AgentConfig = {
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
 * Returns the full server-side config for the given EVM chain ID.
 */
export function getServerConfigForChain(chainId: number): AgentConfig & {
  registryFromBlock: bigint;
} {
  const clientConfig = getClientConfigForChain(chainId);
  const deployment = getDeploymentForChain(chainId);

  return {
    ...clientConfig,
    rpcUrl: RPC_MAP[chainId],
    registryFromBlock: deployment.fromBlock,
    privateKey: requiredEnv("PRIVATE_KEY"),
    zeroGRpcUrl: requiredEnv("RPC_URL_ZERO_G"),
    zeroGIndexerUrl: requiredEnv("INDEXER_URL_ZERO_G"),
    pinataJwt: requiredEnv("PINATA_JWT"),
  };
}
