/**
 * Shared types for the Open Agents Toolkit.
 * All blockchain types use viem's primitives for consistency and type safety.
 */

import type { Address, Hex } from "viem";

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
}

/** On-chain agent identity record */
export interface AgentIdentity {
  readonly agentId: bigint;
  readonly owner: Address;
  readonly agentWallet?: Address;
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
