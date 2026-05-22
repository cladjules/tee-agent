// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title TeeVerifier
 * @notice Holds a single TEE oracle signing address and exposes a signature-check helper.
 *
 * The Verifier contract calls verifyTEESignature() when validating ownership proofs.
 *
 * Ported from 0g-agent-nft/contracts/TeeVerifier.sol.
 * Non-upgradeable: uses Ownable and regular state variables.
 */
contract TeeVerifier is Ownable {
    using ECDSA for bytes32;

    address private _teeOracleAddress;

    event OracleAddressUpdated(
        address indexed oldOracle,
        address indexed newOracle
    );

    constructor(address admin_, address teeOracleAddress_) Ownable(admin_) {
        require(admin_ != address(0), "Invalid admin");
        require(teeOracleAddress_ != address(0), "Invalid oracle address");
        _teeOracleAddress = teeOracleAddress_;
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

    /// @notice Replace the oracle signing address (admin only).
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
