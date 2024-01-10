// SPDX-License-Identifier: UNLICENSED
pragma solidity =0.8.23;

import "../libraries/MarketUtil.sol";
import "../libraries/PositionUtil.sol";
import "../libraries/LiquidityPositionUtil.sol";
import "../libraries/ConfigurableUtil.sol";
import "../libraries/FundingRateUtil.sol";
import "../core/interfaces/IMarketManager.sol";
import "../core/interfaces/IConfigurable.sol";
import "../core/interfaces/IMarketDescriptor.sol";

contract MarketUtilTest {
    using MarketUtil for IMarketManager.State;

    IMarketManager.State public state;
    mapping(IMarketDescriptor market => IConfigurable.MarketConfig) public marketConfigs;

    IPriceFeed public priceFeed;

    function setPriceFeed(IPriceFeed _priceFeed) external {
        priceFeed = _priceFeed;
    }

    function setGlobalLiquidityPosition(
        IMarketLiquidityPosition.GlobalLiquidityPosition calldata _globalLiquidityPosition
    ) external {
        state.globalLiquidityPosition = _globalLiquidityPosition;
    }

    function setPriceState(IMarketManager.PriceState calldata _priceState) external {
        state.priceState = _priceState;
    }

    function settleLiquidityUnrealizedPnL(IMarketDescriptor _market) external {
        state.settleLiquidityUnrealizedPnL(priceFeed, _market);
    }
}
