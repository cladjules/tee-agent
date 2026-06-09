import type {
  AgentIdentity,
  AgentRegistrationFile,
  ResolvedAgentProofData,
} from "../types.js";
import { createPublicClient, http, type Address, type Hex } from "viem";
import { AGENT_REGISTRY_ABI } from "../abis.js";
import { readJsonFromUri } from "../crypto.js";
import { DEFAULT_NETWORK, getNetworkConfigByChainId } from "../network.js";

export class AgentRegistry {
  private readonly _addr: Address;
  private readonly _pc;

  constructor(params: { address: Address; chainId: number; rpcUrl?: string }) {
    const network =
      getNetworkConfigByChainId(params.chainId) ?? DEFAULT_NETWORK;
    this._addr = params.address;
    this._pc = createPublicClient({
      chain: network.chain,
      transport: http(params.rpcUrl),
    });
    console.debug("initialised agentRegistry=%s", this._addr);
  }

  // ─── Raw contract getters ──────────────────────────────────────────────────

  async ownerOf(tokenId: bigint): Promise<Address> {
    return this._pc.readContract({
      address: this._addr,
      abi: AGENT_REGISTRY_ABI,
      functionName: "ownerOf",
      args: [tokenId],
    }) as Promise<Address>;
  }

  async tokenURI(tokenId: bigint): Promise<string> {
    return this._pc.readContract({
      address: this._addr,
      abi: AGENT_REGISTRY_ABI,
      functionName: "tokenURI",
      args: [tokenId],
    }) as Promise<string>;
  }

  async getMetadataUri(tokenId: bigint): Promise<string> {
    return this._pc.readContract({
      address: this._addr,
      abi: AGENT_REGISTRY_ABI,
      functionName: "getMetadataUri",
      args: [tokenId],
    }) as Promise<string>;
  }

  async getERC8004AgentId(tokenId: bigint): Promise<bigint> {
    return this._pc.readContract({
      address: this._addr,
      abi: AGENT_REGISTRY_ABI,
      functionName: "getERC8004AgentId",
      args: [tokenId],
    }) as Promise<bigint>;
  }

  async intelligentDatasOf(
    tokenId: bigint,
  ): Promise<ReadonlyArray<{ dataDescription: string; dataHash: Hex }>> {
    return this._pc.readContract({
      address: this._addr,
      abi: AGENT_REGISTRY_ABI,
      functionName: "intelligentDatasOf",
      args: [tokenId],
    }) as Promise<ReadonlyArray<{ dataDescription: string; dataHash: Hex }>>;
  }

  async verifier(): Promise<Address> {
    return this._pc.readContract({
      address: this._addr,
      abi: AGENT_REGISTRY_ABI,
      functionName: "verifier",
      args: [],
    }) as Promise<Address>;
  }

  async totalSupply(): Promise<bigint> {
    return this._pc.readContract({
      address: this._addr,
      abi: AGENT_REGISTRY_ABI,
      functionName: "totalSupply",
      args: [],
    }) as Promise<bigint>;
  }

  // ─── High-level operations ─────────────────────────────────────────────────

  async resolve(
    agentId: bigint,
  ): Promise<AgentIdentity & { metadata: AgentRegistrationFile }> {
    console.debug("resolve agentId=%s", agentId.toString());
    const [owner, publicMetadataUri, metadataUri] = await Promise.all([
      this.ownerOf(agentId),
      this.tokenURI(agentId),
      this.getMetadataUri(agentId),
    ]);

    if (!metadataUri) throw new Error(`agentId=${agentId} has no metadataUri`);
    const metadata = await readJsonFromUri<AgentRegistrationFile>(metadataUri);

    console.debug(
      "resolved agentId=%s owner=%s name=%s",
      agentId.toString(),
      owner,
      metadata.name,
    );

    return {
      agentId,
      owner,
      agentWallet: owner,
      publicMetadataUri,
      metadataUri,
      registeredAt: 0,
      metadata,
    };
  }

  /** Resolve all proof-related data for an agent (verifier, intelligentDatas, erc8004AgentId). */
  async resolveProofData(agentId: bigint): Promise<ResolvedAgentProofData> {
    const [verifierAddress, rawData, erc8004AgentIdRaw] = await Promise.all([
      this.verifier(),
      this.intelligentDatasOf(agentId),
      this.getERC8004AgentId(agentId),
    ]);
    return {
      verifierAddress,
      erc8004AgentId: erc8004AgentIdRaw.toString(),
      intelligentData: rawData.map((entry) => ({
        dataDescription: entry.dataDescription,
        dataHash: entry.dataHash,
      })),
    };
  }
}
