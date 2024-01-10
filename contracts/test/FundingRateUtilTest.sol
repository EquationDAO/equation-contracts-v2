// SPDX-License-Identifier: UNLICENSED
pragma solidity =0.8.23;

import "../libraries/FundingRateUtil.sol";
import "../core/interfaces/IMarketManager.sol";

contract FundingRateUtilTest {
    IMarketManager.State public state;
    IConfigurable.MarketConfig public marketConfig;

    IPriceFeed public priceFeed;

    function setPriceFeed(IPriceFeed _priceFeed) external {
        priceFeed = _priceFeed;
    }

    function setGlobalLiquidityPosition(
        IMarketLiquidityPosition.GlobalLiquidityPosition calldata _globalLiquidityPosition
    ) external {
        state.globalLiquidityPosition = _globalLiquidityPosition;
    }

    function setGlobalPosition(IMarketPosition.GlobalPosition calldata _globalPosition) external {
        state.globalPosition = _globalPosition;
    }

    function setGlobalFundingRateSample(
        IMarketPosition.GlobalFundingRateSample calldata _globalFundingRateSample
    ) external {
        state.globalFundingRateSample = _globalFundingRateSample;
    }

    function setPriceState(IMarketManager.PriceState calldata _priceState) external {
        state.priceState = _priceState;
    }

    function setMarketBaseConfig(IConfigurable.MarketBaseConfig calldata _marketBaseConfig) external {
        marketConfig.baseConfig = _marketBaseConfig;
    }

    // internal functions

    function snapshotAndAdjustGlobalFundingRate(
        IMarketDescriptor _market,
        int256 _fundingRateDeltaX96,
        int192 _longFundingRateGrowthAfterX96,
        int192 _shortFundingRateGrowthAfterX96
    ) external {
        FundingRateUtil.snapshotAndAdjustGlobalFundingRate(
            state,
            _market,
            _fundingRateDeltaX96,
            _longFundingRateGrowthAfterX96,
            _shortFundingRateGrowthAfterX96
        );
    }

    // public functions

    function sampleAndAdjustFundingRate(IMarketDescriptor _market) public {
        FundingRateUtil.sampleAndAdjustFundingRate(state, marketConfig.baseConfig, priceFeed, _market);
    }
}
