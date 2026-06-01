import type { RegistryConfig } from "../types.js";
import type { Address, PublicClient } from "viem";
import { REPUTATION_REGISTRY_ABI } from "../../abis.js";

export class ReputationRegistry {
  readonly address: Address;
  private readonly _pc: PublicClient;

  constructor(config: RegistryConfig) {
    this.address = config.address;
    this._pc = config.publicClient;
    console.debug("initialised reputationRegistry=%s", config.address);
  }

  async getLastIndex(agentId: bigint, clientAddress: Address): Promise<bigint> {
    return this._pc.readContract({
      address: this.address,
      abi: REPUTATION_REGISTRY_ABI,
      functionName: "getLastIndex",
      args: [agentId, clientAddress],
    }) as Promise<bigint>;
  }

  async readFeedback(
    agentId: bigint,
    clientAddress: Address,
    feedbackIndex: bigint,
  ): Promise<{
    value: bigint;
    valueDecimals: number;
    tag1: string;
    tag2: string;
    isRevoked: boolean;
  }> {
    const [value, valueDecimals, tag1, tag2, isRevoked] =
      (await this._pc.readContract({
        address: this.address,
        abi: REPUTATION_REGISTRY_ABI,
        functionName: "readFeedback",
        args: [agentId, clientAddress, feedbackIndex],
      })) as [bigint, number, string, string, boolean];
    return { value, valueDecimals, tag1, tag2, isRevoked };
  }

  async getSummary(
    agentId: bigint,
    clientAddresses: Address[],
    tag1: string,
    tag2: string,
  ): Promise<{
    count: bigint;
    summaryValue: bigint;
    summaryValueDecimals: number;
  }> {
    const [count, summaryValue, summaryValueDecimals] =
      (await this._pc.readContract({
        address: this.address,
        abi: REPUTATION_REGISTRY_ABI,
        functionName: "getSummary",
        args: [agentId, clientAddresses, tag1, tag2],
      })) as [bigint, bigint, number];
    return { count, summaryValue, summaryValueDecimals };
  }
}
