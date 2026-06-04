// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import "./ERC7857.sol";
import "./interfaces/IAgentRegistry.sol";

/**
 * @title AgentRegistry
 * @notice ERC-7857 Agent NFT (Intelligent Digital Assets with encrypted private metadata).
 *
 * Extends the ERC7857 base with:
 *   - Standard ERC-721 tokenURI backed by a per-token custom URI (_customURIs).
 *     Points to standard NFT metadata JSON (name/description/image/attributes).
 *   - Optional co-registration with the official ERC-8004 Identity Registry.
 *     The ERC-8004 tokenURI points to registration JSON (services, capabilities, etc.).
 *   - Role-based admin/pause via OpenZeppelin AccessControl.
 *
 * Secure transfer is handled by the inherited iTransferFrom() function which
 * verifies TEE-attested TransferValidityProof[] via the configured TeeVerifier.
 *
 * URI layout:
 *   tokenURI(id)       → _customURIs[id]  (ERC-721 standard NFT metadata)
 *   getMetadataUri(id) → ERC-8004 tokenURI, or empty when co-registration is disabled
 */
contract AgentRegistry is
    IAgentRegistry,
    ERC7857,
    ERC721Holder,
    AccessControl,
    ReentrancyGuard,
    Pausable
{
    // --- Storage --------------------------------------------------------------

    mapping(uint256 => address) public creators;

    /// @dev Per-token ERC-721 public metadata URI (standard NFT format: name/description/image/attributes).
    mapping(uint256 => string) private _customURIs;

    /// @dev Official ERC-8004 Identity Registry. Optional — address(0) disables co-registration.
    IERC8004IdentityRegistry private immutable _erc8004Registry;

    /// @dev tokenId => ERC-8004 agentId in the official registry (0 = not registered)
    mapping(uint256 => uint256) private _erc8004AgentId;

    // --- Constructor ----------------------------------------------------------

    constructor(
        string memory name_,
        string memory symbol_,
        address admin_,
        address verifierAddr,
        address identityRegistry_
    ) ERC7857(name_, symbol_, verifierAddr) {
        require(admin_ != address(0), "Invalid admin address");
        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
        // identityRegistry_ may be address(0) to disable ERC-8004 co-registration (e.g. local dev / tests).
        _erc8004Registry = IERC8004IdentityRegistry(identityRegistry_);
    }

    // --- ERC-8004 Registry integration ----------------------------------------

    function getERC8004Registry() external view returns (address) {
        return address(_erc8004Registry);
    }

    function getERC8004AgentId(
        uint256 tokenId
    ) external view override returns (uint256) {
        return _erc8004AgentId[tokenId];
    }

    // --- Verifier -------------------------------------------------------------

    function updateVerifier(
        address newVerifier
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newVerifier != address(0), "Zero address");
        _setVerifier(newVerifier);
    }

    // --- Mint -----------------------------------------------------------------

    /// @dev Shared minting core: allocates tokenId, mints NFT, records creator,
    ///      sets publicMetadataUri, and attaches intelligent data.
    ///      Returns the new tokenId. Callers handle ERC-8004 logic.
    function _mintBase(
        address to,
        string calldata publicMetadataUri,
        IntelligentData[] calldata newDatas
    ) private returns (uint256 tokenId) {
        require(to != address(0), "Zero address recipient");
        tokenId = _incrementTokenId();
        _safeMint(to, tokenId);
        creators[tokenId] = msg.sender;
        if (bytes(publicMetadataUri).length > 0) {
            _customURIs[tokenId] = publicMetadataUri;
        }
        if (newDatas.length > 0) _updateData(tokenId, newDatas);
    }

    /// @inheritdoc IAgentRegistry
    function mint(
        address to,
        string calldata publicMetadataUri,
        string calldata metadataUri,
        IntelligentData[] calldata newDatas
    ) external override nonReentrant whenNotPaused returns (uint256 tokenId) {
        tokenId = _mintBase(to, publicMetadataUri, newDatas);

        // Co-register in the official ERC-8004 Identity Registry (optional).
        if (
            address(_erc8004Registry) != address(0) &&
            bytes(metadataUri).length > 0
        ) {
            uint256 erc8004Id = _erc8004Registry.register(metadataUri);
            _erc8004Registry.transferFrom(address(this), to, erc8004Id);
            _erc8004AgentId[tokenId] = erc8004Id;
        }

        emit Registered(tokenId, metadataUri, to);
    }

    /// @inheritdoc IAgentRegistry
    function mintWithExisting8004(
        address to,
        string calldata publicMetadataUri,
        uint256 erc8004AgentId,
        IntelligentData[] calldata newDatas
    ) external override nonReentrant whenNotPaused returns (uint256 tokenId) {
        require(erc8004AgentId != 0, "Invalid erc8004AgentId");

        // Verify the caller owns the ERC-8004 agent.
        if (address(_erc8004Registry) != address(0)) {
            require(
                _erc8004Registry.ownerOf(erc8004AgentId) == msg.sender,
                "Not owner of ERC-8004 agent"
            );
        }

        tokenId = _mintBase(to, publicMetadataUri, newDatas);

        _erc8004AgentId[tokenId] = erc8004AgentId;
        emit Registered(tokenId, "", to);
    }

    // --- Intelligent data update ----------------------------------------------

    /// @notice Update the intelligent data for a token (owner only).
    function update(
        uint256 tokenId,
        IntelligentData[] calldata newDatas
    ) external whenNotPaused {
        require(ownerOf(tokenId) == msg.sender, "Not owner");
        require(newDatas.length > 0, "Empty data array");
        _updateData(tokenId, newDatas);
    }

    // --- Data accessors -------------------------------------------------------

    function getMetadataUri(
        uint256 tokenId
    ) external view override returns (string memory) {
        _requireOwned(tokenId);
        uint256 erc8004Id = _erc8004AgentId[tokenId];
        if (address(_erc8004Registry) == address(0) || erc8004Id == 0)
            return "";
        return _erc8004Registry.tokenURI(erc8004Id);
    }

    // --- URI ------------------------------------------------------------------

    function tokenURI(
        uint256 tokenId
    )
        public
        view
        override(ERC721, IERC721Metadata, IAgentRegistry)
        returns (string memory)
    {
        _requireOwned(tokenId);
        string memory custom = _customURIs[tokenId];
        if (bytes(custom).length > 0) return custom;
        // Fallback: read ERC-8004 registration URI from the official registry.
        uint256 erc8004Id = _erc8004AgentId[tokenId];
        if (address(_erc8004Registry) != address(0) && erc8004Id != 0) {
            return _erc8004Registry.tokenURI(erc8004Id);
        }
        return "";
    }

    function setTokenURI(
        uint256 tokenId,
        string calldata newURI
    ) external override {
        require(ownerOf(tokenId) == msg.sender, "Not owner");
        _customURIs[tokenId] = newURI;
        emit TokenURIUpdated(tokenId, newURI);
    }

    // --- Combined ERC-7857 + ERC-8004 transfer -------------------------------

    /// @notice Transfer both this ERC-7857 agent NFT and its linked ERC-8004 identity.
    /// @dev The caller must own the ERC-7857 token and must have approved this
    ///      contract to move the linked ERC-8004 identity token.
    function iTransferFromWithIdentity(
        address from,
        address to,
        uint256 tokenId,
        TransferValidityProof[] calldata proofs
    ) external override nonReentrant whenNotPaused {
        uint256 erc8004Id = _erc8004AgentId[tokenId];
        require(
            address(_erc8004Registry) != address(0),
            "No ERC-8004 registry"
        );
        require(erc8004Id != 0, "No linked ERC-8004 agent");

        _erc8004Registry.transferFrom(from, to, erc8004Id);
        iTransferFrom(from, to, tokenId, proofs);
    }

    // --- Creator --------------------------------------------------------------

    function setCreator(
        uint256 tokenId,
        address creator
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _requireOwned(tokenId);
        creators[tokenId] = creator;
        emit CreatorSet(tokenId, creator);
    }

    // --- Pause ----------------------------------------------------------------

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // --- Misc -----------------------------------------------------------------

    function totalSupply() external view returns (uint256) {
        return _nextTokenId;
    }

    // --- ERC-721 / interface overrides ----------------------------------------

    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal override(ERC7857) returns (address) {
        return super._update(to, tokenId, auth);
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public view override(ERC7857, AccessControl, IERC165) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
