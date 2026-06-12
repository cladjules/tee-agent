import {
  createPublicClient,
  http,
  PublicClient,
  type Address,
  type Hex,
} from "viem";
import { REPUTATION_REGISTRY_ABI } from "../abis.js";
import { DEFAULT_NETWORK, getNetworkConfigByChainId } from "../network.js";

type NewFeedbackLog = {
  args: {
    agentId?: bigint;
    clientAddress?: Address;
    feedbackIndex?: bigint;
    value?: bigint;
    valueDecimals?: number;
    tag1?: string;
    tag2?: string;
    endpoint?: string;
    feedbackURI?: string;
    feedbackHash?: Hex;
  };
};

export class ReputationRegistry {
  readonly address: Address;
  private readonly _pc: PublicClient;

  constructor(params: { chainId: number; rpcUrl?: string }) {
    const network =
      getNetworkConfigByChainId(params.chainId) ?? DEFAULT_NETWORK;
    this.address = network.reputationRegistryAddress;
    this._pc = createPublicClient({
      chain: network.chain,
      transport: http(params.rpcUrl),
    });
    console.debug("initialised reputationRegistry=%s", this.address);
  }

  async getLastIndex(agentId: bigint, clientAddress: Address): Promise<bigint> {
    return this._pc.readContract({
      address: this.address,
      abi: REPUTATION_REGISTRY_ABI,
      functionName: "getLastIndex",
      args: [agentId, clientAddress],
    }) as Promise<bigint>;
  }

  async getClients(agentId: bigint): Promise<Address[]> {
    return this._pc.readContract({
      address: this.address,
      abi: REPUTATION_REGISTRY_ABI,
      functionName: "getClients",
      args: [agentId],
    }) as Promise<Address[]>;
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

  async readAllFeedback(
    agentId: bigint,
    clientAddresses: Address[],
    tag1: string,
    tag2: string,
    includeRevoked: boolean,
  ): Promise<{
    clients: Address[];
    feedbackIndexes: bigint[];
    values: bigint[];
    valueDecimals: number[];
    tag1s: string[];
    tag2s: string[];
    revokedStatuses: boolean[];
  }> {
    const [
      clients,
      feedbackIndexes,
      values,
      valueDecimals,
      tag1s,
      tag2s,
      revokedStatuses,
    ] = (await this._pc.readContract({
      address: this.address,
      abi: REPUTATION_REGISTRY_ABI,
      functionName: "readAllFeedback",
      args: [agentId, clientAddresses, tag1, tag2, includeRevoked],
    })) as [
      Address[],
      bigint[],
      bigint[],
      number[],
      string[],
      string[],
      boolean[],
    ];

    return {
      clients,
      feedbackIndexes,
      values,
      valueDecimals,
      tag1s,
      tag2s,
      revokedStatuses,
    };
  }

  async getNewFeedbackEvents(
    agentId: bigint,
    fromBlock: bigint = 0n,
  ): Promise<
    {
      client: Address;
      feedbackIndex: bigint;
      endpoint: string;
      feedbackURI: string;
      feedbackHash: Hex;
    }[]
  > {
    const logs = (await this._pc.getContractEvents({
      address: this.address,
      abi: REPUTATION_REGISTRY_ABI,
      eventName: "NewFeedback",
      args: { agentId },
      fromBlock,
      toBlock: "latest",
    })) as unknown as NewFeedbackLog[];

    return logs.flatMap((log) => {
      if (
        !log.args.clientAddress ||
        log.args.feedbackIndex === undefined ||
        !log.args.feedbackURI ||
        !log.args.feedbackHash
      ) {
        return [];
      }

      return [
        {
          client: log.args.clientAddress,
          feedbackIndex: log.args.feedbackIndex,
          endpoint: log.args.endpoint ?? "",
          feedbackURI: log.args.feedbackURI,
          feedbackHash: log.args.feedbackHash,
        },
      ];
    });
  }
}
