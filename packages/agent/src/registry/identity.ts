import type { RegistryConfig } from "../types.js";
import type { Address, PublicClient } from "viem";
import { IDENTITY_REGISTRY_ABI } from "../abis.js";

export class IdentityRegistry {
  private readonly _addr: Address;
  private readonly _pc: PublicClient;

  constructor(config: RegistryConfig) {
    this._addr = config.address;
    this._pc = config.publicClient;
  }

  async ownerOf(agentId: bigint): Promise<Address> {
    return this._pc.readContract({
      address: this._addr,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: "ownerOf",
      args: [agentId],
    }) as Promise<Address>;
  }

  async tokenURI(agentId: bigint): Promise<string> {
    return this._pc.readContract({
      address: this._addr,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: "tokenURI",
      args: [agentId],
    }) as Promise<string>;
  }
}
