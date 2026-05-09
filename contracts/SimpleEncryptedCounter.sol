// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint32} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title SimpleEncryptedCounter
/// @notice An encrypted counter that anyone can increment by 1.
/// The count itself is stored as an encrypted euint32 and is publicly decryptable.
contract SimpleEncryptedCounter is ZamaEthereumConfig {
    euint32 private _count;

    function getCount() external view returns (euint32) {
        return _count;
    }

    /// @notice Increment the encrypted counter by 1. Callable by anyone.
    function increment() external {
        _count = FHE.add(_count, FHE.asEuint32(1));

        FHE.allowThis(_count);
        FHE.makePubliclyDecryptable(_count);
    }
}
