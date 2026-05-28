/**
 * @tee-agent/sdk
 *
 * Developer-facing SDK for Tee Agent. All types and core business logic
 * live in @tee-agent/agent (the source of truth). This package adds:
 *
 *   1. Full re-exports of everything from @tee-agent/agent
 *   2. EIP-712 typed-data builders — so callers can sign oracle requests
 *      with their wallet without hardcoding the schema everywhere
 *   3. signAccessPayloads — builds the TransferValidityProof[] for iTransferFrom
 *   4. TX arg builders — ready-to-use writeContract params for every on-chain call
 *   5. createAgentSdk(config) — bound factory for standalone SDK consumers
 *
 * Monorepo consumers typically import from @tee-agent/agent/* directly.
 * External / standalone consumers import from @tee-agent/sdk.
 */

// ─── Local imports (also re-exported below) ───────────────────────────────────

import { keccak256 } from "viem";
import type { Address, Hex } from "viem";
import {
  AGENT_REGISTRY_ABI,
  IDENTITY_REGISTRY_ABI,
} from "@tee-agent/agent/abis";
import type {
  AgentConfig,
  MintParams,
  MintResult,
  TransferParams,
  TransferResult,
  UpdateServicesParams,
  UpdateServicesResult,
  FetchAgentServicesParams,
  PrepareFeedbackParams,
  PrepareValidationParams,
  TransferAccessPayload,
  TransferOwnershipProof,
  TransferValidityProof,
} from "@tee-agent/agent/types";
import { prepareMint } from "@tee-agent/agent/mint";
import { prepareTransfer } from "@tee-agent/agent/transfer";
import {
  prepareUpdateServices,
  fetchAgentServices,
} from "@tee-agent/agent/agent-services";
import { prepareFeedback, prepareValidation } from "@tee-agent/agent/oracle";
import { resolveAgent, resolveAgentProofData } from "@tee-agent/agent/resolve";

// ─── Pure passthrough re-exports ─────────────────────────────────────────────

export type {
  // Core entity types
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
  IpfsClientOptions,
  IpfsUploadResult,
  ZeroGStorageOptions,
  ZeroGReadOptions,
  ZeroGFlowUploadResult,
  AgentRegistryConfig,
  // Config + operation types
  ClientConfig,
  ServerConfig,
  PrivateEntry,
  FetchAgentServicesResult,
  RegisteredAgent,
  AgentIntelligentDataEntry,
  ResolvedAgentProofData,
  PrepareFeedbackResult,
  PrepareValidationResult,
} from "@tee-agent/agent/types";

// Locally-imported types re-exported explicitly
export type {
  AgentConfig,
  MintParams,
  MintResult,
  TransferParams,
  TransferResult,
  UpdateServicesParams,
  UpdateServicesResult,
  FetchAgentServicesParams,
  PrepareFeedbackParams,
  PrepareValidationParams,
  TransferAccessPayload,
  TransferOwnershipProof,
  TransferValidityProof,
};

export { RegistryError, NFTError } from "@tee-agent/agent/types";

export {
  CHAIN_NETWORKS,
  createConfig,
  defaultIdentityRegistry,
  defaultReputationRegistry,
} from "@tee-agent/agent/config";
export type { ChainNetwork } from "@tee-agent/agent/types";

export {
  AGENT_NFT_ABI,
  TEE_VERIFIER_ABI,
  VERIFIER_ABI,
  REPUTATION_REGISTRY_ABI,
  VALIDATION_REGISTRY_ABI,
  ERC721_ABI,
  VALIDATION_STATUS_ABI,
  REGISTERED_EVENT,
  VALIDATION_REQUEST_EVENT,
  VALIDATION_RESPONSE_EVENT,
} from "@tee-agent/agent/abis";

// Locally-imported ABIs re-exported explicitly
export { AGENT_REGISTRY_ABI, IDENTITY_REGISTRY_ABI };

export {
  AgentRegistry,
  IdentityRegistry,
  ReputationRegistry,
  ValidationRegistry,
} from "@tee-agent/agent/registry";
export type { RegistryConfig } from "@tee-agent/agent/registry";
export {
  generateContentKey,
  encryptMetadata,
  decryptMetadata,
  hashEncryptedBlob,
  buildDecryptMessage,
  buildSecureTransferPayloads,
  buildAccessPayloads,
  decryptEncryptedBlob,
  parseAgentServicesJson,
  readJsonFromUri,
} from "@tee-agent/agent/encryption";

// Locally-imported ops re-exported explicitly
export {
  prepareMint,
  prepareTransfer,
  prepareUpdateServices,
  fetchAgentServices,
  prepareFeedback,
  prepareValidation,
  resolveAgent,
  resolveAgentProofData,
};

// ─── EIP-712 Oracle typed-data builders ──────────────────────────────────────
//
// All three oracle endpoints (/reencrypt, /run, /validate) verify an EIP-712
// signature whose domain uses the oracle's TEE-derived address as the
// verifyingContract, ensuring cross-oracle replay prevention.
//
// Call GET /address on the oracle to obtain { address, publicKey } first.
// ─────────────────────────────────────────────────────────────────────────────

export type ReencryptTypedDataParams = {
  oracleAddress: Address;
  chainId: number | bigint;
  tokenId: bigint;
  from: Address;
  to: Address;
  deadline: number | bigint;
};

export type RunTypedDataParams = {
  oracleAddress: Address;
  chainId: number | bigint;
  agentId: bigint;
  payload: Record<string, unknown>;
  deadline: number | bigint;
};

export type ValidateTypedDataParams = {
  oracleAddress: Address;
  chainId: number | bigint;
  agentId: bigint;
  requestHash: Hex;
  payload: Record<string, unknown>;
  deadline: number | bigint;
};

function oracleDomain(oracleAddress: Address, chainId: number | bigint) {
  return {
    name: "TeeAgentOracle",
    version: "1",
    chainId: BigInt(chainId),
    verifyingContract: oracleAddress,
  } as const;
}

/**
 * Build EIP-712 typed data for the oracle's `/reencrypt` endpoint.
 * The current token owner signs this to authorise the secure transfer.
 *
 * @example
 * ```ts
 * const td = buildReencryptTypedData({ oracleAddress, chainId, tokenId, from, to, deadline });
 * const sig = await walletClient.signTypedData({ ...td, account });
 * ```
 */
export function buildReencryptTypedData(params: ReencryptTypedDataParams) {
  return {
    domain: oracleDomain(params.oracleAddress, params.chainId),
    types: {
      ReencryptRequest: [
        { name: "tokenId", type: "uint256" },
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "deadline", type: "uint256" },
      ],
    } as const,
    primaryType: "ReencryptRequest" as const,
    message: {
      tokenId: params.tokenId,
      from: params.from,
      to: params.to,
      deadline: BigInt(params.deadline),
    },
  };
}

/**
 * Build EIP-712 typed data for the oracle's `/run` endpoint.
 * The agent owner signs this to invoke the skill handler inside the TEE.
 *
 * @example
 * ```ts
 * const td = buildRunTypedData({ oracleAddress, chainId, agentId, payload, deadline });
 * const sig = await walletClient.signTypedData({ ...td, account });
 * ```
 */
export function buildRunTypedData(params: RunTypedDataParams) {
  const payloadHash = keccak256(
    new TextEncoder().encode(JSON.stringify(params.payload)),
  );
  return {
    domain: oracleDomain(params.oracleAddress, params.chainId),
    types: {
      RunRequest: [
        { name: "agentId", type: "uint256" },
        { name: "payloadHash", type: "bytes32" },
        { name: "deadline", type: "uint256" },
      ],
    } as const,
    primaryType: "RunRequest" as const,
    message: {
      agentId: params.agentId,
      payloadHash,
      deadline: BigInt(params.deadline),
    },
  };
}

/**
 * Build EIP-712 typed data for the oracle's `/validate` endpoint.
 * The agent owner signs this to trigger on-chain validation scoring.
 *
 * @example
 * ```ts
 * const td = buildValidateTypedData({ oracleAddress, chainId, agentId, requestHash, payload, deadline });
 * const sig = await walletClient.signTypedData({ ...td, account });
 * ```
 */
export function buildValidateTypedData(params: ValidateTypedDataParams) {
  const payloadHash = keccak256(
    new TextEncoder().encode(JSON.stringify(params.payload)),
  );
  return {
    domain: oracleDomain(params.oracleAddress, params.chainId),
    types: {
      ValidateRequest: [
        { name: "agentId", type: "uint256" },
        { name: "requestHash", type: "bytes32" },
        { name: "payloadHash", type: "bytes32" },
        { name: "deadline", type: "uint256" },
      ],
    } as const,
    primaryType: "ValidateRequest" as const,
    message: {
      agentId: params.agentId,
      requestHash: params.requestHash,
      payloadHash,
      deadline: BigInt(params.deadline),
    },
  };
}

// ─── Access payload signing ───────────────────────────────────────────────────

/**
 * Sign access payloads returned by `prepareTransfer` and assemble the
 * `TransferValidityProof[]` array expected by `iTransferFrom`.
 *
 * The `signFn` should be the **new owner's** wallet sign function.
 * Pass `payload.digest` directly — the digest is the domain-bound innerHash
 * that includes the EIP-191 prefix when signed with signMessage.
 *
 * @example
 * ```ts
 * const proofs = await signAccessPayloads(
 *   (digest) => walletClient.signMessage({ account, message: digest }),
 *   transfer.accessPayloads,
 *   transfer.ownershipProofs,
 *   { from: transfer.from!, to: transfer.to, tokenId: BigInt(transfer.tokenId), deadline: transfer.deadline! },
 * );
 * await walletClient.writeContract(buildTransferTxArgs(transfer, transfer.from!, proofs));
 * ```
 */
export async function signAccessPayloads(
  signFn: (digest: Hex) => Promise<Hex>,
  accessPayloads: TransferAccessPayload[],
  ownershipProofs: TransferOwnershipProof[],
  opts: { from: Address; to: Address; tokenId: bigint; deadline: bigint },
): Promise<TransferValidityProof[]> {
  return Promise.all(
    accessPayloads.map(async (payload, i) => ({
      accessProof: {
        dataHash: payload.dataHash,
        targetPubkey: payload.targetPubkey,
        nonce: payload.nonce,
        proof: await signFn(payload.digest),
      },
      ownershipProof: ownershipProofs[i] ?? {
        oracleType: 0,
        dataHash: payload.dataHash,
        sealedKey: "0x" as Hex,
        targetPubkey: payload.targetPubkey,
        nonce: payload.nonce,
        proof: "0x" as Hex,
      },
      from: opts.from,
      to: opts.to,
      tokenId: opts.tokenId,
      deadline: opts.deadline,
    })),
  );
}

// ─── TX arg builders ──────────────────────────────────────────────────────────
//
// These return objects you can spread directly into walletClient.writeContract().
// Always call the corresponding prepare* function first and check for errors.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build `writeContract` args for the standard `mint` function.
 *
 * @example
 * ```ts
 * const mint = await sdk.prepareMint(params);
 * if ('error' in mint) throw new Error(mint.error);
 * await walletClient.writeContract({ ...buildMintTxArgs(mint, ownerAddress), account, chain });
 * ```
 */
export function buildMintTxArgs(
  result: Extract<MintResult, { error?: never }>,
  ownerAddress: Address,
) {
  return {
    address: result.contractAddress,
    abi: AGENT_REGISTRY_ABI,
    functionName: "mint" as const,
    args: [
      ownerAddress,
      result.publicMetadataUri,
      result.agentMetadataUri,
      result.intelligentData,
    ] as const,
    value: BigInt(result.mintFee),
  };
}

/**
 * Build `writeContract` args for `mintWithExisting8004` — use when importing
 * an existing ERC-8004 identity into the new agent NFT.
 */
export function buildMintWithExisting8004TxArgs(
  result: Extract<MintResult, { error?: never }>,
  ownerAddress: Address,
  erc8004AgentId: bigint,
) {
  return {
    address: result.contractAddress,
    abi: AGENT_REGISTRY_ABI,
    functionName: "mintWithExisting8004" as const,
    args: [
      ownerAddress,
      result.publicMetadataUri,
      erc8004AgentId,
      result.intelligentData,
    ] as const,
    value: BigInt(result.mintFee),
  };
}

/**
 * Build `writeContract` args for `iTransferFrom`.
 * Call `signAccessPayloads` first to produce the `validityProofs` array.
 */
export function buildTransferTxArgs(
  result: Extract<TransferResult, { error?: never }>,
  from: Address,
  validityProofs: TransferValidityProof[],
) {
  return {
    address: result.contractAddress,
    abi: AGENT_REGISTRY_ABI,
    functionName: "iTransferFrom" as const,
    args: [from, result.to, BigInt(result.tokenId), validityProofs] as const,
  };
}

/**
 * Build `writeContract` args for `setAgentURI` on the ERC-8004 Identity Registry.
 * Call `prepareUpdateServices` first to produce the `result`.
 */
export function buildUpdateServicesTxArgs(
  result: Extract<UpdateServicesResult, { error?: never }>,
) {
  return {
    address: result.erc8004RegistryAddress,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: "setAgentURI" as const,
    args: [BigInt(result.erc8004AgentId), result.tokenUri] as const,
  };
}

// ─── Bound SDK factory ────────────────────────────────────────────────────────

/**
 * Create a bound SDK instance. All operation methods have `config` pre-applied.
 * Signing helpers and TX builders are also available on the returned object.
 *
 * @example
 * ```ts
 * const sdk = createAgentSdk({ rpcUrl, chain, registryAddress, oracleUrl, pinataJwt });
 * const mint = await sdk.prepareMint({ name, description, ownerAddress, ... });
 * if ('error' in mint) throw new Error(mint.error);
 * await walletClient.writeContract({ ...sdk.buildMintTxArgs(mint, ownerAddress), account, chain });
 * ```
 */
export function createAgentSdk(config: AgentConfig) {
  return {
    config,

    // ── Operations ──────────────────────────────────────────────────────────
    prepareMint: (params: MintParams) => prepareMint(config, params),
    prepareTransfer: (params: TransferParams) =>
      prepareTransfer(config, params),
    prepareUpdateServices: (params: UpdateServicesParams) =>
      prepareUpdateServices(config, params),
    fetchAgentServices: (params: FetchAgentServicesParams) =>
      fetchAgentServices(config, params),
    prepareFeedback: (params: PrepareFeedbackParams) =>
      prepareFeedback(config, params),
    prepareValidation: (params: PrepareValidationParams) =>
      prepareValidation(config, params),
    resolveAgent: (agentId: bigint) => resolveAgent(config, agentId),
    resolveAgentProofData: (agentId: bigint) =>
      resolveAgentProofData(config, agentId),

    // ── EIP-712 builders (chain pre-filled from config) ───────────────────
    buildReencryptTypedData: (
      params: Omit<ReencryptTypedDataParams, "chainId">,
    ) => buildReencryptTypedData({ chainId: config.chain.id, ...params }),
    buildRunTypedData: (params: Omit<RunTypedDataParams, "chainId">) =>
      buildRunTypedData({ chainId: config.chain.id, ...params }),
    buildValidateTypedData: (
      params: Omit<ValidateTypedDataParams, "chainId">,
    ) => buildValidateTypedData({ chainId: config.chain.id, ...params }),

    // ── Signing + TX builder passthrough ─────────────────────────────────
    signAccessPayloads,
    buildMintTxArgs,
    buildMintWithExisting8004TxArgs,
    buildTransferTxArgs,
    buildUpdateServicesTxArgs,
  };
}
