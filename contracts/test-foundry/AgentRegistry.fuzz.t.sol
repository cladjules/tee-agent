// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";

import {AgentRegistry} from "../src/AgentRegistry.sol";
import {IntelligentData} from "../src/interfaces/IERC7857.sol";

/// @title AgentRegistry property tests
contract AgentRegistryFuzzTest is Test {
    AgentRegistry internal registry;

    address internal constant ADMIN = address(0xAD);

    function setUp() public {
        registry = new AgentRegistry(
            "TEE Agent",
            "AGENT",
            ADMIN,
            address(0),
            address(0)
        );
    }

    IntelligentData[] internal _empty;

    function _mint(
        address to,
        string memory uri
    ) internal returns (uint256 id) {
        id = registry.mint(to, uri, "", _empty);
    }

    function testFuzz_mintToArbitraryRecipient(
        address to,
        string calldata uri
    ) public {
        vm.assume(to != address(0) && uint160(to) > 9);
        vm.assume(to != address(registry));
        vm.assume(to.code.length == 0);

        uint256 id = _mint(to, uri);

        assertEq(registry.ownerOf(id), to, "owner mismatch after mint");
        assertEq(
            registry.creators(id),
            address(this),
            "creator must be msg.sender"
        );
        assertEq(
            registry.totalSupply(),
            1,
            "supply must be 1 after single mint"
        );
    }

    function testFuzz_tokenURIRoundTrip(string calldata uri) public {
        vm.assume(bytes(uri).length > 0);

        uint256 id = _mint(address(0xBEEF), uri);

        assertEq(registry.tokenURI(id), uri, "tokenURI round-trip failed");
    }

    function testFuzz_setTokenURIRoundTrip(
        string calldata original,
        string calldata updated
    ) public {
        address owner = address(0xBEEF);
        uint256 id = _mint(owner, original);

        vm.prank(owner);
        registry.setTokenURI(id, updated);

        assertEq(
            registry.tokenURI(id),
            updated,
            "setTokenURI round-trip failed"
        );
    }

    function testFuzz_setTokenURIRevertsForNonOwner(address attacker) public {
        address owner = address(0xBEEF);
        vm.assume(attacker != owner);
        vm.assume(attacker != address(0));

        uint256 id = _mint(owner, "zerog://original");

        vm.prank(attacker);
        vm.expectRevert(bytes("Not owner"));
        registry.setTokenURI(id, "zerog://hacked");
    }

    // ── Fuzz: supply monotonicity under N mints ───────────────────────────────

    /// @notice After minting `count` tokens the totalSupply equals `count`.
    ///         Bounded to 50 to avoid excessive gas in a single run.
    function testFuzz_mintManyIncrementsSupply(uint8 count) public {
        uint256 n = bound(count, 1, 50);
        for (uint256 i; i < n; ++i) {
            _mint(address(uint160(i + 1)), "uri");
        }
        assertEq(
            registry.totalSupply(),
            n,
            "totalSupply mismatch after batch mint"
        );
    }

    // ── Fuzz: pause blocks mint ───────────────────────────────────────────────

    /// @notice When the registry is paused, every mint attempt must revert.
    function testFuzz_pauseBlocksMint(address to) public {
        vm.assume(to != address(0) && uint160(to) > 9);

        vm.prank(ADMIN);
        registry.pause();

        vm.expectRevert();
        registry.mint(to, "uri", "", _empty);
    }

    // ── Fuzz: tokenId is sequential ───────────────────────────────────────────

    /// @notice Token IDs are assigned in order 0, 1, 2, … across arbitrary mint counts.
    function testFuzz_tokenIdsAreSequential(uint8 count) public {
        uint256 n = bound(count, 1, 30);
        for (uint256 i; i < n; ++i) {
            uint256 id = _mint(address(uint160(i + 100)), "uri");
            assertEq(id, i, "token id is not sequential");
        }
    }
}
