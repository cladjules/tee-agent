// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.35;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "../interfaces/IAgentDataVerifier.sol";

/// @dev Always-pass ERC-7857 verifier for AgentRegistry tests.
contract AlwaysPassVerifier is IAgentDataVerifier {
    function verifyTransferValidity(
        TransferValidityProof[] calldata proofs
    )
        external
        pure
        override
        returns (TransferValidityProofOutput[] memory outputs)
    {
        outputs = new TransferValidityProofOutput[](proofs.length);
        for (uint256 i = 0; i < proofs.length; i++) {
            outputs[i] = TransferValidityProofOutput({
                dataHash: proofs[i].accessProof.dataHash,
                sealedKey: proofs[i].ownershipProof.sealedKey,
                targetPubkey: proofs[i].ownershipProof.targetPubkey,
                wantedKey: proofs[i].accessProof.targetPubkey,
                accessAssistant: address(0),
                accessProofNonce: proofs[i].accessProof.nonce,
                ownershipProofNonce: proofs[i].ownershipProof.nonce
            });
        }
    }

    function verifyValidation(
        uint256,
        bytes32,
        uint8,
        bytes calldata
    ) external payable override returns (bool) {
        return true;
    }
}

/// @dev Minimal ERC-8004 Identity Registry stand-in for AgentRegistry tests.
contract MockIdentityRegistry is ERC721 {
    uint256 private _nextId = 1;
    mapping(uint256 => string) private _uris;

    constructor() ERC721("MockIdentityRegistry", "MIR") {}

    function register(
        string calldata agentURI
    ) external returns (uint256 agentId) {
        agentId = _nextId++;
        _mint(msg.sender, agentId);
        _uris[agentId] = agentURI;
    }

    function setAgentURI(uint256 agentId, string calldata newURI) external {
        require(ownerOf(agentId) == msg.sender, "Not owner");
        _uris[agentId] = newURI;
    }

    function tokenURI(
        uint256 agentId
    ) public view override returns (string memory) {
        _requireOwned(agentId);
        return _uris[agentId];
    }
}
