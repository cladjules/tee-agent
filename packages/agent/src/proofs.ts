/**
 * Browser-safe proof helpers for ERC-7857 transfers.
 */

import { encodeAbiParameters, keccak256 } from "viem";
import type { Address, Hex } from "viem";
import type { TransferAccessPayload } from "./types.js";

// ---------------------------------------------------------------------------
// Domain-bound proof helpers — match TeeVerifier.sol signing scheme exactly.
//
// innerHash = keccak256(abi.encode(
//   chainId, verifierAddr, registryAddr,  // chain + contract domain
//   tokenId, from, to, deadline,          // transfer context
//   dataHash, targetPubkey, nonce         // proof-specific fields
// ))
//
// messageHash = keccak256("\x19Ethereum Signed Message:\n66" + toHexString(innerHash, 32))
//
// abi.encode + bytes32 nonce prevents hash collisions.
// ---------------------------------------------------------------------------

function computeAccessInnerHash(
  chainId: bigint,
  verifierAddress: Address,
  registryAddress: Address,
  tokenId: bigint,
  from: Address,
  to: Address,
  deadline: bigint,
  dataHash: Hex,
  targetPubkey: Hex,
  nonce: Hex,
): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "address" },
        { type: "address" },
        { type: "uint256" },
        { type: "address" },
        { type: "address" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "bytes" },
        { type: "bytes32" },
      ],
      [
        chainId,
        verifierAddress,
        registryAddress,
        tokenId,
        from,
        to,
        deadline,
        dataHash,
        targetPubkey,
        nonce,
      ],
    ),
  );
}

/**
 * Build unsigned access payloads for the oracle path.
 *
 * The oracle has already generated ownership proofs. This function computes
 * the access proof digests that the recipient signs before assembling the
 * TransferValidityProof[] structs.
 */
export function buildAccessPayloads(params: {
  chainId: number;
  verifierAddress: Address;
  registryAddress: Address;
  tokenId: bigint;
  from: Address;
  to: Address;
  deadline: bigint;
  currentHashes: readonly Hex[];
  targetPubkey: Hex;
}): TransferAccessPayload[] {
  const {
    chainId,
    verifierAddress,
    registryAddress,
    tokenId,
    from,
    to,
    deadline,
    currentHashes,
    targetPubkey,
  } = params;

  return currentHashes.map((dataHash, index) => {
    const nonce = keccak256(
      encodeAbiParameters(
        [{ type: "uint256" }, { type: "uint256" }, { type: "string" }],
        [tokenId, BigInt(index), "access"],
      ),
    );
    const innerHash = computeAccessInnerHash(
      BigInt(chainId),
      verifierAddress,
      registryAddress,
      tokenId,
      from,
      to,
      deadline,
      dataHash,
      targetPubkey,
      nonce,
    );
    return {
      dataHash,
      targetPubkey,
      nonce,
      digest: innerHash,
    };
  });
}
