import { createPublicClient, http, type Address } from "viem";
import { IDENTITY_REGISTRY_ABI } from "../abis.js";
import { DEFAULT_NETWORK, getNetworkConfigByChainId } from "../network.js";

export class IdentityRegistry {
  private readonly _addr: Address;
  private readonly _pc;

  constructor(params: { chainId: number; rpcUrl?: string }) {
    const network =
      getNetworkConfigByChainId(params.chainId) ?? DEFAULT_NETWORK;
    this._addr = network.identityRegistryAddress;
    this._pc = createPublicClient({
      chain: network.chain,
      transport: http(params.rpcUrl),
    });
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

  async getApproved(agentId: bigint): Promise<Address> {
    return this._pc.readContract({
      address: this._addr,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: "getApproved",
      args: [agentId],
    }) as Promise<Address>;
  }

  async isApprovedForAll(owner: Address, operator: Address): Promise<boolean> {
    return this._pc.readContract({
      address: this._addr,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: "isApprovedForAll",
      args: [owner, operator],
    }) as Promise<boolean>;
  }
}
