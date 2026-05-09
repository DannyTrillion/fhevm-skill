// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint32, externalEuint32} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @notice DO NOT USE. Each function deliberately omits an ACL step
///         so we can observe the resulting failure mode in tests.
contract BadFHECounter is ZamaEthereumConfig {
    euint32 internal _count;

    function getCount() external view returns (euint32) {
        return _count;
    }

    /// MISTAKE: missing FHE.allowThis(_count).
    /// First call works (zero handle is treated as literal zero).
    /// Second call reverts because the contract is no longer authorized
    /// to use the value it just stored.
    function incrementMissingAllowThis(externalEuint32 inH, bytes calldata proof) external {
        euint32 v = FHE.fromExternal(inH, proof);
        _count = FHE.add(_count, v);
        // FHE.allowThis(_count);   <-- omitted on purpose
        FHE.allow(_count, msg.sender);
    }

    /// MISTAKE: missing FHE.allow(_count, msg.sender).
    /// Contract state updates fine, but the caller cannot decrypt the
    /// stored value because their address is not on the ACL.
    function incrementMissingUserAllow(externalEuint32 inH, bytes calldata proof) external {
        euint32 v = FHE.fromExternal(inH, proof);
        _count = FHE.add(_count, v);
        FHE.allowThis(_count);
        // FHE.allow(_count, msg.sender);   <-- omitted on purpose
    }
}
