// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "./ERC7857.sol";
import "./interfaces/IERC7857.sol";

/**
 * @title AgentRegistry
 * @notice ERC-7857 Agent NFT (Intelligent Digital Assets with encrypted private metadata).
 *
 * Extends the ERC7857 base with:
 *   - Standard ERC-721 metadata (tokenURI, setTokenURI, baseURI).
 *   - ERC-8004 co-registration via the official singleton registry
 *     mainnet 0x8004A169… / testnet 0x8004A818… (immutable, set at deploy time).
 *   - Mint fee (waived for DEFAULT_ADMIN_ROLE holders).
 *   - Role-based admin/pause.
 *
 * Secure transfer is handled by the inherited iTransferFrom() function which
 * verifies TEE-attested TransferValidityProof[] via the configured Verifier.
 *
 * URI priority: custom per-token -> baseURI+tokenId -> first dataDescription.
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

    address public admin;
    uint256 public mintFee;
    string public baseURI;

    mapping(uint256 => address) public creators;
    mapping(uint256 => string) private _customURIs;
    mapping(uint256 => string) private _metadataUri;

    /// @dev Official ERC-8004 Identity Registry. Immutable — set at deploy time.
    ///      Pass zero address to disable co-registration (e.g. local Hardhat nodes).
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
        admin = admin_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
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

    // --- Admin ----------------------------------------------------------------

    function setAdmin(address newAdmin) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newAdmin != address(0), "Invalid admin address");
        address oldAdmin = admin;
        if (oldAdmin == newAdmin) return;
        admin = newAdmin;
        _grantRole(DEFAULT_ADMIN_ROLE, newAdmin);
        _revokeRole(DEFAULT_ADMIN_ROLE, oldAdmin);
        emit AdminChanged(oldAdmin, newAdmin);
    }

    // --- Verifier -------------------------------------------------------------

    function updateVerifier(
        address newVerifier
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newVerifier != address(0), "Zero address");
        _setVerifier(newVerifier);
    }

    // --- Mint -----------------------------------------------------------------

    /**
     * @inheritdoc IAgentRegistry
     * @dev DEFAULT_ADMIN_ROLE holders pay no fee.
     *      publicMetadataUri is used as the ERC-721 tokenURI.
     *      metadataUri is the ERC-8004 registration file URI (stored separately; uploaded to 0G).
     *      newDatas is optional; pass an empty array for a plain (non-intelligent) NFT.
     */
    function mint(
        address to,
        string calldata publicMetadataUri,
        string calldata metadataUri,
        IntelligentData[] calldata newDatas
    )
        external
        payable
        override
        nonReentrant
        whenNotPaused
        returns (uint256 tokenId)
    {
        require(to != address(0), "Zero address recipient");

        bool privileged = hasRole(DEFAULT_ADMIN_ROLE, msg.sender);
        if (!privileged) {
            require(msg.value >= mintFee, "Insufficient mint fee");
        }

        tokenId = _incrementTokenId();
        _safeMint(to, tokenId);

        if (bytes(publicMetadataUri).length > 0) {
            _customURIs[tokenId] = publicMetadataUri;
        }
        if (bytes(metadataUri).length > 0) {
            _metadataUri[tokenId] = metadataUri;
        }

        creators[tokenId] = msg.sender;

        if (newDatas.length > 0) {
            _updateData(tokenId, newDatas);
        }

        // Co-register in the official ERC-8004 Identity Registry (optional).
        // The identity NFT is minted to this contract (msg.sender) and held here
        // on behalf of the agent — identity NFTs may be non-transferable.
        // try/catch: if the registry is not deployed or the call fails for any
        // reason, minting still succeeds.
        if (address(_erc8004Registry) != address(0)) {
            try
                _erc8004Registry.register(
                    bytes(metadataUri).length > 0
                        ? metadataUri
                        : publicMetadataUri
                )
            returns (uint256 erc8004Id) {
                _erc8004AgentId[tokenId] = erc8004Id;
                emit ERC8004Registered(tokenId, erc8004Id);
            } catch {}
        }

        emit Registered(tokenId, publicMetadataUri, to);

        if (!privileged && msg.value > mintFee) {
            (bool ok, ) = payable(msg.sender).call{value: msg.value - mintFee}(
                ""
            );
            require(ok, "Refund failed");
        }
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
        return _metadataUri[tokenId];
    }

    // --- URI ------------------------------------------------------------------

    function tokenURI(
        uint256 tokenId
    ) public view override(ERC721, IERC721Metadata) returns (string memory) {
        _requireOwned(tokenId);

        string memory custom = _customURIs[tokenId];
        if (bytes(custom).length > 0) return custom;

        if (bytes(baseURI).length > 0) {
            return string(abi.encodePacked(baseURI, Strings.toString(tokenId)));
        }

        IntelligentData[] memory datas = _intelligentDatasOf(tokenId);
        if (datas.length > 0 && bytes(datas[0].dataDescription).length > 0) {
            return datas[0].dataDescription;
        }

        return "";
    }

    function setBaseURI(
        string calldata newBaseURI
    ) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        string memory old = baseURI;
        baseURI = newBaseURI;
        emit BaseURIUpdated(old, newBaseURI);
    }

    function setTokenURI(
        uint256 tokenId,
        string calldata newURI
    ) external override {
        require(ownerOf(tokenId) == msg.sender, "Not owner");
        _customURIs[tokenId] = newURI;
        emit TokenURIUpdated(tokenId, newURI);
    }

    function setMetadataURI(
        uint256 tokenId,
        string calldata newURI
    ) external override {
        require(ownerOf(tokenId) == msg.sender, "Not owner");
        _metadataUri[tokenId] = newURI;
        emit MetadataURIUpdated(tokenId, newURI);
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

    // --- Fee management -------------------------------------------------------

    function getMintFee() external view override returns (uint256) {
        return mintFee;
    }

    function setMintFee(
        uint256 newMintFee
    ) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 old = mintFee;
        mintFee = newMintFee;
        emit MintFeeUpdated(old, newMintFee);
    }

    function withdrawFees() external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 balance = address(this).balance;
        require(balance > 0, "No fees to withdraw");
        (bool ok, ) = payable(admin).call{value: balance}("");
        require(ok, "Transfer failed");
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
