// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "../interfaces/IAgentDataVerifier.sol";

/// @dev Minimal interface for Automata DCAP on-chain attestation (fee variant).
interface IAutomataDcapAttestationFee {
    function verifyAndAttestOnChain(
        bytes calldata rawQuote
    ) external payable returns (bool success, bytes memory output);
}

/**
 * @title TeeVerifier
 * @notice ERC-7857 transfer verifier and ERC-8004 validation verifier for Phala Cloud TDX oracle proofs.
 */
contract TeeVerifier is
    Ownable,
    Pausable,
    ReentrancyGuard,
    IAgentDataVerifier
{
    using ECDSA for bytes32;

    /// @dev Automata AutomataDcapAttestationFee contract.
    address public immutable DCAP_ATTESTATION;

    uint256 private constant QUOTE_REPORT_DATA_OFFSET = 568; // 48 (header) + 520 (body offset to reportData)
    uint256 private constant REPORT_DATA_LENGTH = 64;

    mapping(address => bool) private _registeredOracles;
    mapping(bytes32 => bool) private _usedProofs;

    error InvalidProofLength();
    error DcapVerificationFailed();
    error QuoteTooShort();
    error OracleAddressMismatch();

    event OracleRegistered(address indexed oracle);
    event OracleRevoked(address indexed oracle);
    event ValidatorInitialized(
        address indexed oracleAddress,
        bytes32 indexed quoteHash
    );

    constructor(address admin_, address dcapAttestation_) Ownable(admin_) {
        require(admin_ != address(0), "Invalid admin");
        require(dcapAttestation_ != address(0), "Invalid DCAP attestation");
        DCAP_ATTESTATION = dcapAttestation_;
    }

    /**
     * @notice Trustless oracle key registration via on-chain DCAP attestation.
     * @dev The quote reportData must start with the oracle Ethereum address.
     */
    function initValidator(
        address oracleAddress,
        bytes calldata rawQuote
    ) external payable {
        require(oracleAddress != address(0), "Invalid oracle address");
        if (rawQuote.length < QUOTE_REPORT_DATA_OFFSET + REPORT_DATA_LENGTH)
            revert QuoteTooShort();

        (bool success, ) = IAutomataDcapAttestationFee(DCAP_ATTESTATION)
            .verifyAndAttestOnChain{value: msg.value}(rawQuote);
        if (!success) revert DcapVerificationFailed();

        bytes
            memory reportDataBytes = rawQuote[QUOTE_REPORT_DATA_OFFSET:QUOTE_REPORT_DATA_OFFSET +
                REPORT_DATA_LENGTH];

        address quotedOracleAddress;
        assembly {
            quotedOracleAddress := shr(96, mload(add(reportDataBytes, 32)))
        }
        if (quotedOracleAddress != oracleAddress)
            revert OracleAddressMismatch();

        _registeredOracles[oracleAddress] = true;
        emit ValidatorInitialized(oracleAddress, keccak256(rawQuote));
        emit OracleRegistered(oracleAddress);
    }

    /// @notice Verify a 65-byte ECDSA signature over dataHash was produced by the TEE oracle.
    function verifyTEESignature(
        bytes32 dataHash,
        bytes calldata signature
    ) external view returns (bool) {
        require(signature.length == 65, "Invalid signature length");
        address signer = dataHash.recover(signature);
        return _registeredOracles[signer];
    }

    /**
     * @notice Verify a per-request TDX-attested validation response (IAgentDataVerifier interface).
     * @dev Verifies DCAP quotes only. Local development uses MockDcapAttestation.
     */
    function verifyValidation(
        uint256 agentId,
        bytes32 requestHash,
        uint8 response,
        bytes calldata proof
    ) external payable override returns (bool) {
        bytes32 commitment = keccak256(
            abi.encodePacked(agentId, requestHash, response)
        );

        if (proof.length < QUOTE_REPORT_DATA_OFFSET + 32)
            revert InvalidProofLength();

        (bool success, ) = IAutomataDcapAttestationFee(DCAP_ATTESTATION)
            .verifyAndAttestOnChain{value: msg.value}(proof);
        if (!success) revert DcapVerificationFailed();

        bytes32 reportData;
        assembly {
            reportData := calldataload(
                add(proof.offset, QUOTE_REPORT_DATA_OFFSET)
            )
        }

        return reportData == commitment;
    }

    /// @notice Revoke a previously registered oracle signing address (admin only).
    function revokeOracleAddress(address oracleAddress) external onlyOwner {
        require(oracleAddress != address(0), "Invalid oracle address");
        _registeredOracles[oracleAddress] = false;
        emit OracleRevoked(oracleAddress);
    }

    function isOracleRegistered(
        address oracleAddress
    ) external view returns (bool) {
        return _registeredOracles[oracleAddress];
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @dev Computes nonce hash bound to the caller to prevent cross-caller replay.
    function _hashNonce(bytes32 nonce) private view returns (bytes32) {
        return keccak256(abi.encode(nonce, msg.sender));
    }

    function _checkAndMarkProof(bytes32 proofNonce) private {
        require(!_usedProofs[proofNonce], "Proof already used");
        _usedProofs[proofNonce] = true;
    }

    /// @dev Verifies the access proof signature from receiver / access assistant.
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

    /// @dev Verifies the ownership proof signature from a registered TEE oracle.
    function _verifyOwnershipProof(
        TransferValidityProof calldata proof
    ) private view returns (bool) {
        if (proof.ownershipProof.oracleType != OracleType.TEE) return false;

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
        address signer = messageHash.recover(proof.ownershipProof.proof);
        return _registeredOracles[signer];
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

    /// @inheritdoc IAgentDataVerifier
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
