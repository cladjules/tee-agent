// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "../interfaces/IERC7857.sol";

/**
 * @dev Always-pass verifier for testing — approves every transfer proof.
 */
contract AlwaysPassVerifier is IERC7857DataVerifier {
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
}

/**
 * @dev Always-fail verifier for testing — rejects every transfer proof.
 */
contract AlwaysFailVerifier is IERC7857DataVerifier {
    function verifyTransferValidity(
        TransferValidityProof[] calldata
    ) external pure override returns (TransferValidityProofOutput[] memory) {
        revert("Invalid ownership proof");
    }
}

contract MockDcapAttestation {
    function verifyAndAttestOnChain(
        bytes calldata
    ) external payable returns (bool success, bytes memory output) {
        return (true, "");
    }
}

/**
 * @dev Minimal ERC-8004 Identity Registry stand-in for AgentRegistry tests.
 */
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
