// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

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
