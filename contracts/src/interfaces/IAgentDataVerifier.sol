// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

enum OracleType {
    TEE,
    ZKP
}

struct AccessProof {
    bytes32 oldDataHash;
    bytes32 newDataHash;
    bytes nonce;
    bytes encryptedPubKey;
    bytes proof;
}

struct OwnershipProof {
    OracleType oracleType;
    bytes32 oldDataHash;
    bytes32 newDataHash;
    bytes sealedKey;
    bytes encryptedPubKey;
    bytes nonce;
    bytes proof;
}

struct TransferValidityProof {
    AccessProof accessProof;
    OwnershipProof ownershipProof;
}

struct TransferValidityProofOutput {
    bytes32 oldDataHash;
    bytes32 newDataHash;
    bytes sealedKey;
    bytes encryptedPubKey;
    bytes wantedKey;
    address accessAssistant;
    bytes accessProofNonce;
    bytes ownershipProofNonce;
}

interface IAgentDataVerifier {
    function verifyTransferValidity(
        TransferValidityProof[] calldata proofs
    ) external returns (TransferValidityProofOutput[] memory outputs);

    function verifySignature(
        uint256 tokenId,
        address from,
        address to,
        bytes32[] calldata oldDataHashes,
        bytes32[] calldata newDataHashes,
        bytes calldata proof
    ) external view returns (bool valid);

    function verifyValidation(
        uint256 agentId,
        bytes32 requestHash,
        uint8 response,
        bytes calldata proof
    ) external view returns (bool valid);
}
