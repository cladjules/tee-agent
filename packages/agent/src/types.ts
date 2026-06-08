/**
 * Shared types for the Tee Agent.
 * All blockchain types use viem's primitives for consistency and type safety.
 */

import type { Address, Chain, Hex, PublicClient } from "viem";

// ─── Agent Identity / Registry (ERC-8004) ────────────────────────────────────

/** ERC-8004 compliant service endpoint */
export interface AgentService {
  readonly name: string;
  readonly endpoint: string;
  readonly version?: string;
  readonly skills?: readonly string[];
  readonly domains?: readonly string[];
}

/** ERC-8004 compliant agent metadata / registration file */
export interface AgentRegistrationFile {
  readonly type: "agent";
  readonly specVersion: "1.0";
  readonly name: string;
  readonly description: string;
  readonly image?: string;
  readonly version?: string;
  readonly services: readonly AgentService[];
  readonly x402Support?: boolean;
  readonly active?: boolean;
  readonly supportedTrust?: readonly (
    | "reputation"
    | "crypto-economic"
    | "tee-attestation"
  )[];
  readonly wallet?: Address;
  readonly owner?: Address;
  readonly registrationFileUri?: string;
  /** IPFS URI of the ERC-721 public metadata JSON (name/description/image/services). */
  readonly publicMetadataUri?: string;
}

/** On-chain agent identity record */
export interface AgentIdentity {
  readonly agentId: bigint;
  readonly owner: Address;
  readonly agentWallet?: Address;
  /** ERC-721 tokenURI — standard NFT metadata (name/description/image/attributes). */
  readonly publicMetadataUri: string;
  /** ERC-8004 agent registration metadata URI (services, capabilities, etc.). */
  readonly metadataUri: string;
  readonly registeredAt: number;
}

// ─── Agent NFT (ERC-7857) ─────────────────────────────────────────────────────

/** Public metadata stored on 0G Storage / on-chain */
export interface AgentNFTEncryptedData {
  readonly name: string;
  /** 0G Storage URI of the encrypted blob (`zerog://...`). */
  readonly uri: string;
  readonly hash: Hex;
}

// ─── Errors ───────────────────────────────────────────────────────────────────

export type RegistryErrorCode =
  | "AGENT_NOT_FOUND"
  | "AGENT_ALREADY_REGISTERED"
  | "UNAUTHORIZED"
  | "STORAGE_ERROR"
  | "CONTRACT_ERROR"
  | "INVALID_METADATA";

export class RegistryError extends Error {
  readonly code: RegistryErrorCode;
  constructor(code: RegistryErrorCode, message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "RegistryError";
    this.code = code;
  }
}

export type NFTErrorCode =
  | "TOKEN_NOT_FOUND"
  | "NOT_OWNER"
  | "ENCRYPTION_FAILED"
  | "DECRYPTION_FAILED"
  | "VERIFICATION_FAILED"
  | "STORAGE_ERROR";

export class NFTError extends Error {
  readonly code: NFTErrorCode;
  constructor(code: NFTErrorCode, message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "NFTError";
    this.code = code;
  }
}

// ─── Encryption (ERC-7857) ────────────────────────────────────────────────────

export interface EncryptedBlob {
  /** Name of the encrypted metadata */
  name: string;
  /** Hex-encoded AES-256-GCM ciphertext */
  ciphertext: string;
  /** Hex-encoded IV (12 bytes) */
  iv: string;
  /** Hex-encoded GCM auth tag (16 bytes) */
  authTag: string;
  /** Hex-encoded AES content key wrapped with ECIES */
  encryptedKey: string;
  /** Algorithm identifier */
  algorithm: "aes-256-gcm";
}

export type ParsedServicesResult = AgentService[];

export type ParseServicesOptions = {
  allowedServiceNames?: readonly string[];
};

export type TransferAccessPayload = {
  /** dataHash covered by this proof (matches the stored IntelligentData.dataHash). */
  dataHash: Hex;
  /** Recipient oracle public key used for ECIES key wrapping. */
  targetPubkey: Hex;
  /** bytes32 nonce — fixed-size prevents abi.encodePacked collisions (F-002). */
  nonce: Hex;
  /**
   * innerHash the recipient passes to signMessage({ message: digest }) to produce
   * AccessProof.proof.  signMessage adds the EIP-191 prefix, which matches
   * TeeVerifier.sol's Strings.toHexString / abi.encodePacked computation.
   */
  digest: Hex;
};

export type TransferOwnershipProof = {
  oracleType: number;
  dataHash: Hex;
  sealedKey: Hex;
  targetPubkey: Hex;
  /** bytes32 nonce — fixed-size prevents abi.encodePacked collisions (F-002). */
  nonce: Hex;
  /** Oracle's signature over the domain-bound innerHash. */
  proof: Hex;
};

// ─── IPFS ─────────────────────────────────────────────────────────────────────

export interface IpfsClientOptions {
  /** Pinata JWT (Bearer token). Defaults to PINATA_JWT env var. */
  jwt?: string;
  /** Pinata V3 uploads base URL. Defaults to https://uploads.pinata.cloud. */
  baseUrl?: string;
}

export interface IpfsUploadResult {
  /** IPFS CID */
  readonly cid: string;
  /** Canonical `ipfs://` URI */
  readonly url: string;
  /** Pinned byte size */
  readonly size: number;
}

// ─── AgentRegistry config ─────────────────────────────────────────────────────

/** Shared config shape for IdentityRegistry, ReputationRegistry, and ValidationRegistry. */
export interface RegistryConfig {
  address: Address;
  publicClient: PublicClient;
}

// ─── AgentConfig (shared by SDK, CLI, and any consumer) ──────────────────────

export type AgentConfig = {
  rpcUrl?: string;
  chain: Chain;
  registryAddress?: Address;
  /** Our TeeVerifier deployment for attested TEE oracle signatures. */
  teeVerifierAddress?: Address;
  /** ERC-8004 Identity Registry. */
  identityRegistryAddress?: Address;
  /** ERC-8004 Reputation Registry. */
  reputationRegistryAddress?: Address;
  /** Our own ValidationRegistry deployment. */
  validationRegistryAddress?: Address;
  /** Pinata JWT for IPFS uploads (agentMetadataUri). */
  pinataJwt?: string;
  /** Private key for 0G Storage upload transactions. */
  privateKey?: string;
  /** 0G Storage EVM RPC. */
  zeroGRpcUrl?: string;
  /** 0G Storage indexer URL. */
  zeroGIndexerUrl?: string;
};

// ─── Mint ─────────────────────────────────────────────────────────────────────

export type PrivateEntry = {
  name: string;
  data: string;
};

export type MintParams = {
  name: string;
  description: string;
  imageUrl?: string;
  agentType?: string;
  services?: AgentService[];
  x402Support?: boolean;
  privateEntries?: PrivateEntry[];
  oasfSkills?: string[];
  oasfDomains?: string[];
  ownerAddress: Address;
};

export type MintResult = {
  contractAddress: Address;
  agentRegistry: string;
  publicMetadataUri: string;
  agentMetadataUri: string;
  mintFee: string;
  intelligentData: Array<{ dataDescription: string; dataHash: Hex }>;
  /** TEE oracle signer returned by the minting teeOracle service's /address endpoint. */
  teeOracleAddress: Address;
  /**
   * ERC-8004 IdentityRegistry address. Present when the AgentRegistry has
   * co-registration enabled. Use with `prepareRegisterErc8004` post-mint.
   */
  erc8004RegistryAddress?: Address;
};

// ─── ERC-721 public metadata ─────────────────────────────────────────────────

export type AgentPublicMetadata = {
  name: string;
  description: string;
  image?: string;
  attributes?: Array<{
    trait_type: string;
    value: string | number | boolean;
    display_type?: string;
  }>;
};

export type PreparePublicMetadataUpdateParams = {
  tokenId: string;
  name: string;
  description: string;
  imageUrl?: string;
  agentType?: string;
  services?: readonly AgentService[];
  x402Support?: boolean;
  createdAt?: number;
};

export type PreparePublicMetadataUpdateResult = {
  contractAddress: Address;
  tokenId: string;
  publicMetadataUri: string;
  publicMetadata: AgentPublicMetadata;
};

// ─── Transfer ─────────────────────────────────────────────────────────────────

export type TransferParams = {
  tokenId: string;
  to: Address;
  oracleUrl: string;
  recipientPublicKey: Hex;
  oracleSignature: string;
  oracleDeadline: string;
};

export type TransferOffer = {
  schema: "tee-agent.transfer.offer";
  version: 1;
  chainId: number;
  verifierAddress: Address;
  registryAddress: Address;
  contractAddress: Address;
  tokenId: string;
  from: Address;
  to: Address;
  deadline: string;
  accessPayloads: TransferAccessPayload[];
  ownershipProofs: TransferOwnershipProof[];
};

export type TransferProofJson = {
  accessProof: {
    dataHash: Hex;
    targetPubkey: Hex;
    nonce: Hex;
    proof: Hex;
  };
  ownershipProof: TransferOwnershipProof;
  from: Address;
  to: Address;
  tokenId: string;
  deadline: string;
};

export type TransferAcceptance = {
  schema: "tee-agent.transfer.acceptance";
  version: 1;
  offer: TransferOffer;
  proofs: TransferProofJson[];
};

// ─── Services ─────────────────────────────────────────────────────────────────

export type UpdateServicesParams = {
  tokenId: string;
  servicesJson: any;
};

export type UpdateServicesResult = {
  erc8004RegistryAddress: Address;
  erc8004AgentId: string;
  tokenUri: string;
};

/**
 * Params for `prepareRegisterErc8004` — call post-mint with the value from
 * `getERC8004AgentId(tokenId)`.
 */
export type PrepareRegisterErc8004Params = {
  /** ERC-8004 agent ID assigned by the IdentityRegistry during mint. */
  erc8004AgentId: string;
  /** The `agentMetadataUri` from `MintResult` (passed as `metadataUri` to mint). */
  agentMetadataUri: string;
};

export type FetchAgentServicesParams = {
  tokenId: string;
  expectedOwner?: Address;
};

export type FetchAgentServicesResult = {
  services: AgentService[];
  agentName: string;
  metadataUri: string;
  teeOracleUrl?: string;
  metadataStorage: "ipfs" | "data" | "http";
};

export type VerifyTeeOracleResult = {
  url: string;
  address: Address;
  publicKey: Hex;
};

export type PrepareTeeOracleServiceUpdateParams = {
  erc8004AgentId: string;
  teeOracleUrl: string;
};

export type PrepareTeeOracleServiceUpdateResult = {
  erc8004RegistryAddress: Address;
  erc8004AgentId: string;
  tokenUri: string;
  teeOracleUrl: string;
};

export type PrepareImportedErc8004TeeOracleParams =
  PrepareTeeOracleServiceUpdateParams;

export type PrepareImportedErc8004TeeOracleResult =
  PrepareTeeOracleServiceUpdateResult;

// ─── Registry ─────────────────────────────────────────────────────────────────

export type RegisteredAgent = AgentIdentity & {
  metadata: AgentRegistrationFile;
};

export type AgentIntelligentDataEntry = {
  name?: string;
  dataDescription: string;
  dataHash: Hex;
};

export type ResolvedAgentProofData = {
  verifierAddress?: Address;
  erc8004AgentId?: string;
  intelligentData: AgentIntelligentDataEntry[];
};

// ─── Feedback ─────────────────────────────────────────────────────────────────

export type PrepareFeedbackParams = {
  agentId: string;
  value: number;
  tag1: string;
  tag2: string;
  feedbackJson?: string;
  feedbackFile?: File | null;
};

export type PrepareFeedbackResult = {
  contractAddress: Address;
  agentId: string;
  value: string;
  valueDecimals: number;
  tag1: string;
  tag2: string;
  feedbackURI: string;
};

// ─── Validation ───────────────────────────────────────────────────────────────

export type PrepareValidationParams = {
  agentId: string;
  validatorAddress: Address;
  requestURI?: string;
};

export type PrepareValidationResult = {
  contractAddress: Address;
  agentId: string;
  validatorAddress: Address;
  requestURI: string;
  requestHash: Hex;
};

// ─── Transfer validity proof (iTransferFrom on-chain struct) ──────────────────

/**
 * On-chain struct passed as each element of the `proofs[]` array to `iTransferFrom`.
 * SDK callers should usually pass a `TransferAcceptance` to `buildTransferTxArgs(...)`
 * instead of constructing these structs manually.
 */
export type TransferValidityProof = {
  accessProof: {
    dataHash: Hex;
    targetPubkey: Hex;
    nonce: Hex;
    /** Signed by the recipient wallet over `TransferAccessPayload.digest`. */
    proof: Hex;
  };
  ownershipProof: TransferOwnershipProof;
  from: Address;
  to: Address;
  tokenId: bigint;
  deadline: bigint;
};
