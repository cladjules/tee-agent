// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.35;

import "./interfaces/IAgentDataVerifier.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title ValidationRegistry
 * @notice ERC-8004 Validation Registry — on-chain validation requests and responses.
 */
contract ValidationRegistry is ReentrancyGuard {
    struct ValidationRecord {
        address validatorAddress;
        /// @dev ERC-8004 Identity Registry agent ID (NOT the ERC-721 token ID from AgentRegistry).
        uint256 agentId;
        uint8 response;
        bytes32 responseHash;
        string tag;
        uint256 lastUpdate;
    }

    mapping(bytes32 => ValidationRecord) private _validations;
    mapping(bytes32 => bool) private _requestExists;
    mapping(uint256 => bytes32[]) private _agentValidations;
    mapping(address => bytes32[]) private _validatorRequests;
    mapping(address => mapping(bytes32 => bool))
        private _validatorRequestTracked;

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

    error NotOwnerOrOperator();
    error RequestNotFound();
    error NotRequestedValidator();
    error InvalidResponse();
    error OracleVerificationFailed(bytes32 requestHash);

    /// @notice Request validation of agent work.
    function validationRequest(
        address validatorAddress,
        uint256 agentId,
        string calldata requestURI,
        bytes32 requestHash
    ) external {
        _validations[requestHash].validatorAddress = validatorAddress;
        _validations[requestHash].agentId = agentId;
        _requestExists[requestHash] = true;

        _agentValidations[agentId].push(requestHash);

        if (!_validatorRequestTracked[validatorAddress][requestHash]) {
            _validatorRequestTracked[validatorAddress][requestHash] = true;
            _validatorRequests[validatorAddress].push(requestHash);
        }

        emit ValidationRequest(
            validatorAddress,
            agentId,
            requestURI,
            requestHash
        );
    }

    /**
     * @notice Submit a validation response for a pending request.
     * @dev Contract validators verify `proof`; EOA validators must be msg.sender.
     */
    function validationResponse(
        bytes32 requestHash,
        uint8 response,
        string calldata responseURI,
        bytes32 responseHash,
        string calldata tag,
        bytes calldata proof
    ) external payable nonReentrant {
        if (!_requestExists[requestHash]) revert RequestNotFound();
        if (response > 100) revert InvalidResponse();

        ValidationRecord storage record = _validations[requestHash];
        address validatorAddress = record.validatorAddress;

        if (validatorAddress.code.length > 0) {
            // Contract validator: verify via IAgentDataVerifier (e.g. TEEVerifier).
            // Forward any ETH to cover on-chain attestation fees (e.g. DCAP).
            bool valid = IAgentDataVerifier(validatorAddress).verifyValidation{
                value: msg.value
            }(record.agentId, requestHash, response, proof);
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

    /// @notice Get the status and metadata of a validation request.
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
        return (
            r.validatorAddress,
            r.agentId,
            r.response,
            r.responseHash,
            r.tag,
            r.lastUpdate
        );
    }

    /**
     * @notice Aggregated validation statistics for an agent.
     * @dev Counts only requests with at least one response.
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
    function getAgentValidations(
        uint256 agentId
    ) external view returns (bytes32[] memory) {
        return _agentValidations[agentId];
    }

    /**
     * @notice Return all requestHashes assigned to a validator.
     */
    function getValidatorRequests(
        address validatorAddress
    ) external view returns (bytes32[] memory) {
        return _validatorRequests[validatorAddress];
    }
}
