// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.35;

/// @notice Oracle type: TEE (trusted execution environment) or ZKP (zero-knowledge proof).
enum OracleType {
    TEE,
    ZKP
}

/// @notice Signed by the receiver (or their access assistant) proving they can access the data.
struct AccessProof {
    bytes32 dataHash;
    bytes targetPubkey;
    bytes32 nonce; // fixed-size to prevent abi.encodePacked collisions (F-002)
    bytes proof;
}

/// @notice Signed by the TEE oracle (or ZKP verifier) proving data ownership and key delivery.
struct OwnershipProof {
    OracleType oracleType;
    bytes32 dataHash;
    bytes sealedKey;
    bytes targetPubkey;
    bytes32 nonce; // fixed-size to prevent abi.encodePacked collisions (F-002)
    bytes proof;
}

/// @notice A pair of access + ownership proofs, one per intelligent data item.
/// @dev    from/to/tokenId/deadline are included in both proof signatures for domain binding (F-001).
struct TransferValidityProof {
    AccessProof accessProof;
    OwnershipProof ownershipProof;
    address from; // token sender — must be signed by both access and ownership proofs
    address to; // token recipient — must be signed by both access and ownership proofs
    uint256 tokenId; // token being transferred — prevents cross-token replay
    uint256 deadline; // Unix timestamp; verifier rejects proofs after this time (F-004)
}

/// @notice Decoded output from a verified TransferValidityProof.
struct TransferValidityProofOutput {
    bytes32 dataHash;
    bytes sealedKey;
    bytes targetPubkey;
    bytes wantedKey;
    address accessAssistant;
    bytes32 accessProofNonce; // matches AccessProof.nonce (bytes32)
    bytes32 ownershipProofNonce; // matches OwnershipProof.nonce (bytes32)
}

/// @notice Unified verifier interface for ERC-7857 transfer proofs and ERC-8004 validations.
interface IAgentDataVerifier {
    /// @notice Verify that each proof shows:
    ///   1. The data is accessible to the target receiver.
    ///   2. The data is owned by the sender.
    ///   3. The data key is delivered (sealed) to the receiver.
    function verifyTransferValidity(
        TransferValidityProof[] calldata proofs
    ) external returns (TransferValidityProofOutput[] memory);

    /// @dev Implementations may call external attestation services (e.g. Automata DCAP),
    ///      so this is non-view. Any ETH forwarded via msg.value is passed through to cover
    ///      on-chain attestation fees.
    function verifyValidation(
        uint256 agentId,
        bytes32 requestHash,
        uint8 response,
        bytes calldata proof
    ) external payable returns (bool valid);
}
