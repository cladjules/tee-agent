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
 * @notice Holds a single TEE oracle signing address and exposes a signature-check helper.
 *
 * Oracle key registration has two paths:
 *   1. DCAP (trustless): `initValidator(pubkey, rawQuote)` verifies the raw TDX quote
 *      on-chain via Automata DCAP and extracts the claimed pubkey from reportData.
 *      No admin trust required.
 *   2. Admin fallback: `updateOracleAddress(newAddress)` for dev/testing or chains
 *      where DCAP is not deployed.
 *
 * Ported from 0g-agent-nft/contracts/TeeVerifier.sol.
 * Non-upgradeable: uses Ownable and regular state variables.
 */
contract TeeVerifier is Ownable {
    using ECDSA for bytes32;

    // Automata AutomataDcapAttestationFee — set at deploy time so the same contract
    // works across chains.  Base & Base Sepolia both use 0xaDdeC7e85c2182202b66E331f2a4A0bBB2cEEa1F.
    // https://github.com/automata-network/automata-dcap-attestation
    address public immutable DCAP_ATTESTATION;

    // Byte offset of the pubkey inside a raw TDX quote's reportData field.
    // TDX quote layout: header(48) + TD report body starts at 48.
    // reportData is at offset 520 inside the TD report body → absolute offset 568.
    // Phala's DstackOffchainVerifier uses the same offsets.
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
     * @dev Verifies `rawQuote` using Automata's AutomataDcapAttestationFee contract,
     *      then checks that the Ethereum address derived from the public key in
     *      reportData matches `pubkey`.
     *
     *      The oracle must place its Ethereum address (20 bytes, left-padded to 64 bytes)
     *      in the TDX report's reportData field (bytes [520..584] of the TD report body,
     *      i.e. absolute byte offset 568 in the raw quote after the 48-byte header).
     *
     *      Any caller can invoke this — no admin required.
     * @param pubkey   The Ethereum address the oracle claims as its signing key.
     * @param rawQuote The raw TDX DCAP quote generated inside the Phala CVM.
     */
    function initValidator(
        address pubkey,
        bytes calldata rawQuote
    ) external payable {
        require(pubkey != address(0), "Invalid pubkey");
        if (rawQuote.length < QUOTE_PUBKEY_OFFSET + PUBKEY_LENGTH)
            revert QuoteTooShort();

        // Verify the quote on-chain. Reverts or returns false on failure.
        (bool success, ) = IAutomataDcapAttestationFee(DCAP_ATTESTATION)
            .verifyAndAttestOnChain{value: msg.value}(rawQuote);
        if (!success) revert DcapVerificationFailed();

        // Extract the 64-byte raw pubkey from reportData and derive the address.
        // Phala's oracle places address bytes right-padded in the first 20 bytes of reportData.
        bytes
            memory pubkeyBytes = rawQuote[QUOTE_PUBKEY_OFFSET:QUOTE_PUBKEY_OFFSET +
                PUBKEY_LENGTH];
        // The Ethereum address is keccak256(pubkeyBytes)[12:] for an uncompressed pubkey,
        // but Phala convention embeds the address directly in the first 20 bytes of reportData.
        // We read addr as the first 20 bytes of pubkeyBytes.
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
     * @dev `proof` is the raw TDX DCAP quote generated by the oracle for this specific validation.
     *      The oracle embeds keccak256(abi.encodePacked(agentId, requestHash, response)) in the
     *      first 32 bytes of the TDX reportData field (absolute byte offset QUOTE_PUBKEY_OFFSET
     *      inside the raw quote, i.e. bytes [568..600]).
     *
     *      Verification steps:
     *        1. Call Automata DCAP to verify the raw TDX quote on-chain.
     *        2. Extract reportData[0:32] from the quote.
     *        3. Compare to keccak256(abi.encodePacked(agentId, requestHash, response)).
     *
     *      Any ETH forwarded via msg.value is passed to the DCAP attestation contract for fees.
     *      Called by ValidationRegistry.validationResponse() when this contract is the validatorAddress.
     */
    function verifyValidation(
        uint256 agentId,
        bytes32 requestHash,
        uint8 response,
        bytes calldata proof
    ) external payable returns (bool) {
        if (proof.length < QUOTE_PUBKEY_OFFSET + 32)
            revert InvalidProofLength();

        // 1. Verify the raw TDX quote on-chain via Automata DCAP.
        (bool success, ) = IAutomataDcapAttestationFee(DCAP_ATTESTATION)
            .verifyAndAttestOnChain{value: msg.value}(proof);
        if (!success) revert DcapVerificationFailed();

        // 2. Extract the first 32 bytes of reportData from the quote.
        //    The oracle places keccak256(agentId ‖ requestHash ‖ response) at reportData[0:32].
        bytes32 reportData;
        assembly {
            reportData := calldataload(add(proof.offset, QUOTE_PUBKEY_OFFSET))
        }

        // 3. Verify reportData matches the expected commitment for this validation.
        bytes32 expected = keccak256(
            abi.encodePacked(agentId, requestHash, response)
        );
        return reportData == expected;
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
