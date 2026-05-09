// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, externalEuint64, euint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {ERC7984} from "@openzeppelin/confidential-contracts/token/ERC7984/ERC7984.sol";

/// @notice Minimal concrete ERC-7984 with a permissionless mint for tests.
///         In production you would gate mint behind access control.
contract MyConfidentialToken is ERC7984, ZamaEthereumConfig {
    constructor()
        ERC7984("MyConfidential", "MCT", "ipfs://mock")
    {}

    /// Anyone can mint to themselves with a fresh encrypted amount.
    function mint(externalEuint64 inH, bytes calldata proof) external {
        euint64 amount = FHE.fromExternal(inH, proof);
        _mint(msg.sender, amount);
    }
}
