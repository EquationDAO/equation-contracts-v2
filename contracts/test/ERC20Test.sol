// SPDX-License-Identifier: UNLICENSED
pragma solidity =0.8.23;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract ERC20Test is ERC20 {
    uint8 private myDecimals;

    receive() external payable {}

    constructor(
        string memory _name,
        string memory _symbol,
        uint8 _decimals,
        uint256 _initialSupply
    ) ERC20(_name, _symbol) {
        myDecimals = _decimals;

        _mint(_msgSender(), _initialSupply);
    }

    function decimals() public view override returns (uint8) {
        return myDecimals;
    }

    function mint(address _account, uint256 _amount) public {
        _mint(_account, _amount);
    }
}
