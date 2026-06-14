// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";

import {ValidationRegistry} from "../src/ValidationRegistry.sol";

/// @title ValidationRegistry — Property-Based Fuzz Tests
///
/// Each testFuzz_* function is called 1 000 times by Forge with random inputs.
contract ValidationRegistryFuzzTest is Test {
    ValidationRegistry internal registry;

    // Fixed EOA validator used as the designated responder in most tests.
    address internal constant VALIDATOR = address(0xAA01);

    function setUp() public {
        registry = new ValidationRegistry();
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    function _request(
        bytes32 hash,
        address validator,
        uint256 agentId
    ) internal {
        registry.validationRequest(validator, agentId, "ipfs://request", hash);
    }

    // ── Fuzz: response above 100 always reverts ───────────────────────────────

    /// @notice Any response value > 100 must be rejected with InvalidResponse.
    function testFuzz_responseAbove100AlwaysReverts(uint8 response) public {
        vm.assume(response > 100);

        bytes32 hash = keccak256("test-hash");
        _request(hash, VALIDATOR, 1);

        vm.prank(VALIDATOR);
        vm.expectRevert(ValidationRegistry.InvalidResponse.selector);
        registry.validationResponse(hash, response, "", bytes32(0), "", "");
    }

    // ── Fuzz: valid response (0–100) always succeeds ──────────────────────────

    /// @notice Any response value in [0, 100] must be stored correctly.
    function testFuzz_validResponseStoredCorrectly(uint8 response) public {
        vm.assume(response <= 100);

        bytes32 hash = keccak256(abi.encode(response, "valid"));
        _request(hash, VALIDATOR, 1);

        vm.prank(VALIDATOR);
        registry.validationResponse(hash, response, "", bytes32(0), "", "");

        (, , uint8 stored, , , uint256 lastUpdate) = registry
            .getValidationStatus(hash);
        assertEq(stored, response, "stored response mismatch");
        assertGt(lastUpdate, 0, "lastUpdate must be non-zero after response");
    }

    // ── Fuzz: wrong EOA caller always reverts ─────────────────────────────────

    /// @notice Any caller that is not the designated EOA validator must be rejected.
    function testFuzz_wrongEoaCallerReverts(address attacker) public {
        vm.assume(attacker != VALIDATOR);
        vm.assume(attacker != address(0));
        // Exclude contract addresses to stay on the EOA path.
        vm.assume(attacker.code.length == 0);

        bytes32 hash = keccak256(abi.encode(attacker));
        _request(hash, VALIDATOR, 1);

        vm.prank(attacker);
        vm.expectRevert(ValidationRegistry.NotRequestedValidator.selector);
        registry.validationResponse(hash, 50, "", bytes32(0), "", "");
    }

    // ── Fuzz: unknown hash always reverts ─────────────────────────────────────

    /// @notice Responding to a hash that was never requested must revert.
    function testFuzz_unknownHashReverts(bytes32 hash) public {
        // Ensure the hash was never submitted (fresh registry, any hash is unknown).
        vm.prank(VALIDATOR);
        vm.expectRevert(ValidationRegistry.RequestNotFound.selector);
        registry.validationResponse(hash, 50, "", bytes32(0), "", "");
    }

    // ── Fuzz: request stores validator and agentId correctly ──────────────────

    /// @notice After a validationRequest the record must reflect the exact
    ///         validator and agentId passed in.
    function testFuzz_requestStoresFields(
        uint256 agentId,
        address validator,
        bytes32 hash
    ) public {
        vm.assume(validator != address(0));

        registry.validationRequest(validator, agentId, "ipfs://x", hash);

        (address storedValidator, uint256 storedAgentId, , , , ) = registry
            .getValidationStatus(hash);

        assertEq(storedValidator, validator, "validator mismatch");
        assertEq(storedAgentId, agentId, "agentId mismatch");
    }

    // ── Fuzz: repeated request overwrites fields but does not lose the record ─

    /// @notice Submitting a second request with the same hash overwrites the
    ///         record's validator and agentId, but the record remains queryable.
    function testFuzz_repeatedRequestOverwritesRecord(
        address validator1,
        address validator2,
        uint256 agentId1,
        uint256 agentId2
    ) public {
        vm.assume(validator1 != address(0));
        vm.assume(validator2 != address(0));

        bytes32 hash = keccak256("shared-hash");

        registry.validationRequest(validator1, agentId1, "ipfs://v1", hash);
        registry.validationRequest(validator2, agentId2, "ipfs://v2", hash);

        (address storedValidator, uint256 storedAgentId, , , , ) = registry
            .getValidationStatus(hash);

        // After the second request the record must reflect the latest values.
        assertEq(storedValidator, validator2, "validator not overwritten");
        assertEq(storedAgentId, agentId2, "agentId not overwritten");
    }

    // ── Fuzz: response is idempotent (last-write-wins) ────────────────────────

    /// @notice Calling validationResponse twice updates the record to the second value.
    function testFuzz_secondResponseOverwritesScore(
        uint8 first,
        uint8 second
    ) public {
        vm.assume(first <= 100);
        vm.assume(second <= 100);

        bytes32 hash = keccak256(abi.encode(first, second));
        _request(hash, VALIDATOR, 1);

        vm.prank(VALIDATOR);
        registry.validationResponse(hash, first, "", bytes32(0), "v1", "");

        vm.prank(VALIDATOR);
        registry.validationResponse(hash, second, "", bytes32(0), "v2", "");

        (, , uint8 stored, , string memory tag, ) = registry
            .getValidationStatus(hash);
        assertEq(stored, second, "second response did not overwrite");
        assertEq(tag, "v2", "tag not updated");
    }
}
