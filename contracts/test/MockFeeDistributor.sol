// SPDX-License-Identifier: BUSL-1.1
pragma solidity =0.8.23;

contract MockFeeDistributor {
    uint256 public balance;

    function depositFee(uint256 amount) external {
        balance += amount;
    }
}
