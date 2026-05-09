// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, ebool, euint32, externalEuint32} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @notice Tracks the highest value submitted, without ever revealing the loser
///         or whether any specific submission won. Demonstrates the canonical
///         "always-write, FHE.select-the-value" conditional-update pattern.
contract EncryptedMax is ZamaEthereumConfig {
    euint32 private _highest;
    address public owner;

    constructor() {
        owner = msg.sender;
    }

    /// Submit a value. The state slot _highest is always written; the
    /// encrypted-side select chooses whether the new value or the old one
    /// lands. Nobody (not even the contract) learns whether this submission
    /// "won" until owner reveals.
    function submit(externalEuint32 inH, bytes calldata proof) external {
        euint32 v = FHE.fromExternal(inH, proof);

        ebool isHigher = FHE.gt(v, _highest);
        _highest = FHE.select(isHigher, v, _highest);

        // Persist for the next tx, and let the owner read it.
        FHE.allowThis(_highest);
        FHE.allow(_highest, owner);
        // Note: deliberately NOT allowing msg.sender — submitters can't see
        // the running max. Only owner can.
    }

    function getHighest() external view returns (euint32) {
        return _highest;
    }

    /// Reveal the final winner to everyone.
    function reveal() external {
        require(msg.sender == owner, "only owner");
        FHE.makePubliclyDecryptable(_highest);
    }
}
