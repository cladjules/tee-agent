/**
 * Registry clients — typed wrappers around viem readContract for every
 * on-chain registry used by Tee Agent.
 *
 *   AgentRegistry       — our ERC-721 / ERC-7857 contract
 *   IdentityRegistry    — ERC-8004 Identity Registry (official singleton)
 *   ReputationRegistry  — ERC-8004 Reputation Registry (official singleton)
 *   ValidationRegistry  — our ValidationRegistry deployment
 */

import type {
  AgentIdentity,
  AgentRegistrationFile,
  AgentRegistryConfig,
  AgentIntelligentDataEntry,
  ResolvedAgentProofData,
} from "./types.js";
import type { Address, Hex, PublicClient } from "viem";
import {
  AGENT_REGISTRY_ABI,
  IDENTITY_REGISTRY_ABI,
  VALIDATION_STATUS_ABI,
} from "../abis.js";
import { readJsonFromUri } from "../crypto/index.js";
import { readZeroGJSON } from "../storage/zero-g.js";

/** Shared config shape for all registries except AgentRegistry (which has its own legacy shape). */
export interface RegistryConfig {
  address: Address;
  publicClient: PublicClient;
}

// ─── AgentRegistry ────────────────────────────────────────────────────────────

export class AgentRegistry {
  private readonly _cfg: AgentRegistryConfig;
  private get _pc() {
    return this._cfg.publicClient;
  }
  private get _addr() {
    return this._cfg.agentRegistryAddress;
  }

  constructor(config: AgentRegistryConfig) {
    this._cfg = config;
    console.debug("initialised agentRegistry=%s", config.agentRegistryAddress);
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

    const metadata = metadataUri.startsWith("zerog://")
      ? await readZeroGJSON<AgentRegistrationFile>(metadataUri)
      : metadataUri
        ? await readJsonFromUri<AgentRegistrationFile>(metadataUri)
        : (() => {
            throw new Error(`agentId=${agentId} has no metadataUri`);
          })();

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
    const [verifierAddress, rawData, erc8004AgentIdRaw, tokenUri] =
      await Promise.all([
        this.verifier(),
        this.intelligentDatasOf(agentId),
        this.getERC8004AgentId(agentId),
        this.tokenURI(agentId),
      ]);

    const publicMeta = await readJsonFromUri<{
      intelligentData?: { name?: string; uri?: string; hash?: string }[];
    }>(tokenUri).catch(() => ({ intelligentData: [] }));

    const byHash = new Map(
      (publicMeta.intelligentData ?? []).map((e) => [
        (e.hash ?? "").toLowerCase(),
        e,
      ]),
    );

    const intelligentData: AgentIntelligentDataEntry[] = rawData.map(
      (entry) => {
        const mapped = byHash.get(entry.dataHash.toLowerCase());
        const resolvedDescription =
          !entry.dataDescription.startsWith("data:") &&
          !entry.dataDescription.startsWith("http") &&
          mapped?.uri
            ? mapped.uri
            : entry.dataDescription;
        const result: AgentIntelligentDataEntry = {
          dataDescription: resolvedDescription,
          dataHash: entry.dataHash,
        };
        if (mapped?.name !== undefined) result.name = mapped.name;
        return result;
      },
    );

    return {
      verifierAddress,
      erc8004AgentId: erc8004AgentIdRaw.toString(),
      intelligentData,
    };
  }
}

// ─── IdentityRegistry (ERC-8004) ──────────────────────────────────────────────

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

// ─── ReputationRegistry (ERC-8004) ────────────────────────────────────────────

export class ReputationRegistry {
  readonly address: Address;

  constructor(config: RegistryConfig) {
    this.address = config.address;
    console.debug("initialised reputationRegistry=%s", config.address);
  }

  // Reputation read methods — expanded as reputation features are implemented.
  // See REPUTATION_REGISTRY_ABI for available functions.
}

// ─── ValidationRegistry ───────────────────────────────────────────────────────

export class ValidationRegistry {
  private readonly _addr: Address;
  private readonly _pc: PublicClient;

  constructor(config: RegistryConfig) {
    this._addr = config.address;
    this._pc = config.publicClient;
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
}
