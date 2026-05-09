// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, ebool, euint64, eaddress, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title SealedBidAuction
/// @notice Sealed-bid auction with encrypted bids. Bidders submit encrypted euint64
/// bids; the contract tracks the highest bid and the winning address entirely under
/// FHE. Until the owner calls `reveal()`, only the owner can user-decrypt them.
contract SealedBidAuction is ZamaEthereumConfig {
    address public immutable owner;
    uint256 public immutable endTime;

    bool public ended;
    bool public revealed;

    euint64 private _highestBid;
    eaddress private _winner;

    error NotOwner();
    error AuctionEnded();
    error AuctionNotEnded();
    error AlreadyEnded();
    error AlreadyRevealed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(uint256 biddingSeconds) {
        owner = msg.sender;
        endTime = block.timestamp + biddingSeconds;
    }

    /// @notice Submit an encrypted bid. Caller must be the bidder (sender-allowed handle).
    function bid(externalEuint64 encryptedBid, bytes calldata inputProof) external {
        if (block.timestamp >= endTime) revert AuctionEnded();

        euint64 newBid = FHE.fromExternal(encryptedBid, inputProof);
        eaddress newBidder = FHE.asEaddress(msg.sender);

        ebool isHigher = FHE.gt(newBid, _highestBid);
        _highestBid = FHE.select(isHigher, newBid, _highestBid);
        _winner = FHE.select(isHigher, newBidder, _winner);

        FHE.allowThis(_highestBid);
        FHE.allowThis(_winner);
        FHE.allow(_highestBid, owner);
        FHE.allow(_winner, owner);
    }

    /// @notice Close bidding. Owner only — blocks further bids and freezes state.
    function endAuction() external onlyOwner {
        if (ended) revert AlreadyEnded();
        if (block.timestamp < endTime) revert AuctionNotEnded();
        ended = true;
    }

    /// @notice Owner publicly reveals the winning bid and winner. Irreversible.
    function reveal() external onlyOwner {
        if (!ended) revert AuctionNotEnded();
        if (revealed) revert AlreadyRevealed();
        revealed = true;
        FHE.makePubliclyDecryptable(_highestBid);
        FHE.makePubliclyDecryptable(_winner);
    }

    function getHighestBid() external view returns (euint64) {
        return _highestBid;
    }

    function getWinner() external view returns (eaddress) {
        return _winner;
    }
}
