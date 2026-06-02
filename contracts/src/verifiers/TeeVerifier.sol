// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @dev Minimal interface for Automata DCAP on-chain attestation (fee variant).
interface IAutomataDcapAttestationFee {
    function verifyAndAttestOnChain(
        bytes calldata rawQuote
    ) external payable returns (bool success, bytes memory output);
}

/**
 * @title TeeVerifier
 * @notice IAgentDataVerifier implementation for Phala Cloud TDX oracle proofs.
 */
contract TeeVerifier is Ownable {
    using ECDSA for bytes32;

    /// @dev Automata AutomataDcapAttestationFee contract.
    address public immutable DCAP_ATTESTATION;

    uint256 private constant QUOTE_REPORT_DATA_OFFSET = 568; // 48 (header) + 520 (body offset to reportData)
    uint256 private constant REPORT_DATA_LENGTH = 64;

    mapping(address => bool) private _registeredOracles;

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

    constructor(
        address admin_,
        address dcapAttestation_
    ) Ownable(admin_) {
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

        bytes memory reportDataBytes = rawQuote[
            QUOTE_REPORT_DATA_OFFSET:QUOTE_REPORT_DATA_OFFSET +
                REPORT_DATA_LENGTH
        ];

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
    ) external payable returns (bool) {
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
}
