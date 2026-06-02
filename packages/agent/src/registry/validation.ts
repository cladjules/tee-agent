import type { RegistryConfig } from "../types.js";
import type { Address, Hex, PublicClient } from "viem";
import { VALIDATION_REGISTRY_ABI, VALIDATION_STATUS_ABI } from "../abis.js";

export class ValidationRegistry {
  private readonly _addr: Address;
  private readonly _pc: PublicClient;

  constructor(config: RegistryConfig) {
    this._addr = config.address;
    this._pc = config.publicClient;
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
      (await this._pc.readContract({
        address: this._addr,
        abi: VALIDATION_STATUS_ABI,
        functionName: "getValidationStatus",
        args: [requestHash],
      })) as [Address, bigint, number, Hex, string, bigint];

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
