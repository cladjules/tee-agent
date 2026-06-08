import type { RegistryConfig } from "../types.js";
import type { Address, PublicClient } from "viem";
import { TEE_VERIFIER_ABI } from "../abis.js";

export class TeeVerifierRegistry {
  private readonly _addr: Address;
  private readonly _pc: PublicClient;

  constructor(config: RegistryConfig) {
    this._addr = config.address;
    this._pc = config.publicClient;
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
