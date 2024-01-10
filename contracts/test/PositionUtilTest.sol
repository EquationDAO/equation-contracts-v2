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

contract PositionUtilTest {
    using MarketUtil for IMarketManager.State;
    using PositionUtil for IMarketManager.State;
    using LiquidityPositionUtil for IMarketManager.State;
    using FundingRateUtil for IMarketManager.State;
    using ConfigurableUtil for mapping(IMarketDescriptor market => IConfigurable.MarketConfig);

    uint256 public reentrancyStatus;
    IMarketManager.State public state;
    mapping(IMarketDescriptor market => IConfigurable.MarketConfig) public marketConfigs;

    IPriceFeed public priceFeed;

    uint160 public tradePriceX96;
    uint128 public adjustedMarginDelta;
    uint256 public gasCost;
    uint128 public tradingFee;

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

    function setGlobalPosition(IMarketPosition.GlobalPosition calldata _globalPosition) external {
        state.globalPosition = _globalPosition;
    }

    function setGlobalLiquidationFund(int256 _liquidationFund, uint256 _liquidity) external {
        state.globalLiquidationFund.liquidationFund = _liquidationFund;
        state.globalLiquidationFund.liquidity = _liquidity;
    }

    function setPosition(
        address _account,
        Side _side,
        uint128 _margin,
        uint128 _size,
        uint160 _entryPriceX96,
        int192 _entryFundingRateGrowthX96
    ) external {
        IMarketManager.Position storage position = state.positions[_account][_side];
        position.margin = _margin;
        position.size = _size;
        position.entryPriceX96 = _entryPriceX96;
        position.entryFundingRateGrowthX96 = _entryFundingRateGrowthX96;
    }

    function enableMarket(IMarketDescriptor _market, IConfigurable.MarketConfig calldata _marketConfig) external {
        marketConfigs.enableMarket(_market, _marketConfig);
        reentrancyStatus = 1;
        state.changePriceVertices(marketConfigs[_market].priceConfig, _market, priceFeed.getMaxPriceX96(_market));
    }

    function setMarketBaseConfig(
        IMarketDescriptor _market,
        IConfigurable.MarketBaseConfig calldata _marketBaseConfig
    ) external {
        marketConfigs[_market].baseConfig = _marketBaseConfig;
    }

    function setMarketFeeRateConfig(
        IMarketDescriptor _market,
        IConfigurable.MarketFeeRateConfig calldata _marketFeeRateConfig
    ) external {
        marketConfigs[_market].feeRateConfig = _marketFeeRateConfig;
    }

    function setMarketPriceConfig(
        IMarketDescriptor _market,
        IConfigurable.MarketPriceConfig calldata _marketPriceConfig
    ) external {
        marketConfigs[_market].priceConfig = _marketPriceConfig;
        state.changePriceVertices(marketConfigs[_market].priceConfig, _market, priceFeed.getMaxPriceX96(_market));
    }

    function setPreviousGlobalFundingRate(
        int192 _longFundingRateGrowthX96,
        int192 _shortFundingRateGrowthX96
    ) external {
        state.previousGlobalFundingRate.longFundingRateGrowthX96 = _longFundingRateGrowthX96;
        state.previousGlobalFundingRate.shortFundingRateGrowthX96 = _shortFundingRateGrowthX96;
    }

    function positions(address _account, Side _side) external view returns (IMarketManager.Position memory) {
        return state.positions[_account][_side];
    }

    // internal functions

    function distributeFee(PositionUtil.DistributeFeeParameter calldata _parameter) external {
        tradingFee = state.distributeFee(marketConfigs[_parameter.market].feeRateConfig, _parameter);
    }

    function calculateNextEntryPriceX96(
        Side _side,
        uint128 _sizeBefore,
        uint160 _entryPriceBeforeX96,
        uint128 _sizeDelta,
        uint160 _tradePriceX96
    ) external pure returns (uint160 nextEntryPriceX96) {
        return
            PositionUtil.calculateNextEntryPriceX96(
                _side,
                _sizeBefore,
                _entryPriceBeforeX96,
                _sizeDelta,
                _tradePriceX96
            );
    }

    function calculateLiquidity(uint128 _size, uint160 _priceX96) external pure returns (uint128 liquidity) {
        return PositionUtil.calculateLiquidity(_size, _priceX96);
    }

    function calculateUnrealizedPnL(
        Side _side,
        uint128 _size,
        uint160 _entryPriceX96,
        uint160 _priceX96
    ) external pure returns (int256 unrealizedPnL) {
        return PositionUtil.calculateUnrealizedPnL(_side, _size, _entryPriceX96, _priceX96);
    }

    function chooseFundingRateGrowthX96(Side _side) external view returns (int192) {
        return PositionUtil.chooseFundingRateGrowthX96(state.globalPosition, _side);
    }

    function calculateTradingFee(
        uint128 _size,
        uint160 _tradePriceX96,
        uint32 _tradingFeeRate
    ) external pure returns (uint128) {
        return PositionUtil.calculateTradingFee(_size, _tradePriceX96, _tradingFeeRate);
    }

    function calculateLiquidationFee(
        uint128 _size,
        uint160 _entryPriceX96,
        uint32 _liquidationFeeRate
    ) external pure returns (uint128) {
        return PositionUtil.calculateLiquidationFee(_size, _entryPriceX96, _liquidationFeeRate);
    }

    function calculateFundingFee(
        int192 _globalFundingRateGrowthX96,
        int192 _positionFundingRateGrowthX96,
        uint128 _positionSize
    ) external pure returns (int256 fundingFee) {
        return
            PositionUtil.calculateFundingFee(_globalFundingRateGrowthX96, _positionFundingRateGrowthX96, _positionSize);
    }

    function calculateMaintenanceMargin(
        uint128 _size,
        uint160 _entryPriceX96,
        uint160 _indexPriceX96,
        uint32 _liquidationFeeRate,
        uint32 _tradingFeeRate,
        uint64 _liquidationExecutionFee
    ) external pure returns (uint256 maintenanceMargin) {
        return
            PositionUtil.calculateMaintenanceMargin(
                _size,
                _entryPriceX96,
                _indexPriceX96,
                _liquidationFeeRate,
                _tradingFeeRate,
                _liquidationExecutionFee
            );
    }

    function calculateLiquidationPriceX96(
        IMarketManager.Position memory _positionCache,
        Side _side,
        int256 _fundingFee,
        uint32 _liquidationFeeRate,
        uint32 _tradingFeeRate,
        uint64 _liquidationExecutionFee
    ) external view returns (uint160 liquidationPriceX96, int256 adjustedFundingFee) {
        return
            PositionUtil.calculateLiquidationPriceX96(
                _positionCache,
                state.previousGlobalFundingRate,
                _side,
                _fundingFee,
                _liquidationFeeRate,
                _tradingFeeRate,
                _liquidationExecutionFee
            );
    }

    // public functions

    function increaseLiquidityPosition(
        LiquidityPositionUtil.IncreaseLiquidityPositionParameter calldata _parameter
    ) external {
        state.sampleAndAdjustFundingRate(marketConfigs[_parameter.market].baseConfig, priceFeed, _parameter.market);
        state.increaseLiquidityPosition(marketConfigs[_parameter.market], _parameter);
        if (_parameter.liquidityDelta > 0) {
            state.changePriceVertices(
                marketConfigs[_parameter.market].priceConfig,
                _parameter.market,
                priceFeed.getMaxPriceX96(_parameter.market)
            );
            state.changeMaxSize(
                marketConfigs[_parameter.market].baseConfig,
                _parameter.market,
                priceFeed.getMaxPriceX96(_parameter.market)
            );
        }
    }

    function increasePosition(PositionUtil.IncreasePositionParameter calldata _parameter) external {
        state.sampleAndAdjustFundingRate(marketConfigs[_parameter.market].baseConfig, priceFeed, _parameter.market);
        tradePriceX96 = state.increasePosition(marketConfigs[_parameter.market], _parameter);
    }

    function getGasCostIncreasePosition(PositionUtil.IncreasePositionParameter calldata _parameter) external {
        state.sampleAndAdjustFundingRate(marketConfigs[_parameter.market].baseConfig, priceFeed, _parameter.market);
        uint256 gasBefore = gasleft();
        state.increasePosition(marketConfigs[_parameter.market], _parameter);
        uint256 gasAfter = gasleft();
        gasCost = gasBefore - gasAfter;
    }

    function decreasePosition(PositionUtil.DecreasePositionParameter calldata _parameter) external {
        state.sampleAndAdjustFundingRate(marketConfigs[_parameter.market].baseConfig, priceFeed, _parameter.market);
        (tradePriceX96, adjustedMarginDelta) = state.decreasePosition(marketConfigs[_parameter.market], _parameter);
    }

    function getGasCostDecreasePosition(PositionUtil.DecreasePositionParameter calldata _parameter) external {
        uint256 gasBefore = gasleft();
        state.decreasePosition(marketConfigs[_parameter.market], _parameter);
        uint256 gasAfter = gasleft();
        gasCost = gasBefore - gasAfter;
    }

    function liquidatePosition(PositionUtil.LiquidatePositionParameter calldata _parameter) external {
        state.sampleAndAdjustFundingRate(marketConfigs[_parameter.market].baseConfig, priceFeed, _parameter.market);
        state.liquidatePosition(marketConfigs[_parameter.market], _parameter);
    }

    function getGasCostLiquidatePosition(PositionUtil.LiquidatePositionParameter calldata _parameter) external {
        state.sampleAndAdjustFundingRate(marketConfigs[_parameter.market].baseConfig, priceFeed, _parameter.market);
        uint256 gasBefore = gasleft();
        state.liquidatePosition(marketConfigs[_parameter.market], _parameter);
        uint256 gasAfter = gasleft();
        gasCost = gasBefore - gasAfter;
    }
}
