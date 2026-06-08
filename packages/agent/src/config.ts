/**
 * AgentConfig helpers.
 *
 * Chain-specific constants live in network.ts. This module composes that
 * network registry with app-owned deployments.json data.
 *
 * Usage:
 *   import { getNetworkConfigByChainId } from "@tee-agent/agent/network";
 *   const nc = getNetworkConfigByChainId(chainId); // resolve from active wallet chain
 */

import type { Address } from "viem";

// ─── Types ────────────────────────────────────────────────────────────────────

export type RawDeployments = Record<
  string,
  {
    name?: string;
    contracts?: Record<string, string>;
    fromBlock?: string | number;
  }
>;

export type NetworkDeployment = {
  name?: string;
  contracts: {
    agentRegistry?: Address;
    teeVerifier?: Address;
    validationRegistry?: Address;
  };
  fromBlock?: bigint;
};

/**
 * Returns mutable deployment data for a chain: app-owned contract addresses and
 * the first block to scan. Pass the app's own deployments.json as the second arg.
 */
export function getNetworkDeploymentByChainId(
  chainId: number | bigint,
  deployments: RawDeployments = {},
): NetworkDeployment {
  const raw = deployments[String(chainId)];
  const contracts: NetworkDeployment["contracts"] = {};
  if (raw?.contracts?.agentRegistry) {
    contracts.agentRegistry = raw.contracts.agentRegistry as Address;
  }
  if (raw?.contracts?.teeVerifier) {
    contracts.teeVerifier = raw.contracts.teeVerifier as Address;
  }
  if (raw?.contracts?.validationRegistry) {
    contracts.validationRegistry = raw.contracts.validationRegistry as Address;
  }
  const deployment: NetworkDeployment = { contracts };
  if (raw?.name) deployment.name = raw.name;
  if (raw?.fromBlock !== undefined) {
    deployment.fromBlock = BigInt(raw.fromBlock);
  }
  return deployment;
}
