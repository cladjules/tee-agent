// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.35;

import {CommonBase} from "forge-std/Base.sol";
import {StdCheats} from "forge-std/StdCheats.sol";
import {StdUtils} from "forge-std/StdUtils.sol";

import {AgentRegistry} from "../../src/AgentRegistry.sol";
import {IntelligentData} from "../../src/interfaces/IERC7857.sol";

/// @dev Handler contract that drives the AgentRegistry invariant fuzzer.
///      Every public state-mutating function is wrapped with bounded inputs
///      so the fuzzer spends its budget on meaningful call sequences rather
///      than obvious reverts (e.g. zero-address recipient).
///
///      Ghost variables mirror expected on-chain state so invariant assertions
///      in the test contract can cross-check both sides independently.
contract AgentRegistryHandler is CommonBase, StdCheats, StdUtils {
    // ── System under test ────────────────────────────────────────────────────

    AgentRegistry public immutable registry;

    // ── Fixed actors (avoid fuzzer generating zero address / precompiles) ────

    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B00);
    address internal constant CAROL = address(0xCA501);

    address[3] internal _actors;

    // ── Ghost variables ──────────────────────────────────────────────────────

    /// @notice Incremented on every successful mint; must equal registry.totalSupply().
    uint256 public ghostMintCount;

    /// @notice Largest totalSupply seen so far; used to assert monotonicity.
    uint256 public ghostPeakSupply;

    // ── Constructor ──────────────────────────────────────────────────────────

    constructor(AgentRegistry registry_) {
        registry = registry_;
        _actors = [ALICE, BOB, CAROL];
    }

    // ── Wrapped actions ──────────────────────────────────────────────────────

    /// @dev Mint a token to a bounded actor with an arbitrary URI.
    function mint(uint256 actorSeed, string calldata uri) external {
        address to = _actors[bound(actorSeed, 0, 2)];
        IntelligentData[] memory empty = new IntelligentData[](0);
        try registry.mint(to, uri, "", empty) {
            ghostMintCount++;
            uint256 supply = registry.totalSupply();
            if (supply > ghostPeakSupply) ghostPeakSupply = supply;
        } catch {}
    }

    /// @dev Update the tokenURI of an existing token (pranks as the owner).
    function setTokenURI(uint256 tokenIdSeed, string calldata uri) external {
        uint256 supply = registry.totalSupply();
        if (supply == 0) return;

        uint256 tokenId = bound(tokenIdSeed, 0, supply - 1);
        address owner = registry.ownerOf(tokenId);
        vm.prank(owner);
        try registry.setTokenURI(tokenId, uri) {} catch {}
    }

    /// @dev Toggle pause state (the handler holds DEFAULT_ADMIN_ROLE — granted in setUp).
    function togglePause(bool shouldPause) external {
        if (shouldPause && !registry.paused()) {
            try registry.pause() {} catch {}
        } else if (!shouldPause && registry.paused()) {
            try registry.unpause() {} catch {}
        }
    }
}
