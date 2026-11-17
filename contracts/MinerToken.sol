// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// Fixed supply: 100,000,000 MINER, minted once to the deployer. No mint function exists.
contract MinerToken is ERC20 {
    constructor() ERC20("Miner Token", "MINER") {
        _mint(msg.sender, 100_000_000 * 10 ** decimals());
    }
}
