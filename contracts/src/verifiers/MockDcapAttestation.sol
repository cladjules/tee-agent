// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

/// @dev Local-only DCAP verifier used by the Hardhat deployment.
contract MockDcapAttestation {
    function verifyAndAttestOnChain(
        bytes calldata
    ) external payable returns (bool success, bytes memory output) {
        return (true, "");
    }
}
