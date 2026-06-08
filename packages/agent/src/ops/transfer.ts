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
 *  3. Recipient receives the offer and calls `acceptTransferOffer(...)`.
 *  4. Sender receives the acceptance and submits `buildTransferTxArgs(...)`.
 */

import { AGENT_REGISTRY_ABI } from "../abis.js";
import { buildAccessPayloads } from "../proofs.js";
import type {
  AgentConfig,
  TransferAcceptance,
  TransferOffer,
  TransferOwnershipProof,
  TransferParams,
  TransferProofJson,
  TransferValidityProof,
} from "../types.js";
import { createPublicClient, http, type Address, type Hex } from "viem";

function asBigInt(value: string, label: string): bigint {
  if (!value) throw new Error(`${label} is required.`);
  return BigInt(value);
}

function normalizeOracleUrl(url: string): string {
  const normalized = url.trim().replace(/\/+$/, "");
  if (!normalized) throw new Error("oracleUrl is required.");
  return normalized;
}

function assertOffer(offer: TransferOffer): void {
  if (offer.schema !== "tee-agent.transfer.offer") {
    throw new Error("Invalid transfer offer schema.");
  }
  if (offer.version !== 1)
    throw new Error("Unsupported transfer offer version.");
  if (!offer.registryAddress)
    throw new Error("Offer registryAddress is required.");
  if (!offer.verifierAddress)
    throw new Error("Offer verifierAddress is required.");
  if (!offer.contractAddress)
    throw new Error("Offer contractAddress is required.");
  if (!offer.tokenId) throw new Error("Offer tokenId is required.");
  if (!offer.from) throw new Error("Offer from is required.");
  if (!offer.to) throw new Error("Offer to is required.");
  if (!offer.deadline) throw new Error("Offer deadline is required.");
  if (offer.accessPayloads.length !== offer.ownershipProofs.length) {
    throw new Error("Offer proof count mismatch.");
  }
}

function serializeProof(proof: TransferValidityProof): TransferProofJson {
  return {
    accessProof: proof.accessProof,
    ownershipProof: proof.ownershipProof,
    from: proof.from,
    to: proof.to,
    tokenId: proof.tokenId.toString(),
    deadline: proof.deadline.toString(),
  };
}

function deserializeProof(proof: TransferProofJson): TransferValidityProof {
  return {
    accessProof: proof.accessProof,
    ownershipProof: proof.ownershipProof,
    from: proof.from,
    to: proof.to,
    tokenId: BigInt(proof.tokenId),
    deadline: BigInt(proof.deadline),
  };
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

  const publicClient = createPublicClient({
    chain: config.chain,
    transport: http(config.rpcUrl),
  });
  const numericTokenId = BigInt(tokenId);
  const intelligentDatas = (await publicClient.readContract({
    address: config.registryAddress,
    abi: AGENT_REGISTRY_ABI,
    functionName: "intelligentDatasOf",
    args: [numericTokenId],
  })) as ReadonlyArray<{ dataDescription: string; dataHash: Hex }>;
  const currentHashes = intelligentDatas.map((item) => item.dataHash);
  if (currentHashes.length === 0) {
    throw new Error("Agent has no encrypted intelligent data to transfer.");
  }

  const [verifierAddress, from] = await Promise.all([
    publicClient.readContract({
      address: config.registryAddress,
      abi: AGENT_REGISTRY_ABI,
      functionName: "verifier",
      args: [],
    }) as Promise<Address>,
    publicClient.readContract({
      address: config.registryAddress,
      abi: AGENT_REGISTRY_ABI,
      functionName: "ownerOf",
      args: [numericTokenId],
    }) as Promise<Address>,
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

/**
 * Recipient-side helper. Signs the offer access payloads with the recipient
 * wallet and returns a JSON-safe acceptance object.
 */
export async function acceptTransferOffer(
  offer: TransferOffer,
  signFn: (digest: Hex) => Promise<Hex>,
): Promise<TransferAcceptance> {
  assertOffer(offer);
  const proofs = await Promise.all(
    offer.accessPayloads.map(async (payload, i) => {
      const ownershipProof = offer.ownershipProofs[i];
      if (!ownershipProof) {
        throw new Error(`Missing ownership proof for access payload ${i}.`);
      }
      const proof: TransferValidityProof = {
        accessProof: {
          dataHash: payload.dataHash,
          targetPubkey: payload.targetPubkey,
          nonce: payload.nonce,
          proof: await signFn(payload.digest),
        },
        ownershipProof,
        from: offer.from,
        to: offer.to,
        tokenId: BigInt(offer.tokenId),
        deadline: BigInt(offer.deadline),
      };
      return serializeProof(proof);
    }),
  );

  return {
    schema: "tee-agent.transfer.acceptance",
    version: 1,
    offer,
    proofs,
  };
}

/**
 * Lower-level helper retained for callers that already manage access payloads.
 */
export async function signAccessPayloads(
  signFn: (digest: Hex) => Promise<Hex>,
  accessPayloads: TransferOffer["accessPayloads"],
  ownershipProofs: TransferOwnershipProof[],
  opts: { from: Address; to: Address; tokenId: bigint; deadline: bigint },
): Promise<TransferValidityProof[]> {
  return Promise.all(
    accessPayloads.map(async (payload, i) => {
      const ownershipProof = ownershipProofs[i];
      if (!ownershipProof) {
        throw new Error(`Missing ownership proof for access payload ${i}.`);
      }
      return {
        accessProof: {
          dataHash: payload.dataHash,
          targetPubkey: payload.targetPubkey,
          nonce: payload.nonce,
          proof: await signFn(payload.digest),
        },
        ownershipProof,
        from: opts.from,
        to: opts.to,
        tokenId: opts.tokenId,
        deadline: opts.deadline,
      };
    }),
  );
}

/**
 * Sender-side finalization helper. Use the returned args with viem/ethers to
 * submit `AgentRegistry.iTransferFromWithIdentity`.
 */
export function buildTransferTxArgs(acceptance: TransferAcceptance): {
  address: Address;
  abi: typeof AGENT_REGISTRY_ABI;
  functionName: "iTransferFromWithIdentity";
  args: [Address, Address, bigint, TransferValidityProof[]];
} {
  if (acceptance.schema !== "tee-agent.transfer.acceptance") {
    throw new Error("Invalid transfer acceptance schema.");
  }
  if (acceptance.version !== 1) {
    throw new Error("Unsupported transfer acceptance version.");
  }
  assertOffer(acceptance.offer);
  if (acceptance.proofs.length !== acceptance.offer.ownershipProofs.length) {
    throw new Error("Acceptance proof count mismatch.");
  }
  const proofs = acceptance.proofs.map(deserializeProof);
  return {
    address: acceptance.offer.contractAddress,
    abi: AGENT_REGISTRY_ABI,
    functionName: "iTransferFromWithIdentity",
    args: [
      acceptance.offer.from,
      acceptance.offer.to,
      BigInt(acceptance.offer.tokenId),
      proofs,
    ],
  };
}
