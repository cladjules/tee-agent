// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";

import {ValidationRegistry} from "../src/ValidationRegistry.sol";
import {ValidationRegistryHandler} from "./handlers/ValidationRegistryHandler.sol";

/// @title ValidationRegistry — Invariant (Stateful Fuzz) Tests
///
/// Forge repeatedly calls a random sequence of functions on
/// ValidationRegistryHandler, then checks these invariants after every call:
///
///   1. Every responded record has response ≤ 100.
///   2. The agentValidations array for each agentId never shrinks.
///   3. Responded records always have lastUpdate > 0.
contract ValidationRegistryInvariantTest is Test {
    ValidationRegistry public registry;
    ValidationRegistryHandler public handler;

    function setUp() public {
        registry = new ValidationRegistry();
        handler = new ValidationRegistryHandler(registry);

        targetContract(address(handler));
    }

    // ── Invariant 1 ──────────────────────────────────────────────────────────

    /// @notice For every request that has received a response, the stored
    ///         `response` value must be within 0–100.
    function invariant_respondedScoreNeverExceeds100() public view {
        bytes32[] memory hashes = handler.ghostRespondedHashesArray();
        for (uint256 i; i < hashes.length; ++i) {
            (, , uint8 resp, , , ) = registry.getValidationStatus(hashes[i]);
            assertLe(resp, 100, "response exceeds 100");
        }
    }

    // ── Invariant 2 ──────────────────────────────────────────────────────────

    /// @notice The agentValidations array for every tracked agentId must never
    ///         shrink below the peak length observed by the handler.
    function invariant_agentValidationArrayNeverShrinks() public view {
        // agentIds used in the handler are 1–5.
        for (uint256 agentId = 1; agentId <= 5; ++agentId) {
            uint256 onChainLen = registry.getAgentValidations(agentId).length;
            uint256 ghostPeak = handler.ghostAgentValidationLength(agentId);
            assertGe(onChainLen, ghostPeak, "agentValidations array shrank");
        }
    }

    // ── Invariant 3 ──────────────────────────────────────────────────────────

    /// @notice Every record that has been responded to must have lastUpdate > 0.
    function invariant_respondedRecordsHaveNonZeroLastUpdate() public view {
        bytes32[] memory hashes = handler.ghostRespondedHashesArray();
        for (uint256 i; i < hashes.length; ++i) {
            (, , , , , uint256 lastUpdate) = registry.getValidationStatus(
                hashes[i]
            );
            assertGt(lastUpdate, 0, "responded record has zero lastUpdate");
        }
    }
}
