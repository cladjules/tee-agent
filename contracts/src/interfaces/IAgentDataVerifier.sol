// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

/// @notice Interface for contract validators used by ValidationRegistry (ERC-8004).
interface IAgentDataVerifier {
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
