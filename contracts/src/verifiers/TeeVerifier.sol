// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @dev Minimal interface for Automata DCAP on-chain attestation (fee variant).
interface IAutomataDcapAttestationFee {
    function verifyAndAttestOnChain(
        bytes calldata rawQuote
    ) external payable returns (bool success, bytes memory output);
}

/**
 * @title TeeVerifier
 * @notice IAgentDataVerifier implementation for Phala Cloud TDX oracle proofs.
 * @dev Supports DCAP quotes for production and 65-byte ECDSA signatures for simulator/dev.
 */
contract TeeVerifier is Ownable {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    /// @dev Automata AutomataDcapAttestationFee contract.
    address public immutable DCAP_ATTESTATION;

    uint256 private constant QUOTE_PUBKEY_OFFSET = 568; // 48 (header) + 520 (body offset to reportData)
    uint256 private constant PUBKEY_LENGTH = 64; // uncompressed secp256k1 without 0x04 prefix

    address private _teeOracleAddress;

    error InvalidProofLength();
    error DcapVerificationFailed();
    error QuoteTooShort();
    error PubkeyMismatch();

    event OracleAddressUpdated(
        address indexed oldOracle,
        address indexed newOracle
    );
    event ValidatorInitialized(
        address indexed pubkey,
        bytes32 indexed quoteHash
    );

    constructor(
        address admin_,
        address teeOracleAddress_,
        address dcapAttestation_
    ) Ownable(admin_) {
        require(admin_ != address(0), "Invalid admin");
        require(teeOracleAddress_ != address(0), "Invalid oracle address");
        require(dcapAttestation_ != address(0), "Invalid DCAP attestation");
        _teeOracleAddress = teeOracleAddress_;
        DCAP_ATTESTATION = dcapAttestation_;
    }

    /**
     * @notice Trustless oracle key registration via on-chain DCAP attestation.
     * @dev The quote reportData must start with the oracle Ethereum address.
     */
    function initValidator(
        address pubkey,
        bytes calldata rawQuote
    ) external payable {
        require(pubkey != address(0), "Invalid pubkey");
        if (rawQuote.length < QUOTE_PUBKEY_OFFSET + PUBKEY_LENGTH)
            revert QuoteTooShort();

        (bool success, ) = IAutomataDcapAttestationFee(DCAP_ATTESTATION)
            .verifyAndAttestOnChain{value: msg.value}(rawQuote);
        if (!success) revert DcapVerificationFailed();

        bytes memory pubkeyBytes = rawQuote[
            QUOTE_PUBKEY_OFFSET:QUOTE_PUBKEY_OFFSET + PUBKEY_LENGTH
        ];

        address derivedAddr;
        assembly {
            derivedAddr := shr(96, mload(add(pubkeyBytes, 32)))
        }
        if (derivedAddr != pubkey) revert PubkeyMismatch();

        address old = _teeOracleAddress;
        _teeOracleAddress = pubkey;
        emit ValidatorInitialized(pubkey, keccak256(rawQuote));
        emit OracleAddressUpdated(old, pubkey);
    }

    /// @notice Verify a 65-byte ECDSA signature over dataHash was produced by the TEE oracle.
    function verifyTEESignature(
        bytes32 dataHash,
        bytes calldata signature
    ) external view returns (bool) {
        require(signature.length == 65, "Invalid signature length");
        address signer = dataHash.recover(signature);
        return signer == _teeOracleAddress;
    }

    /**
     * @notice Verify a per-request TDX-attested validation response (IAgentDataVerifier interface).
     * @dev ECDSA signatures are simulator/dev only. Other proofs are verified as DCAP quotes.
     */
    function verifyValidation(
        uint256 agentId,
        bytes32 requestHash,
        uint8 response,
        bytes calldata proof
    ) external payable returns (bool) {
        bytes32 commitment = keccak256(
            abi.encodePacked(agentId, requestHash, response)
        );

        if (proof.length == 65) {
            address signer = commitment.toEthSignedMessageHash().recover(proof);
            return signer == _teeOracleAddress;
        }

        if (proof.length < QUOTE_PUBKEY_OFFSET + 32)
            revert InvalidProofLength();

        (bool success, ) = IAutomataDcapAttestationFee(DCAP_ATTESTATION)
            .verifyAndAttestOnChain{value: msg.value}(proof);
        if (!success) revert DcapVerificationFailed();

        bytes32 reportData;
        assembly {
            reportData := calldataload(add(proof.offset, QUOTE_PUBKEY_OFFSET))
        }

        return reportData == commitment;
    }

    /// @notice Replace the oracle signing address (admin only). Use initValidator for trustless registration.
    function updateOracleAddress(address newOracleAddress) external onlyOwner {
        require(newOracleAddress != address(0), "Invalid oracle address");
        address old = _teeOracleAddress;
        _teeOracleAddress = newOracleAddress;
        emit OracleAddressUpdated(old, newOracleAddress);
    }

    function teeOracleAddress() external view returns (address) {
        return _teeOracleAddress;
    }
}
