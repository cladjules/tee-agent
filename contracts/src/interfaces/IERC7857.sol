// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import {IERC721} from "@openzeppelin/contracts/interfaces/IERC721.sol";
import {IERC721Metadata} from "@openzeppelin/contracts/interfaces/IERC721Metadata.sol";
import "./IERC7857DataVerifier.sol";

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
    function verifier() external view returns (IERC7857DataVerifier);

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

    /// @notice Transfer the ERC-7857 token and its linked ERC-8004 identity token atomically.
    /// @dev Requires this AgentRegistry contract to be approved to move the linked ERC-8004 token.
    function iTransferFromWithIdentity(
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

// ─── IERC8004IdentityRegistry ─────────────────────────────────────────────────

/// @title IERC8004IdentityRegistry
/// @notice Minimal interface for the official ERC-8004 Identity Registry singleton.
///         Mainnet: 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432
///         Testnet: 0x8004A818BFB912233c491871b3d84c89A494BD9e
interface IERC8004IdentityRegistry is IERC721 {
    /// @notice Register a new agent with a URI and optional metadata.
    /// @return agentId The ERC-721 tokenId assigned in the official registry.
    function register(
        string calldata agentURI
    ) external returns (uint256 agentId);

    /// @notice Update the agent URI for an existing agent.
    function setAgentURI(uint256 agentId, string calldata newURI) external;

    /// @notice Returns the agent URI stored in the official registry.
    function tokenURI(uint256 agentId) external view returns (string memory);
}

// ─── IAgentRegistry ──────────────────────────────────────────────────────────

/// @title IAgentRegistry
/// @notice Interface for the ERC-7857 AgentRegistry contract.
interface IAgentRegistry is IERC721, IERC7857 {
    // --- Events ---------------------------------------------------------------

    event CreatorSet(uint256 indexed tokenId, address indexed creator);
    event TokenURIUpdated(uint256 indexed tokenId, string newURI);
    event MetadataURIUpdated(uint256 indexed tokenId, string newURI);

    /// @notice Emitted on agent registration (mint).
    event Registered(
        uint256 indexed agentId,
        string agentURI,
        address indexed owner
    );

    /// @notice Emitted when the agent is also registered in the official ERC-8004 registry.
    event ERC8004Registered(
        uint256 indexed tokenId,
        uint256 indexed erc8004AgentId
    );

    // --- Minting --------------------------------------------------------------

    /// @notice Mint an agent NFT and register a new ERC-8004 identity.
    /// @param to                Recipient address.
    /// @param publicMetadataUri ERC-721 tokenURI — standard NFT metadata JSON
    ///                          (name/description/image/attributes). May be empty.
    /// @param metadataUri       ERC-8004 agent registration JSON (services, capabilities, etc.).
    ///                          If the ERC-8004 registry is configured and this is non-empty,
    ///                          a new identity is registered. May be empty.
    /// @param newDatas          Optional intelligent data items to attach at mint time.
    /// @return tokenId          Newly minted token ID.
    function mint(
        address to,
        string calldata publicMetadataUri,
        string calldata metadataUri,
        IntelligentData[] calldata newDatas
    ) external returns (uint256 tokenId);

    /// @notice Mint an agent NFT and attach an *existing* ERC-8004 agent ID (no new registration).
    /// @dev    The caller must own the ERC-8004 agent in the official registry.
    /// @param to                Recipient address.
    /// @param publicMetadataUri ERC-721 tokenURI — standard NFT metadata JSON. May be empty.
    /// @param erc8004AgentId    Existing ERC-8004 agentId to attach to this token.
    /// @param newDatas          Optional intelligent data items to attach at mint time.
    /// @return tokenId          Newly minted token ID.
    function mintWithExisting8004(
        address to,
        string calldata publicMetadataUri,
        uint256 erc8004AgentId,
        IntelligentData[] calldata newDatas
    ) external returns (uint256 tokenId);

    // --- URI ------------------------------------------------------------------

    /// @notice Returns the ERC-721 tokenURI for this token (standard NFT metadata).
    ///         Falls back to metadataUri if no ERC-721-specific URI has been set.
    function tokenURI(uint256 tokenId) external view returns (string memory);

    /// @notice Returns the ERC-8004 agent registration metadata URI for this token.
    function getMetadataUri(
        uint256 tokenId
    ) external view returns (string memory);

    /// @notice Update the ERC-721 tokenURI for this token (owner only).
    function setTokenURI(uint256 tokenId, string calldata newURI) external;

    // --- ERC-8004 -------------------------------------------------------------

    /// @notice Returns the ERC-8004 agentId in the official registry for this token.
    ///         Returns 0 if the token was not co-registered.
    function getERC8004AgentId(uint256 tokenId) external view returns (uint256);
}
