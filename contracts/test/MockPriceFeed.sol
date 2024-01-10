// SPDX-License-Identifier: BUSL-1.1
pragma solidity =0.8.23;

import "../../contracts/core/interfaces/IMarketDescriptor.sol";

contract MockPriceFeed {
    uint160 public minPriceX96;
    uint160 public maxPriceX96;

    function setMaxPriceX96(uint160 _maxPriceX96) external {
        maxPriceX96 = _maxPriceX96;
    }

    function setMinPriceX96(uint160 _minPriceX96) external {
        minPriceX96 = _minPriceX96;
    }

    function getMaxPriceX96(IMarketDescriptor /* _market */) external view returns (uint160) {
        return maxPriceX96;
    }

    function getMinPriceX96(IMarketDescriptor /* _market */) external view returns (uint160) {
        return minPriceX96;
    }
}
