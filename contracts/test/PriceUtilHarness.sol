// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "../libraries/PriceUtil.sol";
import "../core/interfaces/IMarketManager.sol";

/// @notice This is a wrapper to call the underlying price util methods
/// Since foundry cheat codes only work with call
contract PriceUtilHarness {
    IMarketManager.PriceState priceState;
    IMarketManager.GlobalLiquidityPosition globalLiquidityPosition;

    function updatePriceState(
        IMarketManager.GlobalLiquidityPosition memory _globalPosition,
        IMarketManager.PriceState memory _priceState,
        PriceUtil.UpdatePriceStateParameter memory _parameter
    )
        public
        returns (
            uint160 tradePriceX96,
            IMarketManager.PriceState memory updatedPriceState,
            IMarketManager.GlobalLiquidityPosition memory updatedGlobalPosition
        )
    {
        globalLiquidityPosition = _globalPosition;
        priceState = _priceState;

        tradePriceX96 = PriceUtil.updatePriceState(globalLiquidityPosition, priceState, _parameter);

        updatedPriceState = priceState;
        updatedGlobalPosition = globalLiquidityPosition;
    }
}
