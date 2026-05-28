/**
 * @tee-agent/agent
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
  EncryptedBlob,
  ParsedServicesResult,
  ParseServicesOptions,
  SecureTransferPayloads,
  TransferAccessPayload,
  TransferOwnershipProof,
  TransferValidityProof,
  IpfsClientOptions,
  IpfsUploadResult,
  ZeroGStorageOptions,
  ZeroGReadOptions,
  ZeroGFlowUploadResult,
  AgentRegistryConfig,
  // Operation types
  AgentConfig,
  PrivateEntry,
  MintParams,
  MintResult,
  TransferParams,
  TransferResult,
  UpdateServicesParams,
  UpdateServicesResult,
  FetchAgentServicesParams,
  FetchAgentServicesResult,
  RegisteredAgent,
  AgentIntelligentDataEntry,
  ResolvedAgentProofData,
  PrepareFeedbackParams,
  PrepareFeedbackResult,
  PrepareValidationParams,
  PrepareValidationResult,
} from "./core/types.js";
export { RegistryError, NFTError } from "./core/types.js";

// ─── Chain config helpers ─────────────────────────────────────────────────────

export {
  CHAIN_NETWORKS,
  createConfig,
  defaultIdentityRegistry,
  defaultReputationRegistry,
} from "./core/config.js";
export type { ChainNetwork } from "./core/config.js";

// ─── Registry clients ────────────────────────────────────────────────────────────

export {
  AgentRegistry,
  IdentityRegistry,
  ReputationRegistry,
  ValidationRegistry,
} from "./core/registry.js";
export type { RegistryConfig } from "./core/registry.js";

// ─── Encryption / metadata helpers ───────────────────────────────────────────

export {
  generateContentKey,
  encryptMetadata,
  decryptContentKey,
  decryptMetadata,
  hashEncryptedBlob,
  buildAgentServiceTraits,
  buildDecryptMessage,
  buildSecureTransferPayloads,
  buildAccessPayloads,
  decryptEncryptedBlob,
  parseAgentServicesJson,
  readJsonFromUri,
  getPrivateMetadataEntries,
  encryptIntelligentData,
} from "./crypto/index.js";

// ─── IPFS client ──────────────────────────────────────────────────────────────

export { IpfsClient } from "./storage/ipfs.js";

// ─── 0G Storage client ────────────────────────────────────────────────────────

export {
  ZeroGStorageClient,
  uploadEncryptedIntelligentData,
  readZeroGJSON,
} from "./storage/zero-g.js";

// ─── Contract ABIs ────────────────────────────────────────────────────────────

export {
  AGENT_REGISTRY_ABI,
  AGENT_NFT_ABI,
  TEE_VERIFIER_ABI,
  VERIFIER_ABI,
  REPUTATION_REGISTRY_ABI,
  VALIDATION_REGISTRY_ABI,
  IDENTITY_REGISTRY_ABI,
  ERC721_ABI,
  VALIDATION_STATUS_ABI,
  REGISTERED_EVENT,
  VALIDATION_REQUEST_EVENT,
  VALIDATION_RESPONSE_EVENT,
} from "./abis.js";

// ─── High-level operations ────────────────────────────────────────────────────

export { prepareMint } from "./ops/mint.js";
export { prepareTransfer } from "./ops/transfer.js";
export {
  prepareUpdateServices,
  fetchAgentServices,
} from "./ops/agent-services.js";
export { prepareFeedback, prepareValidation } from "./ops/oracle.js";
export { resolveAgent, resolveAgentProofData } from "./ops/resolve.js";
