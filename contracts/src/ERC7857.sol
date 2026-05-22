// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "./interfaces/IERC7857.sol";
import "./Utils.sol";

/**
 * @title ERC7857
 * @notice Non-upgradeable base implementation of ERC-7857 (Intelligent Digital Assets).
 *
 * Combines the functionality of 0g-agent-nft's:
 *   - ERC7857Upgradeable        — core: verifier, iTransferFrom, delegateAccess
 *   - ERC7857IDataStorageUpgradeable — per-token IntelligentData[] storage
 *   - ERC7857AuthorizeUpgradeable    — per-token authorized-user sets
 *
 * No proxy pattern; uses regular state variables rather than ERC-7201 namespaced storage.
 */
abstract contract ERC7857 is IERC7857, ERC721 {
    using EnumerableSet for EnumerableSet.AddressSet;

    uint256 public constant MAX_AUTHORIZED_USERS = 100;

    // ─── Storage ──────────────────────────────────────────────────────────────

    IERC7857DataVerifier private _verifier;
    uint256 internal _nextTokenId;

    /// @dev tokenId → intelligent data items
    mapping(uint256 => IntelligentData[]) private _iDatas;

    /// @dev owner address → delegated access-assistant address
    mapping(address => address) private _accessAssistants;

    /// @dev tokenId → set of authorized users
    mapping(uint256 => EnumerableSet.AddressSet) private _authorizedUsers;

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(
        string memory name_,
        string memory symbol_,
        address verifier_
    ) ERC721(name_, symbol_) {
        if (verifier_ != address(0)) {
            _verifier = IERC7857DataVerifier(verifier_);
        }
    }

    // ─── Verifier ─────────────────────────────────────────────────────────────

    function verifier() public view override returns (IERC7857DataVerifier) {
        return _verifier;
    }

    function _setVerifier(address verifier_) internal {
        _verifier = IERC7857DataVerifier(verifier_);
    }

    // ─── Token ID counter ─────────────────────────────────────────────────────

    function _incrementTokenId() internal returns (uint256 tokenId) {
        tokenId = _nextTokenId++;
    }

    // ─── Intelligent data ─────────────────────────────────────────────────────

    function intelligentDatasOf(
        uint256 tokenId
    ) public view override returns (IntelligentData[] memory) {
        _requireOwned(tokenId);
        return _iDatas[tokenId];
    }

    function _intelligentDatasOf(
        uint256 tokenId
    ) internal view returns (IntelligentData[] memory) {
        return _iDatas[tokenId];
    }

    function _updateData(
        uint256 tokenId,
        IntelligentData[] memory newDatas
    ) internal virtual {
        IntelligentData[] memory oldDatas = _iDatas[tokenId];
        delete _iDatas[tokenId];
        for (uint256 i = 0; i < newDatas.length; i++) {
            _iDatas[tokenId].push(newDatas[i]);
        }
        emit Updated(tokenId, oldDatas, newDatas);
    }

    // ─── Access delegation ────────────────────────────────────────────────────

    function delegateAccess(address assistant) public virtual override {
        _accessAssistants[msg.sender] = assistant;
        emit DelegateAccess(msg.sender, assistant);
    }

    function getDelegateAccess(
        address user
    ) public view virtual override returns (address) {
        return _accessAssistants[user];
    }

    // ─── Authorization ────────────────────────────────────────────────────────

    function authorizeUsage(
        uint256 tokenId,
        address user
    ) public virtual override {
        if (user == address(0)) revert ERC7857InvalidAuthorizedUser(address(0));
        if (_ownerOf(tokenId) != msg.sender)
            revert ERC721IncorrectOwner(msg.sender, tokenId, _ownerOf(tokenId));
        _authorizeUsage(tokenId, user);
    }

    function batchAuthorizeUsage(
        uint256 tokenId,
        address[] calldata users
    ) public virtual {
        require(users.length > 0, "Empty users array");
        require(_ownerOf(tokenId) == msg.sender, "Not owner");
        for (uint256 i = 0; i < users.length; i++) {
            require(users[i] != address(0), "Zero address in users");
            _authorizeUsage(tokenId, users[i]);
        }
    }

    function revokeAuthorization(
        uint256 tokenId,
        address user
    ) public virtual override {
        if (_ownerOf(tokenId) != msg.sender)
            revert ERC721InvalidSender(msg.sender);
        if (user == address(0)) revert ERC7857InvalidAuthorizedUser(user);
        if (!_authorizedUsers[tokenId].remove(user))
            revert ERC7857NotAuthorized();
        emit AuthorizationRevoked(msg.sender, user, tokenId);
    }

    function authorizedUsersOf(
        uint256 tokenId
    ) public view virtual override returns (address[] memory) {
        _requireOwned(tokenId);
        return _authorizedUsers[tokenId].values();
    }

    function _authorizeUsage(uint256 tokenId, address user) internal {
        EnumerableSet.AddressSet storage users = _authorizedUsers[tokenId];
        if (users.length() >= MAX_AUTHORIZED_USERS)
            revert ERC7857TooManyAuthorizedUsers();
        if (users.contains(user)) revert ERC7857AlreadyAuthorized();
        users.add(user);
        emit Authorization(msg.sender, user, tokenId);
    }

    function _clearAuthorized(uint256 tokenId) internal {
        address[] memory vals = _authorizedUsers[tokenId].values();
        for (uint256 i = 0; i < vals.length; i++) {
            _authorizedUsers[tokenId].remove(vals[i]);
        }
    }

    // ─── Secure transfer ──────────────────────────────────────────────────────

    function _proofCheck(
        address from,
        address to,
        uint256 tokenId,
        TransferValidityProof[] calldata proofs
    ) internal returns (bytes[] memory sealedKeys) {
        if (to == address(0)) revert ERC721InvalidReceiver(to);
        if (_ownerOf(tokenId) != from) revert ERC721InvalidSender(from);
        if (proofs.length == 0) revert ERC7857EmptyProof();
        require(address(_verifier) != address(0), "No verifier configured");

        TransferValidityProofOutput[] memory proofOutput = _verifier
            .verifyTransferValidity(proofs);

        IntelligentData[] memory datas = _intelligentDatasOf(tokenId);
        if (proofOutput.length != datas.length)
            revert ERC7857ProofCountMismatch();

        sealedKeys = new bytes[](proofOutput.length);

        for (uint256 i = 0; i < proofOutput.length; i++) {
            if (proofOutput[i].dataHash != datas[i].dataHash)
                revert ERC7857DataHashMismatch();

            // The signer of the access proof must be the receiver or their delegated assistant.
            if (
                proofOutput[i].accessAssistant != _accessAssistants[to] &&
                proofOutput[i].accessAssistant != to
            ) revert ERC7857AccessAssistantMismatch();

            bytes memory wantedKey = proofOutput[i].wantedKey;
            bytes memory targetPubkey = proofOutput[i].targetPubkey;
            if (wantedKey.length == 0) {
                // Public-data path: targetPubkey is the receiver's uncompressed ETH public key.
                address defaultWantedReceiver = Utils.pubKeyToAddress(
                    targetPubkey
                );
                if (defaultWantedReceiver != to)
                    revert ERC7857WantedReceiverMismatch();
            } else {
                // Private-data path: both proofs must specify the same encryption key.
                if (!Utils.bytesEqual(targetPubkey, wantedKey))
                    revert ERC7857TargetPubkeyMismatch();
            }

            sealedKeys[i] = proofOutput[i].sealedKey;
        }
    }

    /// @inheritdoc IERC7857
    function iTransferFrom(
        address from,
        address to,
        uint256 tokenId,
        TransferValidityProof[] calldata proofs
    ) public virtual override {
        bytes[] memory sealedKeys = _proofCheck(from, to, tokenId, proofs);
        safeTransferFrom(from, to, tokenId);
        emit PublishedSealedKey(to, tokenId, sealedKeys);
    }

    // ─── ERC-721 overrides ────────────────────────────────────────────────────

    /// @dev Clear authorized users automatically on every token transfer.
    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal virtual override returns (address) {
        address from = super._update(to, tokenId, auth);
        _clearAuthorized(tokenId);
        return from;
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public view virtual override(ERC721, IERC165) returns (bool) {
        return
            interfaceId == type(IERC7857).interfaceId ||
            super.supportsInterface(interfaceId);
    }
}
