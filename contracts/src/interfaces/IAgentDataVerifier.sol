// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

/// @notice Interface for contract validators used by ValidationRegistry (ERC-8004).
interface IAgentDataVerifier {
    function verifyValidation(
        uint256 agentId,
        bytes32 requestHash,
        uint8 response,
        bytes calldata proof
    ) external view returns (bool valid);
}
