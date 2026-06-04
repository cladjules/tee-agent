// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import {IERC721} from "@openzeppelin/contracts/interfaces/IERC721.sol";
import {IERC721Metadata} from "@openzeppelin/contracts/interfaces/IERC721Metadata.sol";
import "./IAgentDataVerifier.sol";

// ─── IERC7857Metadata ─────────────────────────────────────────────────────────

/// @notice Encrypted / intelligent data item attached to a token.
struct IntelligentData {
    string dataDescription;
    bytes32 dataHash;
}

/// @notice Extends ERC-721 metadata with per-token intelligent (encrypted) data.
interface IERC7857Metadata is IERC721Metadata {
    /// @notice Returns all intelligent data items attached to a token.
    function intelligentDatasOf(
        uint256 tokenId
    ) external view returns (IntelligentData[] memory);
}

// ─── IERC7857 ────────────────────────────────────────────────────────────────

/// @title IERC7857
/// @notice Interface for ERC-7857 Intelligent Digital Assets with encrypted private metadata.
interface IERC7857 is IERC721, IERC7857Metadata {
    // ─── Errors ───────────────────────────────────────────────────────────────

    error ERC7857InvalidAssistant(address assistant);
    error ERC7857EmptyProof();
    error ERC7857ProofCountMismatch();
    error ERC7857DataHashMismatch();
    error ERC7857AccessAssistantMismatch();
    error ERC7857WantedReceiverMismatch();
    error ERC7857TargetPubkeyMismatch();
    error ERC7857InvalidAuthorizedUser(address user);
    error ERC7857TooManyAuthorizedUsers();
    error ERC7857AlreadyAuthorized();
    error ERC7857NotAuthorized();

    // ─── Events ───────────────────────────────────────────────────────────────

    /// @notice Emitted when intelligent data is updated on a token.
    event Updated(
        uint256 indexed tokenId,
        IntelligentData[] oldDatas,
        IntelligentData[] newDatas
    );

    /// @notice Emitted when a sealed (re-encrypted) key is published after secure transfer.
    event PublishedSealedKey(
        address indexed to,
        uint256 indexed tokenId,
        bytes[] sealedKeys
    );

    /// @notice Emitted when an owner delegates access-proof signing to an assistant.
    event DelegateAccess(address indexed user, address indexed assistant);

    /// @notice Emitted when a user is authorized to use a token.
    event Authorization(
        address indexed from,
        address indexed to,
        uint256 indexed tokenId
    );

    /// @notice Emitted when a user's authorization is revoked.
    event AuthorizationRevoked(
        address indexed from,
        address indexed to,
        uint256 indexed tokenId
    );

    // ─── Core ─────────────────────────────────────────────────────────────────

    /// @notice The verifier contract used to validate transfer proofs.
    function verifier() external view returns (IAgentDataVerifier);

    /// @notice Transfer a token with TEE-attested re-encryption proofs.
    /// @param from   Current owner.
    /// @param to     New owner.
    /// @param tokenId Token to transfer.
    /// @param proofs  One TransferValidityProof per intelligent data item.
    function iTransferFrom(
        address from,
        address to,
        uint256 tokenId,
        TransferValidityProof[] calldata proofs
    ) external;

    // ─── Access delegation ────────────────────────────────────────────────────

    /// @notice Delegate access-proof signing to an assistant address (or zero to revoke).
    function delegateAccess(address assistant) external;

    /// @notice Return the current access assistant for a user (zero if none).
    function getDelegateAccess(address user) external view returns (address);

    // ─── Authorization ────────────────────────────────────────────────────────

    /// @notice Authorize a user to access the data of a token.
    function authorizeUsage(uint256 tokenId, address user) external;

    /// @notice Revoke a previously granted authorization.
    function revokeAuthorization(uint256 tokenId, address user) external;

    /// @notice Return all currently authorized users for a token.
    function authorizedUsersOf(
        uint256 tokenId
    ) external view returns (address[] memory);
}
