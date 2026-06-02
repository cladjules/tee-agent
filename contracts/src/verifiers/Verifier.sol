// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "./TeeVerifier.sol";
import "../interfaces/IERC7857.sol";

/**
 * @title Verifier
 * @notice IERC7857DataVerifier implementation that validates ERC-7857 transfer proofs.
 *
 * Each TransferValidityProof pair consists of:
 *   1. AccessProof  — signed by the receiver (or their delegated assistant) to prove
 *                     they can access the data for the given dataHash.
 *   2. OwnershipProof — signed by the TEE oracle to prove the sender owns the data and
 *                       that the re-encrypted key has been delivered to the receiver.
 *
 * Signing format (domain-bound to prevent cross-chain and cross-token replay, F-001):
 *   innerHash = keccak256(abi.encode(
 *       block.chainid, address(this), msg.sender,   // chain + verifier + caller (registry)
 *       tokenId, from, to, deadline,                // transfer context
 *       dataHash, [sealedKey,] targetPubkey, nonce  // proof-specific fields
 *   ))
 *   messageHash = keccak256("\x19Ethereum Signed Message:\n66" || toHexString(innerHash, 32))
 *
 * Using abi.encode (not abi.encodePacked) with a fixed-size bytes32 nonce prevents
 * hash collisions between adjacent dynamic fields (F-002).
 *
 * Replay-attack protection: used proof nonces are recorded as permanent tombstones.
 * Records are never deleted — deleting them would allow replay of proofs observable
 * in historical transaction calldata (F-003).
 *
 * Non-upgradeable: uses Ownable and regular state variables.
 */
contract Verifier is IERC7857DataVerifier, Ownable, Pausable, ReentrancyGuard {
    using ECDSA for bytes32;

    /// @dev Once set to true a nonce can never be reused. Records are permanent tombstones.
    mapping(bytes32 => bool) private _usedProofs;

    address private _teeVerifier;

    event TeeVerifierUpdated(
        address indexed oldVerifier,
        address indexed newVerifier
    );

    constructor(address admin_, address teeVerifier_) Ownable(admin_) {
        require(admin_ != address(0), "Invalid admin");
        require(teeVerifier_ != address(0), "Invalid tee verifier");
        _teeVerifier = teeVerifier_;
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    function updateTeeVerifier(address newTeeVerifier) external onlyOwner {
        require(newTeeVerifier != address(0), "Invalid tee verifier");
        address old = _teeVerifier;
        _teeVerifier = newTeeVerifier;
        emit TeeVerifierUpdated(old, newTeeVerifier);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ─── Internal verification helpers ───────────────────────────────────────

    /// @dev Computes nonce hash bound to the caller to prevent cross-caller replay.
    function _hashNonce(bytes32 nonce) private view returns (bytes32) {
        return keccak256(abi.encode(nonce, msg.sender));
    }

    function _checkAndMarkProof(bytes32 proofNonce) private {
        require(!_usedProofs[proofNonce], "Proof already used");
        _usedProofs[proofNonce] = true;
    }

    /// @dev Verifies the access proof signature (from receiver / access assistant).
    ///      Domain: chainId + verifier + registry + tokenId + from + to + deadline + fields.
    ///      Returns the recovered signer address (= the access assistant).
    function _verifyAccessibility(
        TransferValidityProof calldata proof
    ) private view returns (address) {
        bytes32 innerHash = keccak256(
            abi.encode(
                block.chainid,
                address(this),
                msg.sender,
                proof.tokenId,
                proof.from,
                proof.to,
                proof.deadline,
                proof.accessProof.dataHash,
                proof.accessProof.targetPubkey,
                proof.accessProof.nonce
            )
        );
        bytes32 messageHash = keccak256(
            abi.encodePacked(
                "\x19Ethereum Signed Message:\n66",
                Strings.toHexString(uint256(innerHash), 32)
            )
        );
        address accessAssistant = messageHash.recover(proof.accessProof.proof);
        require(accessAssistant != address(0), "Invalid access assistant");
        return accessAssistant;
    }

    /// @dev Verifies the ownership proof signature (from TEE oracle).
    ///      Domain: chainId + verifier + registry + tokenId + from + to + deadline + fields.
    function _verifyOwnershipProof(
        TransferValidityProof calldata proof
    ) private view returns (bool) {
        if (proof.ownershipProof.oracleType == OracleType.TEE) {
            bytes32 innerHash = keccak256(
                abi.encode(
                    block.chainid,
                    address(this),
                    msg.sender,
                    proof.tokenId,
                    proof.from,
                    proof.to,
                    proof.deadline,
                    proof.ownershipProof.dataHash,
                    proof.ownershipProof.sealedKey,
                    proof.ownershipProof.targetPubkey,
                    proof.ownershipProof.nonce
                )
            );
            bytes32 messageHash = keccak256(
                abi.encodePacked(
                    "\x19Ethereum Signed Message:\n66",
                    Strings.toHexString(uint256(innerHash), 32)
                )
            );
            return
                TeeVerifier(_teeVerifier).verifyTEESignature(
                    messageHash,
                    proof.ownershipProof.proof
                );
        }
        // ZKP type: not yet implemented
        return false;
    }

    function _processTransferProof(
        TransferValidityProof calldata proof
    ) private view returns (TransferValidityProofOutput memory output) {
        require(block.timestamp <= proof.deadline, "Proof expired");
        require(
            proof.accessProof.dataHash == proof.ownershipProof.dataHash,
            "Invalid dataHash"
        );

        output.dataHash = proof.accessProof.dataHash;
        output.wantedKey = proof.accessProof.targetPubkey;
        output.accessProofNonce = proof.accessProof.nonce;
        output.targetPubkey = proof.ownershipProof.targetPubkey;
        output.sealedKey = proof.ownershipProof.sealedKey;
        output.ownershipProofNonce = proof.ownershipProof.nonce;

        output.accessAssistant = _verifyAccessibility(proof);

        require(_verifyOwnershipProof(proof), "Invalid ownership proof");
    }

    // ─── IERC7857DataVerifier ─────────────────────────────────────────────────

    /// @inheritdoc IERC7857DataVerifier
    function verifyTransferValidity(
        TransferValidityProof[] calldata proofs
    )
        public
        virtual
        override
        whenNotPaused
        nonReentrant
        returns (TransferValidityProofOutput[] memory)
    {
        TransferValidityProofOutput[]
            memory outputs = new TransferValidityProofOutput[](proofs.length);

        for (uint256 i = 0; i < proofs.length; i++) {
            TransferValidityProofOutput memory output = _processTransferProof(
                proofs[i]
            );
            outputs[i] = output;

            _checkAndMarkProof(_hashNonce(output.accessProofNonce));
            _checkAndMarkProof(_hashNonce(output.ownershipProofNonce));
        }

        return outputs;
    }

}
