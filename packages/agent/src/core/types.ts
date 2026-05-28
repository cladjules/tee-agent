/**
 * Shared types for the Tee Agent.
 * All blockchain types use viem's primitives for consistency and type safety.
 */

import type { Address, Chain, Hex, PublicClient } from "viem";
import type { ChainNetwork } from "./config.js";

export type { ChainNetwork };

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

export type ParsedServicesResult = {
  services?: AgentService[];
  error?: string;
};

export type ParseServicesOptions = {
  allowedServiceNames?: readonly string[];
};

export type TransferAccessPayload = {
  /** dataHash covered by this proof (matches the stored IntelligentData.dataHash). */
  dataHash: Hex;
  /** Recipient's public key (ECIES-compressed) or ABI-encoded address for dev. */
  targetPubkey: Hex;
  /** bytes32 nonce — fixed-size prevents abi.encodePacked collisions (F-002). */
  nonce: Hex;
  /**
   * innerHash the recipient passes to signMessage({ message: digest }) to produce
   * AccessProof.proof.  signMessage adds the EIP-191 prefix, which matches
   * Verifier.sol's Strings.toHexString / abi.encodePacked computation.
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

export type SecureTransferPayloads = {
  from: Address;
  to: Address;
  tokenId: bigint;
  deadline: bigint;
  newDataHashes: Hex[];
  sealedKey: Hex;
  accessPayloads: TransferAccessPayload[];
  ownershipProofs: TransferOwnershipProof[];
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

// ─── 0G Storage ───────────────────────────────────────────────────────────────

export interface ZeroGStorageOptions {
  /** 0x-prefixed hex private key used to sign upload transactions */
  privateKey: string;
  /**
   * EVM RPC endpoint for the 0G storage network.
   * Defaults to ZERO_G_RPC_URL env var or the 0G testnet public RPC.
   */
  rpcUrl?: string;
  /**
   * 0G Indexer RPC URL.
   * Defaults to ZERO_G_INDEXER_URL env var or the 0G testnet standard indexer.
   */
  indexerUrl?: string;
}

export interface ZeroGReadOptions {
  /**
   * 0G Indexer RPC URL.
   * Defaults to ZERO_G_INDEXER_URL env var or the 0G testnet standard indexer.
   */
  indexerUrl?: string;
}

/** Result shape returned by ZeroGStorageClient.uploadJSON / uploadBytes */
export interface ZeroGFlowUploadResult {
  readonly cid: string;
  readonly url: string;
  readonly size: number;
}

// ─── AgentRegistry config ─────────────────────────────────────────────────────

export interface AgentRegistryConfig {
  agentRegistryAddress: Address;
  publicClient: PublicClient;
}

// ─── AgentConfig (shared by SDK, CLI, and any consumer) ──────────────────────

export type AgentConfig = {
  rpcUrl: string;
  chain: Chain;
  registryAddress: Address;
  /** ERC-8004 Identity Registry. Defaults to official singleton for the chain. */
  identityRegistryAddress?: Address;
  /** ERC-8004 Reputation Registry. Defaults to official singleton for the chain. */
  reputationRegistryAddress?: Address;
  /** Our own ValidationRegistry deployment. */
  validationRegistryAddress?: Address;
  teeVerifierAddress?: Address;
  /** Phala Cloud TDX oracle base URL. */
  oracleUrl?: string;
  /** Pinata JWT for IPFS uploads (agentMetadataUri). */
  pinataJwt?: string;
  /** Private key for 0G Storage upload transactions. */
  zeroGPrivateKey?: string;
  /** 0G Storage EVM RPC (default: https://evmrpc-testnet.0g.ai). */
  zeroGRpcUrl?: string;
  /** 0G Storage indexer URL (default: turbo testnet indexer). */
  zeroGIndexerUrl?: string;
};

// ─── App Config ───────────────────────────────────────────────────────────────

/**
 * Client-safe application config — safe to use in browser / SSR contexts.
 * Contains only non-secret data: public addresses, network id, oracle URL.
 */
export type ClientConfig = {
  /** Active chain network identifier. */
  network: ChainNetwork;
  /** Deployed AgentRegistry (ERC-721 / ERC-7857). */
  registryAddress: Address | undefined;
  /** ERC-8004 Reputation Registry. Defaults to official singleton for the chain. */
  reputationAddress: Address;
  /** Our own ValidationRegistry deployment. */
  validationAddress: Address | undefined;
  /** Phala Cloud TEE oracle base URL. */
  oracleUrl: string;
};

/**
 * Server-side application config. Extends ClientConfig with secrets and
 * chain metadata. Never expose to the browser.
 */
export type ServerConfig = ClientConfig & {
  /** Official ERC-8004 Identity Registry singleton for the active chain. */
  identityRegistryAddress: Address;
  /** Deployed TEEVerifier contract. */
  teeVerifierAddress: Address | undefined;
  /** EVM RPC URL for the app chain. */
  rpcUrl: string | undefined;
  /** Deployer / server-side signer key (32-byte hex). */
  deployerKey: Hex | undefined;
  /** Key for 0G Storage uploads; falls back to deployerKey. */
  zeroGKey: Hex | undefined;
  /** 0G Storage EVM RPC endpoint. */
  zeroGRpcUrl: string | undefined;
  /** 0G Storage indexer URL. */
  zeroGIndexerUrl: string | undefined;
  /** Pinata JWT for IPFS metadata uploads. */
  pinataJwt: string | undefined;
  /** Starting block for Registered event log queries. */
  registryFromBlock: bigint;
  /** viem Chain object for the active network. */
  chain: Chain;
  /** Chain ID of the active network. */
  chainId: number;
  /** True when the minimum required env vars are set. */
  isConfigured: boolean;
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

export type MintResult =
  | {
      contractAddress: Address;
      agentRegistry: string;
      publicMetadataUri: string;
      agentMetadataUri: string;
      mintFee: string;
      intelligentData: Array<{ dataDescription: string; dataHash: Hex }>;
      error?: never;
    }
  | { error: string };

// ─── Transfer ─────────────────────────────────────────────────────────────────

export type TransferParams = {
  tokenId: string;
  to: Address;
  newOwnerPublicKey?: Hex;
  oracleSignature?: string;
  oracleDeadline?: string;
};

export type TransferResult =
  | {
      contractAddress: Address;
      tokenId: string;
      from?: Address;
      to: Address;
      deadline?: bigint;
      newDataHashes: Hex[];
      sealedKey: Hex;
      accessPayloads: Array<{
        dataHash: Hex;
        targetPubkey: Hex;
        nonce: Hex;
        digest: Hex;
      }>;
      ownershipProofs: Array<{
        oracleType: number;
        dataHash: Hex;
        sealedKey: Hex;
        targetPubkey: Hex;
        nonce: Hex;
        proof: Hex;
      }>;
      error?: never;
    }
  | { error: string };

// ─── Services ─────────────────────────────────────────────────────────────────

export type UpdateServicesParams = {
  tokenId: string;
  servicesJson: string;
};

export type UpdateServicesResult =
  | {
      erc8004RegistryAddress: Address;
      erc8004AgentId: string;
      tokenUri: string;
      error?: never;
    }
  | { error: string };

export type FetchAgentServicesParams = {
  tokenId: string;
  ownerAddress: string;
};

export type FetchAgentServicesResult =
  | { services: AgentService[]; agentName: string }
  | { error: string };

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
  contractAddress?: Address;
  agentId?: string;
  value?: string;
  valueDecimals?: number;
  tag1?: string;
  tag2?: string;
  feedbackURI?: string;
  error?: string;
};

// ─── Validation ───────────────────────────────────────────────────────────────

export type PrepareValidationParams = {
  agentId: string;
  validatorAddress: Address;
  requestURI?: string;
};

export type PrepareValidationResult = {
  contractAddress?: Address;
  agentId?: string;
  validatorAddress?: Address;
  requestURI?: string;
  requestHash?: Hex;
  error?: string;
};

// ─── Transfer validity proof (iTransferFrom on-chain struct) ──────────────────

/**
 * On-chain struct passed as each element of the `proofs[]` array to `iTransferFrom`.
 * Build these with `sdk.signAccessPayloads(...)` after the oracle re-encrypts.
 */
export type TransferValidityProof = {
  accessProof: {
    dataHash: Hex;
    targetPubkey: Hex;
    nonce: Hex;
    /** Signed by the recipient wallet over `TransferAccessPayload.digest`. */
    proof: Hex;
  };
  ownershipProof: {
    oracleType: number;
    dataHash: Hex;
    sealedKey: Hex;
    targetPubkey: Hex;
    nonce: Hex;
    /** Signed by the TEE oracle. */
    proof: Hex;
  };
  from: Address;
  to: Address;
  tokenId: bigint;
  deadline: bigint;
};
