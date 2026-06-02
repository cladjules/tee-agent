/**
 * EIP-712 typed-data builders for Tee Agent oracle requests.
 *
 * Browser-safe — no Node.js dependencies.
 * Shared by @tee-agent/sdk and the dashboard.
 *
 * All three oracle endpoints (/reencrypt, /run, /validate) verify an EIP-712
 * signature whose domain uses the oracle's TEE-derived address as the
 * verifyingContract, ensuring cross-oracle replay prevention.
 *
 * Call GET /address on the oracle to obtain { address, publicKey } first.
 */

import { keccak256 } from "viem";
import type { Address, Hex } from "viem";
import type {
  TransferAccessPayload,
  TransferOwnershipProof,
  TransferValidityProof,
} from "./types.js";

// ─── EIP-712 type schemas ─────────────────────────────────────────────────────
// Exported as plain mutable objects so they are compatible with both
// viem's signTypedData and ethers.verifyTypedData on the oracle side.

export const REENCRYPT_REQUEST_TYPES = {
  ReencryptRequest: [
    { name: "tokenId", type: "uint256" },
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "deadline", type: "uint256" },
  ],
};

export const RUN_REQUEST_TYPES = {
  RunRequest: [
    { name: "agentId", type: "uint256" },
    { name: "payloadHash", type: "bytes32" },
    { name: "deadline", type: "uint256" },
  ],
};

export const VALIDATE_REQUEST_TYPES = {
  ValidateRequest: [
    { name: "erc8004AgentId", type: "uint256" },
    { name: "requestHash", type: "bytes32" },
    { name: "payloadHash", type: "bytes32" },
    { name: "deadline", type: "uint256" },
  ],
};

// ─── Oracle domain ────────────────────────────────────────────────────────────

export function oracleDomain(oracleAddress: Address, chainId: number | bigint) {
  return {
    name: "TeeAgentOracle",
    version: "1",
    chainId: BigInt(chainId),
    verifyingContract: oracleAddress,
  } as const;
}

// ─── Typed-data param types ───────────────────────────────────────────────────

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
  erc8004AgentId: bigint;
  requestHash: Hex;
  payload: Record<string, unknown>;
  deadline: number | bigint;
};

// ─── Builders ─────────────────────────────────────────────────────────────────

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
        { name: "erc8004AgentId", type: "uint256" },
        { name: "requestHash", type: "bytes32" },
        { name: "payloadHash", type: "bytes32" },
        { name: "deadline", type: "uint256" },
      ],
    } as const,
    primaryType: "ValidateRequest" as const,
    message: {
      erc8004AgentId: params.erc8004AgentId,
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
