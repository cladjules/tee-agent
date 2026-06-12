import { createPublicClient, http, PublicClient, type Address } from "viem";
import { TEE_VERIFIER_ABI } from "../abis.js";
import { DEFAULT_NETWORK, getNetworkConfigByChainId } from "../network.js";

export class TeeVerifierRegistry {
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

  async isOracleRegistered(oracleAddress: Address): Promise<boolean> {
    return this._pc.readContract({
      address: this._addr,
      abi: TEE_VERIFIER_ABI,
      functionName: "isOracleRegistered",
      args: [oracleAddress],
    }) as Promise<boolean>;
  }
}
