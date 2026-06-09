import { AGENT_REGISTRY_ABI } from "../abis.js";
import type {
  TransferAcceptance,
  TransferAccessSignature,
  TransferAccessSignatureRequest,
  TransferOffer,
  TransferProofJson,
  TransferValidityProof,
} from "../types.js";
import type { Address } from "viem";

function assertOffer(offer: TransferOffer): void {
  if (offer.schema !== "tee-agent.transfer.offer") {
    throw new Error("Invalid transfer offer schema.");
  }
  if (offer.version !== 1) {
    throw new Error("Unsupported transfer offer version.");
  }
  if (!offer.registryAddress) {
    throw new Error("Offer registryAddress is required.");
  }
  if (!offer.verifierAddress) {
    throw new Error("Offer verifierAddress is required.");
  }
  if (!offer.contractAddress) {
    throw new Error("Offer contractAddress is required.");
  }
  if (!offer.tokenId) throw new Error("Offer tokenId is required.");
  if (!offer.from) throw new Error("Offer from is required.");
  if (!offer.to) throw new Error("Offer to is required.");
  if (!offer.deadline) throw new Error("Offer deadline is required.");
  if (offer.accessPayloads.length !== offer.ownershipProofs.length) {
    throw new Error("Offer proof count mismatch.");
  }
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

export function getTransferAccessPayloadsToSign(
  offer: TransferOffer,
): TransferAccessSignatureRequest[] {
  assertOffer(offer);
  return offer.accessPayloads.map((payload, index) => ({
    index,
    dataHash: payload.dataHash,
    targetPubkey: payload.targetPubkey,
    nonce: payload.nonce,
    digest: payload.digest,
  }));
}

export function buildTransferAcceptance(
  offer: TransferOffer,
  signatures: readonly TransferAccessSignature[],
): TransferAcceptance {
  assertOffer(offer);
  if (signatures.length !== offer.accessPayloads.length) {
    throw new Error("Signature count mismatch.");
  }

  const signatureByIndex = new Map(
    signatures.map((signature) => [signature.index, signature.proof]),
  );
  const proofs: TransferProofJson[] = offer.accessPayloads.map(
    (payload, index) => {
      const ownershipProof = offer.ownershipProofs[index];
      if (!ownershipProof) {
        throw new Error(`Missing ownership proof for access payload ${index}.`);
      }
      const proof = signatureByIndex.get(index);
      if (!proof) {
        throw new Error(`Missing access signature for payload ${index}.`);
      }
      return {
        accessProof: {
          dataHash: payload.dataHash,
          targetPubkey: payload.targetPubkey,
          nonce: payload.nonce,
          proof,
        },
        ownershipProof,
        from: offer.from,
        to: offer.to,
        tokenId: offer.tokenId,
        deadline: offer.deadline,
      };
    },
  );

  return {
    schema: "tee-agent.transfer.acceptance",
    version: 1,
    offer,
    proofs,
  };
}

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
