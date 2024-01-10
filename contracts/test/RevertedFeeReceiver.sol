// SPDX-License-Identifier: UNLICENSED
pragma solidity =0.8.23;

contract RevertedFeeReceiver {
    receive() external payable {
        revert("Reverted");
    }
}
