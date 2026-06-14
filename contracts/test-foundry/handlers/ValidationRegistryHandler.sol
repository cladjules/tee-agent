// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.35;

import {CommonBase} from "forge-std/Base.sol";
import {StdCheats} from "forge-std/StdCheats.sol";
import {StdUtils} from "forge-std/StdUtils.sol";

import {ValidationRegistry} from "../../src/ValidationRegistry.sol";

/// @dev Handler contract that drives the ValidationRegistry invariant fuzzer.
///      Wraps validationRequest and validationResponse with bounded inputs
///      so the fuzzer generates realistic, non-trivially-reverting call sequences.
///
///      Ghost variables track every request hash submitted and every request
///      that has received at least one response so invariants can iterate over them.
contract ValidationRegistryHandler is CommonBase, StdCheats, StdUtils {
    // ── System under test ────────────────────────────────────────────────────

    ValidationRegistry public immutable registry;

    // ── Fixed EOA validators (no contract code → EOA path in validationResponse) ──

    address internal constant VALIDATOR_A = address(0xAA01);
    address internal constant VALIDATOR_B = address(0xBB02);

    address[2] internal _validators;

    // ── Ghost variables ──────────────────────────────────────────────────────

    /// @notice All request hashes ever submitted.
    bytes32[] public ghostRequestHashes;

    /// @notice All request hashes that have received at least one response.
    bytes32[] internal _ghostRespondedHashes;
    mapping(bytes32 => bool) internal _ghostResponded;

    /// @notice Last recorded agentValidations length per agentId; used to assert
    ///         that the array never shrinks.
    mapping(uint256 => uint256) public ghostAgentValidationLength;

    // ── Constructor ──────────────────────────────────────────────────────────

    constructor(ValidationRegistry registry_) {
        registry = registry_;
        _validators = [VALIDATOR_A, VALIDATOR_B];
    }

    // ── Wrapped actions ──────────────────────────────────────────────────────

    /// @dev Submit a validation request for a bounded agentId and a deterministic hash.
    ///      The hash is derived from the fuzzer-supplied seed to avoid collisions
    ///      while still exercising the same-hash idempotency path occasionally.
    function validationRequest(
        uint256 validatorSeed,
        uint256 agentId,
        uint256 hashSeed
    ) external {
        address validator = _validators[bound(validatorSeed, 0, 1)];
        uint256 boundedAgent = bound(agentId, 1, 5);

        // Derive a deterministic but varied hash from the seed.
        bytes32 requestHash = keccak256(abi.encode(hashSeed));

        registry.validationRequest(
            validator,
            boundedAgent,
            "ipfs://request-uri",
            requestHash
        );

        ghostRequestHashes.push(requestHash);

        // Track agentValidations length growth.
        uint256 newLen = registry.getAgentValidations(boundedAgent).length;
        if (newLen > ghostAgentValidationLength[boundedAgent]) {
            ghostAgentValidationLength[boundedAgent] = newLen;
        }
    }

    /// @dev Submit a valid EOA response (0–100) for one of the tracked requests.
    function validationResponse(
        uint256 hashIndexSeed,
        uint8 response
    ) external {
        if (ghostRequestHashes.length == 0) return;

        uint256 idx = bound(hashIndexSeed, 0, ghostRequestHashes.length - 1);
        bytes32 requestHash = ghostRequestHashes[idx];

        // Bound response to valid range.
        uint8 boundedResponse = uint8(bound(response, 0, 100));

        // Determine which validator was set for this request.
        // We try both; only the correct one will succeed (EOA path checks msg.sender).
        // Attempt with VALIDATOR_A first.
        bool responded;
        for (uint256 v; v < 2 && !responded; ++v) {
            address validator = _validators[v];
            vm.prank(validator);
            try
                registry.validationResponse(
                    requestHash,
                    boundedResponse,
                    "",
                    bytes32(0),
                    "",
                    ""
                )
            {
                responded = true;
            } catch {}
        }

        if (responded && !_ghostResponded[requestHash]) {
            _ghostResponded[requestHash] = true;
            _ghostRespondedHashes.push(requestHash);
        }
    }

    /// @notice Returns the full array of responded request hashes (for invariant assertions).
    function ghostRespondedHashesArray()
        external
        view
        returns (bytes32[] memory)
    {
        return _ghostRespondedHashes;
    }
}
