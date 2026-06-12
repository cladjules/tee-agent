import {
  createPublicClient,
  http,
  PublicClient,
  type Address,
  type Hex,
} from "viem";
import { VALIDATION_REGISTRY_ABI, VALIDATION_STATUS_ABI } from "../abis.js";
import { DEFAULT_NETWORK, getNetworkConfigByChainId } from "../network.js";

export class ValidationRegistry {
  private readonly _addr: Address;
  private readonly _pc: PublicClient;

  constructor(params: { address: Address; chainId: number; rpcUrl?: string }) {
    const network =
      getNetworkConfigByChainId(params.chainId) ?? DEFAULT_NETWORK;
    this._addr = params.address;
    this._pc = createPublicClient({
      chain: network.chain,
      transport: http(params.rpcUrl),
    });
  }

  async getAgentValidations(agentId: bigint): Promise<Hex[]> {
    return this._pc.readContract({
      address: this._addr,
      abi: VALIDATION_REGISTRY_ABI,
      functionName: "getAgentValidations",
      args: [agentId],
    }) as Promise<Hex[]>;
  }

  async getValidationStatus(requestHash: Hex): Promise<{
    validatorAddress: Address;
    agentId: bigint;
    response: number;
    responseHash: Hex;
    tag: string;
    lastUpdate: bigint;
  }> {
    const [validatorAddress, agentId, response, responseHash, tag, lastUpdate] =
      await this._pc.readContract({
        address: this._addr,
        abi: VALIDATION_STATUS_ABI,
        functionName: "getValidationStatus",
        args: [requestHash],
      });

    return {
      validatorAddress,
      agentId,
      response,
      responseHash,
      tag,
      lastUpdate,
    };
  }

  async getSummary(
    agentId: bigint,
    validatorAddresses: Address[],
    tag: string,
  ): Promise<{ count: bigint; averageResponse: number }> {
    const [count, averageResponse] = (await this._pc.readContract({
      address: this._addr,
      abi: VALIDATION_REGISTRY_ABI,
      functionName: "getSummary",
      args: [agentId, validatorAddresses, tag],
    })) as [bigint, number];
    return { count, averageResponse };
  }
}
