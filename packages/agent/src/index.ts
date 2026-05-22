/**
 * @open-agents-toolkit/agent
 *
 * ERC-7857 AI Agent NFTs with private encrypted metadata and
 * ERC-8004 on-chain registry client.
 */

// ─── Shared types ─────────────────────────────────────────────────────────────

export type {
  AgentService,
  AgentRegistrationFile,
  AgentIdentity,
  AgentNFTEncryptedData,
  RegistryErrorCode,
  NFTErrorCode,
} from "./types.js";
export { RegistryError, NFTError } from "./types.js";

// ─── AgentRegistry client (ERC-8004 read) ────────────────────────────────────

export { AgentRegistry } from "./registry.js";
export type { AgentRegistryConfig } from "./registry.js";

// ─── Encryption / metadata helpers ───────────────────────────────────────────

export {
  generateContentKey,
  encryptMetadata,
  decryptMetadata,
  hashEncryptedBlob,
  buildAgentServiceTraits,
  buildDecryptMessage,
  buildSecureTransferPayloads,
  decryptEncryptedBlob,
  parseAgentServicesJson,
  readJsonFromUri,
  encryptIntelligentData,
} from "./encryption.js";

export type {
  EncryptedBlob,
  ParseServicesOptions,
  ParsedServicesResult,
  SecureTransferPayloads,
  TransferAccessPayload,
  TransferOwnershipProof,
} from "./encryption.js";
// ─── Contract ABIs ────────────────────────────────────────────────────────────

export {
  AGENT_REGISTRY_ABI,
  AGENT_NFT_ABI,
  TEE_VERIFIER_ABI,
  VERIFIER_ABI,
} from "./abis.js";
