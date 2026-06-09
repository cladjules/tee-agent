/**
 * Two-party ERC-7857 transfer helpers.
 *
 * These helpers do not store pending transfers. Applications can persist the
 * returned JSON-safe `TransferOffer` / `TransferAcceptance` objects in Redis,
 * a database, local files, QR codes, IPFS, or any other message layer.
 *
 * Flow:
 *  1. Sender signs `ReencryptRequest` for the sender oracle.
 *  2. Sender calls `createTransferOffer(...)`.
 *  3. Recipient signs payloads returned by `getTransferAccessPayloadsToSign(...)`
 *     from `ops/transfer-acceptance`.
 *  4. Sender receives the acceptance and submits `buildTransferTxArgs(...)`
 *     from `ops/transfer-acceptance`.
 */

import { buildAccessPayloads } from "../proofs.js";
import { AgentRegistry } from "../registry/agent.js";
import type {
  AgentConfig,
  TransferOffer,
  TransferOwnershipProof,
  TransferParams,
} from "../types.js";

function asBigInt(value: string, label: string): bigint {
  if (!value) throw new Error(`${label} is required.`);
  return BigInt(value);
}

function normalizeOracleUrl(url: string): string {
  const normalized = url.trim().replace(/\/+$/, "");
  if (!normalized) throw new Error("oracleUrl is required.");
  return normalized;
}

/**
 * Sender-side helper. Creates a JSON-safe transfer offer after the sender oracle
 * has re-wrapped each encrypted content key for `recipientPublicKey`.
 *
 * The caller must first sign `buildReencryptTypedData(...)` with the current
 * owner wallet and pass that signature as `oracleSignature`.
 */
export async function createTransferOffer(
  config: AgentConfig,
  params: TransferParams,
): Promise<TransferOffer> {
  const { tokenId, to, oracleSignature, oracleDeadline } = params;

  if (!tokenId) throw new Error("Token ID is required.");
  if (!to) throw new Error("Recipient address is required.");
  if (!params.recipientPublicKey) {
    throw new Error("recipientPublicKey is required.");
  }
  if (!config.registryAddress) throw new Error("registryAddress is required.");
  if (!config.rpcUrl) throw new Error("rpcUrl is required.");
  if (!oracleSignature) {
    throw new Error(
      "oracleSignature is required. Sign ReencryptRequest with the owner wallet.",
    );
  }
  if (!oracleDeadline) throw new Error("oracleDeadline is required.");

  const registry = new AgentRegistry({
    address: config.registryAddress,
    chainId: config.chain.id,
    rpcUrl: config.rpcUrl,
  });
  const numericTokenId = BigInt(tokenId);
  const intelligentDatas = await registry.intelligentDatasOf(numericTokenId);
  const currentHashes = intelligentDatas.map((item) => item.dataHash);
  if (currentHashes.length === 0) {
    throw new Error("Agent has no encrypted intelligent data to transfer.");
  }

  const [verifierAddress, from] = await Promise.all([
    registry.verifier(),
    registry.ownerOf(numericTokenId),
  ]);
  const oracleUrl = normalizeOracleUrl(params.oracleUrl);
  const deadline = asBigInt(oracleDeadline, "oracleDeadline");
  const blobUris = intelligentDatas.map((d) => d.dataDescription);

  const oracleResponse = await fetch(`${oracleUrl}/reencrypt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tokenId,
      from,
      to,
      chainId: config.chain.id,
      verifierAddress,
      registryAddress: config.registryAddress,
      deadline: Number(deadline),
      intelligentDataHashes: currentHashes,
      blobUris,
      targetPubkey: params.recipientPublicKey,
      signature: oracleSignature,
    }),
  });

  if (!oracleResponse.ok) {
    const text = await oracleResponse.text().catch(() => "");
    throw new Error(
      `Oracle re-encryption failed: ${oracleResponse.status} ${text}`,
    );
  }

  const oracleResult = (await oracleResponse.json()) as {
    ownershipProofs?: TransferOwnershipProof[];
  };
  if (!oracleResult.ownershipProofs) {
    throw new Error("Oracle response missing ownershipProofs.");
  }
  if (oracleResult.ownershipProofs.length !== currentHashes.length) {
    throw new Error("Oracle response proof count mismatch.");
  }

  const accessPayloads = buildAccessPayloads({
    chainId: config.chain.id,
    verifierAddress,
    registryAddress: config.registryAddress,
    tokenId: numericTokenId,
    from,
    to,
    deadline,
    currentHashes,
    targetPubkey: params.recipientPublicKey,
  });

  return {
    schema: "tee-agent.transfer.offer",
    version: 1,
    chainId: config.chain.id,
    verifierAddress,
    registryAddress: config.registryAddress,
    contractAddress: config.registryAddress,
    tokenId,
    from,
    to,
    deadline: deadline.toString(),
    accessPayloads,
    ownershipProofs: oracleResult.ownershipProofs,
  };
}
