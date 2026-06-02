// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";

import {AgentRegistry} from "../src/AgentRegistry.sol";
import {AgentRegistryHandler} from "./handlers/AgentRegistryHandler.sol";

/// @title AgentRegistry — Invariant (Stateful Fuzz) Tests
///
/// Forge repeatedly calls a random sequence of functions on AgentRegistryHandler,
/// then checks these invariants after every call:
///
///   1. totalSupply always equals the number of successful mints.
///   2. Every live token has a non-zero owner.
///   3. Every live token has a non-zero creator.
///   4. totalSupply is monotonically non-decreasing.
///
/// Handler contract bounds inputs so the fuzzer explores meaningful state transitions.
contract AgentRegistryInvariantTest is Test {
    AgentRegistry public registry;
    AgentRegistryHandler public handler;

    function setUp() public {
        // Deploy registry — admin = this test contract.
        registry = new AgentRegistry(
            "TEE Agent",
            "AGENT",
            address(this), // admin
            address(0), // verifier  (disabled for tests)
            address(0) // identityRegistry (disabled for tests)
        );

        // Deploy handler and grant it the DEFAULT_ADMIN_ROLE so it can
        // call pause() / unpause() directly without needing vm.prank.
        handler = new AgentRegistryHandler(registry);
        registry.grantRole(registry.DEFAULT_ADMIN_ROLE(), address(handler));

        // Tell the invariant fuzzer to only call functions on the handler.
        targetContract(address(handler));
    }

    // ── Invariant 1 ──────────────────────────────────────────────────────────

    /// @notice totalSupply() must always equal the number of successful mints
    ///         tracked by the handler's ghost variable.
    function invariant_totalSupplyMatchesGhostMintCount() public view {
        assertEq(
            registry.totalSupply(),
            handler.ghostMintCount(),
            "totalSupply diverged from ghost mint count"
        );
    }

    // ── Invariant 2 ──────────────────────────────────────────────────────────

    /// @notice For every token id in [0, totalSupply), ownerOf must never return address(0).
    ///         ERC-721 burns are not exposed by AgentRegistry, so every minted token
    ///         retains a live owner for the lifetime of this test.
    function invariant_ownerNeverZeroAddress() public view {
        uint256 supply = registry.totalSupply();
        for (uint256 id; id < supply; ++id) {
            address owner = registry.ownerOf(id);
            assertNotEq(owner, address(0), "token has zero owner");
        }
    }

    // ── Invariant 3 ──────────────────────────────────────────────────────────

    /// @notice For every token id in [0, totalSupply), the creator recorded at
    ///         mint time must never be address(0).
    function invariant_creatorNeverZeroAddress() public view {
        uint256 supply = registry.totalSupply();
        for (uint256 id; id < supply; ++id) {
            assertNotEq(
                registry.creators(id),
                address(0),
                "token has zero creator"
            );
        }
    }

    // ── Invariant 4 ──────────────────────────────────────────────────────────

    /// @notice totalSupply is monotonically non-decreasing — it must never fall
    ///         below the highest value observed so far.
    function invariant_totalSupplyMonotonicallyIncreases() public view {
        assertGe(
            registry.totalSupply(),
            handler.ghostPeakSupply(),
            "totalSupply decreased"
        );
    }
}
