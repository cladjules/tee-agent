// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import "./interfaces/IAgentDataVerifier.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IAgentRegistryForValidation {
    function ownerOf(uint256 tokenId) external view returns (address);

    function isApprovedForAll(address owner, address operator) external view returns (bool);

    function getApproved(uint256 tokenId) external view returns (address);
}

/**
 * @title ValidationRegistry
 * @notice ERC-8004 Validation Registry — on-chain validation requests and responses.
 *
 * Agents request validation of their work by calling validationRequest(), naming
 * a validator contract/address.  The validator responds via validationResponse()
 * with a score (0-100) and optional evidence URI.  Multiple responses per request
 * are allowed (e.g. progressive finality states).
 */
contract ValidationRegistry is ReentrancyGuard {
    // ─── Types ────────────────────────────────────────────────────────────────

    struct ValidationRecord {
        address validatorAddress;
        uint256 agentId;
        uint8 response;
        bytes32 responseHash;
        string tag;
        uint256 lastUpdate;
    }

    // ─── Storage ──────────────────────────────────────────────────────────────

    address private _agentRegistry;

    /// @dev requestHash => ValidationRecord
    mapping(bytes32 => ValidationRecord) private _validations;
    /// @dev requestHash => exists
    mapping(bytes32 => bool) private _requestExists;

    /// @dev agentId => requestHashes
    mapping(uint256 => bytes32[]) private _agentValidations;

    /// @dev validatorAddress => requestHashes (deduplicated)
    mapping(address => bytes32[]) private _validatorRequests;
    mapping(address => mapping(bytes32 => bool)) private _validatorRequestTracked;

    // ─── Events ───────────────────────────────────────────────────────────────

    event ValidationRequest(
        address indexed validatorAddress,
        uint256 indexed agentId,
        string requestURI,
        bytes32 indexed requestHash
    );

    event ValidationResponse(
        address indexed validatorAddress,
        uint256 indexed agentId,
        bytes32 indexed requestHash,
        uint8 response,
        string responseURI,
        bytes32 responseHash,
        string tag
    );

    // ─── Errors ───────────────────────────────────────────────────────────────

    error NotOwnerOrOperator();
    error RequestNotFound();
    error NotRequestedValidator();
    error InvalidResponse();
    error OracleVerificationFailed(bytes32 requestHash);

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(address agentRegistry_) {
        require(agentRegistry_ != address(0), "Invalid agent registry");
        _agentRegistry = agentRegistry_;
    }

    function getAgentRegistry() external view returns (address) {
        return _agentRegistry;
    }

    // ─── Validation Request ───────────────────────────────────────────────────

    /**
     * @notice Request validation of agent work.
     * @dev MUST be called by the owner or operator of agentId.
     * @param validatorAddress The validator contract/address designated to respond.
     * @param agentId          AgentRegistry tokenId of the agent.
     * @param requestURI       Off-chain URI with inputs/outputs needed by the validator.
     * @param requestHash      keccak256 commitment to the request payload.
     */
    function validationRequest(
        address validatorAddress,
        uint256 agentId,
        string calldata requestURI,
        bytes32 requestHash
    ) external {
        IAgentRegistryForValidation reg = IAgentRegistryForValidation(_agentRegistry);
        address agentOwner = reg.ownerOf(agentId);
        if (
            msg.sender != agentOwner &&
            !reg.isApprovedForAll(agentOwner, msg.sender) &&
            reg.getApproved(agentId) != msg.sender
        ) revert NotOwnerOrOperator();

        _validations[requestHash].validatorAddress = validatorAddress;
        _validations[requestHash].agentId = agentId;
        _requestExists[requestHash] = true;

        _agentValidations[agentId].push(requestHash);

        if (!_validatorRequestTracked[validatorAddress][requestHash]) {
            _validatorRequestTracked[validatorAddress][requestHash] = true;
            _validatorRequests[validatorAddress].push(requestHash);
        }

        emit ValidationRequest(validatorAddress, agentId, requestURI, requestHash);
    }

    // ─── Validation Response ──────────────────────────────────────────────────

    /**
     * @notice Submit a validation response for a pending request.
     * @dev For EOA validators: msg.sender must equal the validatorAddress from the request.
     *      For contract validators (e.g. TEEVerifier): proof must be a valid oracle attestation
     *      verified via IAgentDataVerifier.verifyValidation().
     *      May be called multiple times (progressive finality).
     * @param requestHash  Identifies the request.
     * @param response     Score 0-100 (0 = fail, 100 = pass, or intermediate).
     * @param responseURI  Optional off-chain evidence URI (emitted only).
     * @param responseHash Optional keccak256 of responseURI content.
     * @param tag          Optional custom tag (stored on-chain).
     * @param proof        Empty for EOA validators; 65-byte ECDSA oracle signature for contract validators.
     */
    function validationResponse(
        bytes32 requestHash,
        uint8 response,
        string calldata responseURI,
        bytes32 responseHash,
        string calldata tag,
        bytes calldata proof
    ) external {
        if (!_requestExists[requestHash]) revert RequestNotFound();
        if (response > 100) revert InvalidResponse();

        ValidationRecord storage record = _validations[requestHash];
        address validatorAddress = record.validatorAddress;

        if (validatorAddress.code.length > 0) {
            // Contract validator: verify via IAgentDataVerifier (e.g. TEEVerifier).
            bool valid = IAgentDataVerifier(validatorAddress).verifyValidation(
                record.agentId,
                requestHash,
                response,
                proof
            );
            if (!valid) revert OracleVerificationFailed(requestHash);
        } else {
            // EOA validator: caller must be the designated validator.
            if (validatorAddress != msg.sender) revert NotRequestedValidator();
        }

        record.response = response;
        record.responseHash = responseHash;
        record.tag = tag;
        record.lastUpdate = block.timestamp;

        emit ValidationResponse(
            validatorAddress,
            record.agentId,
            requestHash,
            response,
            responseURI,
            responseHash,
            tag
        );
    }

    // ─── Read Functions ───────────────────────────────────────────────────────

    /**
     * @notice Get the status and metadata of a validation request.
     */
    function getValidationStatus(
        bytes32 requestHash
    )
        external
        view
        returns (
            address validatorAddress,
            uint256 agentId,
            uint8 response,
            bytes32 responseHash,
            string memory tag,
            uint256 lastUpdate
        )
    {
        if (!_requestExists[requestHash]) revert RequestNotFound();
        ValidationRecord storage r = _validations[requestHash];
        return (r.validatorAddress, r.agentId, r.response, r.responseHash, r.tag, r.lastUpdate);
    }

    /**
     * @notice Aggregated validation statistics for an agent.
     * @dev agentId is mandatory; validatorAddresses and tag are optional filters.
     *      Only requests that have received at least one response are counted.
     */
    function getSummary(
        uint256 agentId,
        address[] calldata validatorAddresses,
        string calldata tag
    ) external view returns (uint64 count, uint8 averageResponse) {
        bytes32[] storage hashes = _agentValidations[agentId];
        bool filterValidator = validatorAddresses.length > 0;
        bool filterTag = bytes(tag).length > 0;
        bytes32 tagHash = filterTag ? keccak256(bytes(tag)) : bytes32(0);

        uint256 totalResponse;
        for (uint256 i; i < hashes.length; ++i) {
            ValidationRecord storage r = _validations[hashes[i]];
            if (r.lastUpdate == 0) continue;
            if (filterTag && keccak256(bytes(r.tag)) != tagHash) continue;
            if (filterValidator) {
                bool found;
                for (uint256 k; k < validatorAddresses.length; ++k) {
                    if (r.validatorAddress == validatorAddresses[k]) {
                        found = true;
                        break;
                    }
                }
                if (!found) continue;
            }
            ++count;
            totalResponse += r.response;
        }

        averageResponse = count > 0 ? uint8(totalResponse / count) : 0;
    }

    /**
     * @notice Return all requestHashes associated with an agent.
     */
    function getAgentValidations(uint256 agentId) external view returns (bytes32[] memory) {
        return _agentValidations[agentId];
    }

    /**
     * @notice Return all requestHashes assigned to a validator.
     */
    function getValidatorRequests(address validatorAddress) external view returns (bytes32[] memory) {
        return _validatorRequests[validatorAddress];
    }
}
