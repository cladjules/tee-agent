// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import {IERC721} from "@openzeppelin/contracts/interfaces/IERC721.sol";
import {IERC721Metadata} from "@openzeppelin/contracts/interfaces/IERC721Metadata.sol";
import "./IERC7857.sol";

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

    /// @notice Transfer the ERC-7857 token and its linked ERC-8004 identity token atomically.
    /// @dev Requires this AgentRegistry contract to be approved to move the linked ERC-8004 token.
    function iTransferFromWithIdentity(
        address from,
        address to,
        uint256 tokenId,
        TransferValidityProof[] calldata proofs
    ) external;
}
