// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.0;

import "./PriceUtil.sol";
import "./MarketUtil.sol";
import "./FundingRateUtil.sol";
import "../IEquationContractsV1Minimum.sol";

/// @notice Utility library for trader positions
library PositionUtil {
    using SafeCast for *;

    struct TradingFeeState {
        uint32 tradingFeeRate;
        uint32 referralReturnFeeRate;
        uint32 referralParentReturnFeeRate;
        uint256 referralToken;
        uint256 referralParentToken;
    }

    struct IncreasePositionParameter {
        IMarketDescriptor market;
        address account;
        Side side;
        uint128 marginDelta;
        uint128 sizeDelta;
        IEFC EFC;
        IPriceFeed priceFeed;
    }

    struct DecreasePositionParameter {
        IMarketDescriptor market;
        address account;
        Side side;
        uint128 marginDelta;
        uint128 sizeDelta;
        IEFC EFC;
        IPriceFeed priceFeed;
        address receiver;
    }

    struct LiquidatePositionParameter {
        IMarketDescriptor market;
        address account;
        Side side;
        IEFC EFC;
        IPriceFeed priceFeed;
        address feeReceiver;
    }

    struct MaintainMarginRateParameter {
        int256 margin;
        Side side;
        uint128 size;
        uint160 entryPriceX96;
        uint160 decreasePriceX96;
        uint32 tradingFeeRate;
        bool liquidatablePosition;
    }

    struct LiquidateParameter {
        IMarketDescriptor market;
        address account;
        Side side;
        uint160 tradePriceX96;
        uint160 decreaseIndexPriceX96;
        int256 requiredFundingFee;
        address feeReceiver;
    }

    struct DistributeFeeParameter {
        IMarketDescriptor market;
        address account;
        uint128 sizeDelta;
        uint160 tradePriceX96;
        TradingFeeState tradingFeeState;
        /// @dev The value is 0 when increasing and decreasing, and consists of the
        /// following parts when liquidating:
        ///     1. The liquidation fee paid by the position
        ///     2. The funding fee compensated for the position, covered by the liquidation fund (if any)
        ///     3. The difference between the liquidation price and the trade price for the position,
        ///     covered by the liquidation fund (if any)
        int256 liquidationFee;
    }

    /// @notice Change the maximum available size after the liquidity changes
    /// @param _state The state of the market
    /// @param _baseCfg The base configuration of the market
    /// @param _market The descriptor used to describe the metadata of the market, such as symbol, name, decimals
    /// @param _indexPriceX96 The index price of the market, as a Q64.96
    function changeMaxSize(
        IMarketManager.State storage _state,
        IConfigurable.MarketBaseConfig storage _baseCfg,
        IMarketDescriptor _market,
        uint160 _indexPriceX96
    ) public {
        unchecked {
            uint128 maxSizeAfter = Math
                .mulDiv(
                    Math.min(_state.globalLiquidityPosition.liquidity, _baseCfg.maxPositionLiquidity),
                    uint256(_baseCfg.maxPositionValueRate) << 96,
                    Constants.BASIS_POINTS_DIVISOR * _indexPriceX96
                )
                .toUint128();
            uint128 maxSizePerPositionAfter = uint128(
                (uint256(maxSizeAfter) * _baseCfg.maxSizeRatePerPosition) / Constants.BASIS_POINTS_DIVISOR
            );

            IMarketManager.GlobalPosition storage position = _state.globalPosition;
            position.maxSize = maxSizeAfter;
            position.maxSizePerPosition = maxSizePerPositionAfter;

            emit IMarketPosition.GlobalPositionSizeChanged(_market, maxSizeAfter, maxSizePerPositionAfter);
        }
    }

    function increasePosition(
        IMarketManager.State storage _state,
        IConfigurable.MarketConfig storage _marketCfg,
        IncreasePositionParameter memory _parameter
    ) public returns (uint160 tradePriceX96) {
        _parameter.side.requireValid();

        IConfigurable.MarketBaseConfig storage baseCfg = _marketCfg.baseConfig;
        IMarketManager.Position memory positionCache = _state.positions[_parameter.account][_parameter.side];
        if (positionCache.size == 0) {
            if (_parameter.sizeDelta == 0) revert IMarketErrors.PositionNotFound(_parameter.account, _parameter.side);

            MarketUtil.validateMargin(_parameter.marginDelta, baseCfg.minMarginPerPosition);
        }

        _validateGlobalLiquidity(_state.globalLiquidityPosition.liquidity);

        MarketUtil.settleLiquidityUnrealizedPnL(_state, _parameter.priceFeed, _parameter.market);

        uint128 tradingFee;
        IMarketManager.MarketFeeRateConfig storage feeRateCfg = _marketCfg.feeRateConfig;
        TradingFeeState memory tradingFeeState = _buildTradingFeeState(feeRateCfg, _parameter.EFC, _parameter.account);
        uint128 sizeAfter = positionCache.size;
        if (_parameter.sizeDelta > 0) {
            sizeAfter = _validateIncreaseSize(_state.globalPosition, positionCache.size, _parameter.sizeDelta);

            uint160 indexPriceX96 = MarketUtil.chooseIndexPriceX96(
                _parameter.priceFeed,
                _parameter.market,
                _parameter.side
            );
            MarketUtil.initializePreviousSPPrice(_state.globalLiquidityPosition, _parameter.market, indexPriceX96);

            tradePriceX96 = PriceUtil.updatePriceState(
                _state.globalLiquidityPosition,
                _state.priceState,
                PriceUtil.UpdatePriceStateParameter({
                    market: _parameter.market,
                    side: _parameter.side,
                    sizeDelta: _parameter.sizeDelta,
                    indexPriceX96: indexPriceX96,
                    liquidationVertexIndex: _marketCfg.priceConfig.liquidationVertexIndex,
                    liquidation: false
                })
            );

            tradingFee = distributeFee(
                _state,
                feeRateCfg,
                DistributeFeeParameter({
                    market: _parameter.market,
                    account: _parameter.account,
                    sizeDelta: _parameter.sizeDelta,
                    tradePriceX96: tradePriceX96,
                    tradingFeeState: tradingFeeState,
                    liquidationFee: 0
                })
            );
        }

        int192 globalFundingRateGrowthX96 = chooseFundingRateGrowthX96(_state.globalPosition, _parameter.side);
        int256 fundingFee = calculateFundingFee(
            globalFundingRateGrowthX96,
            positionCache.entryFundingRateGrowthX96,
            positionCache.size
        );

        int256 marginAfter = int256(uint256(positionCache.margin) + _parameter.marginDelta);
        marginAfter += fundingFee - int256(uint256(tradingFee));

        uint160 entryPriceAfterX96 = calculateNextEntryPriceX96(
            _parameter.side,
            positionCache.size,
            positionCache.entryPriceX96,
            _parameter.sizeDelta,
            tradePriceX96
        );

        _validatePositionLiquidateMaintainMarginRate(
            baseCfg,
            MaintainMarginRateParameter({
                margin: marginAfter,
                side: _parameter.side,
                size: sizeAfter,
                entryPriceX96: entryPriceAfterX96,
                decreasePriceX96: MarketUtil.chooseDecreaseIndexPriceX96(
                    _parameter.priceFeed,
                    _parameter.market,
                    _parameter.side
                ),
                tradingFeeRate: tradingFeeState.tradingFeeRate,
                liquidatablePosition: false
            })
        );
        uint128 marginAfterUint128 = uint256(marginAfter).toUint128();

        if (_parameter.sizeDelta > 0) {
            MarketUtil.validateLeverage(
                marginAfterUint128,
                calculateLiquidity(sizeAfter, entryPriceAfterX96),
                baseCfg.maxLeveragePerPosition
            );
            _increaseGlobalPosition(_state.globalPosition, _parameter.side, _parameter.sizeDelta);
        }

        IMarketManager.Position storage position = _state.positions[_parameter.account][_parameter.side];
        position.margin = marginAfterUint128;
        position.size = sizeAfter;
        position.entryPriceX96 = entryPriceAfterX96;
        position.entryFundingRateGrowthX96 = globalFundingRateGrowthX96;
        emit IMarketPosition.PositionIncreased(
            _parameter.market,
            _parameter.account,
            _parameter.side,
            _parameter.marginDelta,
            marginAfterUint128,
            sizeAfter,
            tradePriceX96,
            entryPriceAfterX96,
            fundingFee,
            tradingFee
        );
    }

    function decreasePosition(
        IMarketManager.State storage _state,
        IConfigurable.MarketConfig storage _marketCfg,
        DecreasePositionParameter memory _parameter
    ) public returns (uint160 tradePriceX96, uint128 adjustedMarginDelta) {
        IMarketManager.Position memory positionCache = _state.positions[_parameter.account][_parameter.side];
        if (positionCache.size == 0) revert IMarketErrors.PositionNotFound(_parameter.account, _parameter.side);

        if (positionCache.size < _parameter.sizeDelta)
            revert IMarketErrors.InsufficientSizeToDecrease(positionCache.size, _parameter.sizeDelta);

        MarketUtil.settleLiquidityUnrealizedPnL(_state, _parameter.priceFeed, _parameter.market);

        uint160 decreaseIndexPriceX96 = MarketUtil.chooseDecreaseIndexPriceX96(
            _parameter.priceFeed,
            _parameter.market,
            _parameter.side
        );

        uint128 tradingFee;
        uint128 sizeAfter = positionCache.size;
        int256 realizedPnLDelta;
        IMarketManager.MarketFeeRateConfig storage feeRateCfg = _marketCfg.feeRateConfig;
        TradingFeeState memory tradingFeeState = _buildTradingFeeState(feeRateCfg, _parameter.EFC, _parameter.account);
        if (_parameter.sizeDelta > 0) {
            // never underflow because of the validation above
            // prettier-ignore
            unchecked { sizeAfter -= _parameter.sizeDelta; }

            MarketUtil.initializePreviousSPPrice(
                _state.globalLiquidityPosition,
                _parameter.market,
                decreaseIndexPriceX96
            );

            tradePriceX96 = PriceUtil.updatePriceState(
                _state.globalLiquidityPosition,
                _state.priceState,
                PriceUtil.UpdatePriceStateParameter({
                    market: _parameter.market,
                    side: _parameter.side.flip(),
                    sizeDelta: _parameter.sizeDelta,
                    indexPriceX96: decreaseIndexPriceX96,
                    liquidationVertexIndex: _marketCfg.priceConfig.liquidationVertexIndex,
                    liquidation: false
                })
            );

            tradingFee = distributeFee(
                _state,
                feeRateCfg,
                DistributeFeeParameter({
                    market: _parameter.market,
                    account: _parameter.account,
                    sizeDelta: _parameter.sizeDelta,
                    tradePriceX96: tradePriceX96,
                    tradingFeeState: tradingFeeState,
                    liquidationFee: 0
                })
            );
            realizedPnLDelta = calculateUnrealizedPnL(
                _parameter.side,
                _parameter.sizeDelta,
                positionCache.entryPriceX96,
                tradePriceX96
            );
        }

        int192 globalFundingRateGrowthX96 = chooseFundingRateGrowthX96(_state.globalPosition, _parameter.side);
        int256 fundingFee = calculateFundingFee(
            globalFundingRateGrowthX96,
            positionCache.entryFundingRateGrowthX96,
            positionCache.size
        );

        int256 marginAfter = int256(uint256(positionCache.margin));
        marginAfter += realizedPnLDelta + fundingFee - int256(uint256(tradingFee) + _parameter.marginDelta);
        if (marginAfter < 0) revert IMarketErrors.InsufficientMargin();

        uint128 marginAfterUint128 = uint256(marginAfter).toUint128();
        if (sizeAfter > 0) {
            IConfigurable.MarketBaseConfig storage baseCfg = _marketCfg.baseConfig;
            _validatePositionLiquidateMaintainMarginRate(
                baseCfg,
                MaintainMarginRateParameter({
                    margin: marginAfter,
                    side: _parameter.side,
                    size: sizeAfter,
                    entryPriceX96: positionCache.entryPriceX96,
                    decreasePriceX96: decreaseIndexPriceX96,
                    tradingFeeRate: tradingFeeState.tradingFeeRate,
                    liquidatablePosition: false
                })
            );
            if (_parameter.marginDelta > 0)
                MarketUtil.validateLeverage(
                    marginAfterUint128,
                    calculateLiquidity(sizeAfter, positionCache.entryPriceX96),
                    baseCfg.maxLeveragePerPosition
                );

            // Update position
            IMarketManager.Position storage position = _state.positions[_parameter.account][_parameter.side];
            position.margin = marginAfterUint128;
            position.size = sizeAfter;
            position.entryFundingRateGrowthX96 = globalFundingRateGrowthX96;
        } else {
            // If the position is closed, the marginDelta needs to be added back to ensure that the
            // remaining margin of the position is 0.
            _parameter.marginDelta += marginAfterUint128;
            marginAfterUint128 = 0;

            // Delete position
            delete _state.positions[_parameter.account][_parameter.side];
        }

        adjustedMarginDelta = _parameter.marginDelta;

        if (_parameter.sizeDelta > 0)
            _decreaseGlobalPosition(_state.globalPosition, _parameter.side, _parameter.sizeDelta);

        emit IMarketPosition.PositionDecreased(
            _parameter.market,
            _parameter.account,
            _parameter.side,
            adjustedMarginDelta,
            marginAfterUint128,
            sizeAfter,
            tradePriceX96,
            realizedPnLDelta,
            fundingFee,
            tradingFee,
            _parameter.receiver
        );
    }

    function liquidatePosition(
        IMarketManager.State storage _state,
        IConfigurable.MarketConfig storage _marketCfg,
        LiquidatePositionParameter memory _parameter
    ) public {
        IMarketManager.Position memory positionCache = _state.positions[_parameter.account][_parameter.side];
        if (positionCache.size == 0) revert IMarketErrors.PositionNotFound(_parameter.account, _parameter.side);

        MarketUtil.settleLiquidityUnrealizedPnL(_state, _parameter.priceFeed, _parameter.market);

        uint160 decreaseIndexPriceX96 = MarketUtil.chooseDecreaseIndexPriceX96(
            _parameter.priceFeed,
            _parameter.market,
            _parameter.side
        );
        MarketUtil.initializePreviousSPPrice(_state.globalLiquidityPosition, _parameter.market, decreaseIndexPriceX96);

        TradingFeeState memory tradingFeeState = _buildTradingFeeState(
            _marketCfg.feeRateConfig,
            _parameter.EFC,
            _parameter.account
        );
        int256 requiredFundingFee = calculateFundingFee(
            chooseFundingRateGrowthX96(_state.globalPosition, _parameter.side),
            positionCache.entryFundingRateGrowthX96,
            positionCache.size
        );

        _validatePositionLiquidateMaintainMarginRate(
            _marketCfg.baseConfig,
            MaintainMarginRateParameter({
                margin: int256(uint256(positionCache.margin)) + requiredFundingFee,
                side: _parameter.side,
                size: positionCache.size,
                entryPriceX96: positionCache.entryPriceX96,
                decreasePriceX96: decreaseIndexPriceX96,
                tradingFeeRate: tradingFeeState.tradingFeeRate,
                liquidatablePosition: true
            })
        );

        // try to update price state
        uint160 tradePriceX96 = PriceUtil.updatePriceState(
            _state.globalLiquidityPosition,
            _state.priceState,
            PriceUtil.UpdatePriceStateParameter({
                market: _parameter.market,
                side: _parameter.side.flip(),
                sizeDelta: positionCache.size,
                indexPriceX96: decreaseIndexPriceX96,
                liquidationVertexIndex: _marketCfg.priceConfig.liquidationVertexIndex,
                liquidation: true
            })
        );

        liquidatePosition(
            _state,
            _marketCfg,
            positionCache,
            tradingFeeState,
            LiquidateParameter({
                market: _parameter.market,
                account: _parameter.account,
                side: _parameter.side,
                tradePriceX96: tradePriceX96,
                decreaseIndexPriceX96: decreaseIndexPriceX96,
                requiredFundingFee: requiredFundingFee,
                feeReceiver: _parameter.feeReceiver
            })
        );
    }

    function liquidatePosition(
        IMarketManager.State storage _state,
        IConfigurable.MarketConfig storage _marketCfg,
        IMarketManager.Position memory _positionCache,
        TradingFeeState memory _tradingFeeState,
        LiquidateParameter memory _parameter
    ) internal {
        IConfigurable.MarketBaseConfig storage baseCfg = _marketCfg.baseConfig;
        (uint64 liquidationExecutionFee, uint32 liquidationFeeRate) = (
            baseCfg.liquidationExecutionFee,
            baseCfg.liquidationFeeRatePerPosition
        );
        (uint160 liquidationPriceX96, int256 adjustedFundingFee) = calculateLiquidationPriceX96(
            _positionCache,
            _state.previousGlobalFundingRate,
            _parameter.side,
            _parameter.requiredFundingFee,
            liquidationFeeRate,
            _tradingFeeState.tradingFeeRate,
            liquidationExecutionFee
        );

        uint128 liquidationFee = calculateLiquidationFee(
            _positionCache.size,
            _positionCache.entryPriceX96,
            liquidationFeeRate
        );
        int256 liquidationFundDelta = int256(uint256(liquidationFee));

        if (_parameter.requiredFundingFee != adjustedFundingFee)
            liquidationFundDelta += _adjustFundingRateByLiquidation(
                _state,
                _parameter.market,
                _parameter.side,
                _parameter.requiredFundingFee,
                adjustedFundingFee
            );

        // If the liquidation price is different from the trade price,
        // the funds of the difference need to be transferred
        liquidationFundDelta += calculateUnrealizedPnL(
            _parameter.side,
            _positionCache.size,
            liquidationPriceX96,
            _parameter.tradePriceX96
        );

        uint128 tradingFee = distributeFee(
            _state,
            _marketCfg.feeRateConfig,
            DistributeFeeParameter({
                market: _parameter.market,
                account: _parameter.account,
                sizeDelta: _positionCache.size,
                tradePriceX96: liquidationPriceX96,
                tradingFeeState: _tradingFeeState,
                liquidationFee: liquidationFundDelta
            })
        );

        _decreaseGlobalPosition(_state.globalPosition, _parameter.side, _positionCache.size);

        delete _state.positions[_parameter.account][_parameter.side];

        emit IMarketPosition.PositionLiquidated(
            _parameter.market,
            msg.sender,
            _parameter.account,
            _parameter.side,
            _parameter.decreaseIndexPriceX96,
            _parameter.tradePriceX96,
            liquidationPriceX96,
            adjustedFundingFee,
            tradingFee,
            liquidationFee,
            liquidationExecutionFee,
            _parameter.feeReceiver
        );
    }

    function distributeFee(
        IMarketManager.State storage _state,
        IConfigurable.MarketFeeRateConfig storage _feeRateCfg,
        DistributeFeeParameter memory _parameter
    ) internal returns (uint128 tradingFee) {
        uint128 liquidityFee;
        (tradingFee, liquidityFee) = _calculateFee(_state, _feeRateCfg, _parameter);

        if (tradingFee == 0 && _parameter.liquidationFee == 0) return 0;

        if (_parameter.liquidationFee != 0) {
            IMarketManager.GlobalLiquidationFund storage globalLiquidationFund = _state.globalLiquidationFund;
            int256 liquidationFundAfter = globalLiquidationFund.liquidationFund + _parameter.liquidationFee;
            globalLiquidationFund.liquidationFund = liquidationFundAfter;
            emit IMarketManager.GlobalLiquidationFundIncreasedByLiquidation(
                _parameter.market,
                _parameter.liquidationFee,
                liquidationFundAfter
            );
        }

        IMarketManager.GlobalLiquidityPosition storage position = _state.globalLiquidityPosition;
        int256 unrealizedPnLGrowthAfterX64 = position.unrealizedPnLGrowthX64 +
            int256((uint256(liquidityFee) << 64) / position.liquidity);
        position.unrealizedPnLGrowthX64 = unrealizedPnLGrowthAfterX64;
        emit IMarketLiquidityPosition.GlobalLiquidityPositionPnLGrowthIncreasedByTradingFee(
            _parameter.market,
            liquidityFee,
            unrealizedPnLGrowthAfterX64
        );
    }

    /// @notice Calculate the next entry price of a position
    /// @param _side The side of the position (Long or Short)
    /// @param _sizeBefore The size of the position before the trade
    /// @param _entryPriceBeforeX96 The entry price of the position before the trade, as a Q64.96
    /// @param _sizeDelta The size of the trade
    /// @param _tradePriceX96 The price of the trade, as a Q64.96
    /// @return nextEntryPriceX96 The entry price of the position after the trade, as a Q64.96
    function calculateNextEntryPriceX96(
        Side _side,
        uint128 _sizeBefore,
        uint160 _entryPriceBeforeX96,
        uint128 _sizeDelta,
        uint160 _tradePriceX96
    ) internal pure returns (uint160 nextEntryPriceX96) {
        if ((_sizeBefore | _sizeDelta) == 0) nextEntryPriceX96 = 0;
        else if (_sizeBefore == 0) nextEntryPriceX96 = _tradePriceX96;
        else if (_sizeDelta == 0) nextEntryPriceX96 = _entryPriceBeforeX96;
        else {
            uint256 liquidityAfterX96 = uint256(_sizeBefore) * _entryPriceBeforeX96;
            liquidityAfterX96 += uint256(_sizeDelta) * _tradePriceX96;
            unchecked {
                uint256 sizeAfter = uint256(_sizeBefore) + _sizeDelta;
                nextEntryPriceX96 = (
                    _side.isLong() ? Math.ceilDiv(liquidityAfterX96, sizeAfter) : liquidityAfterX96 / sizeAfter
                ).toUint160();
            }
        }
    }

    /// @notice Calculate the liquidity (value) of a position
    /// @param _size The size of the position
    /// @param _priceX96 The trade price, as a Q64.96
    /// @return liquidity The liquidity (value) of the position
    function calculateLiquidity(uint128 _size, uint160 _priceX96) internal pure returns (uint128 liquidity) {
        liquidity = Math.mulDivUp(_size, _priceX96, Constants.Q96).toUint128();
    }

    /// @dev Calculate the unrealized PnL of a position based on entry price
    /// @param _side The side of the position (Long or Short)
    /// @param _size The size of the position
    /// @param _entryPriceX96 The entry price of the position, as a Q64.96
    /// @param _priceX96 The trade price or index price, as a Q64.96
    /// @return unrealizedPnL The unrealized PnL of the position, positive value means profit,
    /// negative value means loss
    function calculateUnrealizedPnL(
        Side _side,
        uint128 _size,
        uint160 _entryPriceX96,
        uint160 _priceX96
    ) internal pure returns (int256 unrealizedPnL) {
        unchecked {
            // Because the maximum value of size is type(uint128).max, and the maximum value of entryPriceX96 and
            // priceX96 is type(uint160).max, so the maximum value of
            //      size * (entryPriceX96 - priceX96) / Q96
            // is type(uint192).max, so it is safe to convert the type to int256.
            if (_side.isLong()) {
                if (_entryPriceX96 > _priceX96)
                    unrealizedPnL = -int256(Math.mulDivUp(_size, _entryPriceX96 - _priceX96, Constants.Q96));
                else unrealizedPnL = int256(Math.mulDiv(_size, _priceX96 - _entryPriceX96, Constants.Q96));
            } else {
                if (_entryPriceX96 < _priceX96)
                    unrealizedPnL = -int256(Math.mulDivUp(_size, _priceX96 - _entryPriceX96, Constants.Q96));
                else unrealizedPnL = int256(Math.mulDiv(_size, _entryPriceX96 - _priceX96, Constants.Q96));
            }
        }
    }

    function chooseFundingRateGrowthX96(
        IMarketManager.GlobalPosition storage _globalPosition,
        Side _side
    ) internal view returns (int192) {
        return _side.isLong() ? _globalPosition.longFundingRateGrowthX96 : _globalPosition.shortFundingRateGrowthX96;
    }

    /// @notice Calculate the trading fee of a trade
    /// @param _size The size of the trade
    /// @param _tradePriceX96 The price of the trade, as a Q64.96
    /// @param _tradingFeeRate The trading fee rate for trader increase or decrease positions,
    /// denominated in ten thousandths of a bip (i.e. 1e-8)
    function calculateTradingFee(
        uint128 _size,
        uint160 _tradePriceX96,
        uint32 _tradingFeeRate
    ) internal pure returns (uint128 tradingFee) {
        unchecked {
            uint256 denominator = Constants.BASIS_POINTS_DIVISOR * Constants.Q96;
            tradingFee = Math.mulDivUp(uint256(_size) * _tradingFeeRate, _tradePriceX96, denominator).toUint128();
        }
    }

    /// @notice Calculate the liquidation fee of a position
    /// @param _size The size of the position
    /// @param _entryPriceX96 The entry price of the position, as a Q64.96
    /// @param _liquidationFeeRate The liquidation fee rate for trader positions,
    /// denominated in ten thousandths of a bip (i.e. 1e-8)
    /// @return liquidationFee The liquidation fee of the position
    function calculateLiquidationFee(
        uint128 _size,
        uint160 _entryPriceX96,
        uint32 _liquidationFeeRate
    ) internal pure returns (uint128 liquidationFee) {
        unchecked {
            uint256 denominator = Constants.BASIS_POINTS_DIVISOR * Constants.Q96;
            liquidationFee = Math
                .mulDivUp(uint256(_size) * _liquidationFeeRate, _entryPriceX96, denominator)
                .toUint128();
        }
    }

    /// @notice Calculate the funding fee of a position
    /// @param _globalFundingRateGrowthX96 The global funding rate growth, as a Q96.96
    /// @param _positionFundingRateGrowthX96 The position funding rate growth, as a Q96.96
    /// @param _positionSize The size of the position
    /// @return fundingFee The funding fee of the position, a positive value means the position receives
    /// funding fee, while a negative value means the position pays funding fee
    function calculateFundingFee(
        int192 _globalFundingRateGrowthX96,
        int192 _positionFundingRateGrowthX96,
        uint128 _positionSize
    ) internal pure returns (int256 fundingFee) {
        int256 deltaX96 = _globalFundingRateGrowthX96 - _positionFundingRateGrowthX96;
        if (deltaX96 >= 0) fundingFee = Math.mulDiv(uint256(deltaX96), _positionSize, Constants.Q96).toInt256();
        else fundingFee = -Math.mulDivUp(uint256(-deltaX96), _positionSize, Constants.Q96).toInt256();
    }

    /// @notice Calculate the maintenance margin
    /// @dev maintenanceMargin = size * (entryPrice * liquidationFeeRate
    ///                          + indexPrice * tradingFeeRate)
    ///                          + liquidationExecutionFee
    /// @param _size The size of the position
    /// @param _entryPriceX96 The entry price of the position, as a Q64.96
    /// @param _indexPriceX96 The index price, as a Q64.96
    /// @param _liquidationFeeRate The liquidation fee rate for trader positions,
    /// denominated in ten thousandths of a bip (i.e. 1e-8)
    /// @param _tradingFeeRate The trading fee rate for trader increase or decrease positions,
    /// denominated in ten thousandths of a bip (i.e. 1e-8)
    /// @param _liquidationExecutionFee The liquidation execution fee paid by the position
    /// @return maintenanceMargin The maintenance margin
    function calculateMaintenanceMargin(
        uint128 _size,
        uint160 _entryPriceX96,
        uint160 _indexPriceX96,
        uint32 _liquidationFeeRate,
        uint32 _tradingFeeRate,
        uint64 _liquidationExecutionFee
    ) internal pure returns (uint256 maintenanceMargin) {
        unchecked {
            maintenanceMargin = Math.mulDivUp(
                _size,
                uint256(_entryPriceX96) * _liquidationFeeRate + uint256(_indexPriceX96) * _tradingFeeRate,
                Constants.BASIS_POINTS_DIVISOR * Constants.Q96
            );
            // Because the maximum value of size is type(uint128).max, and the maximum value of entryPriceX96 and
            // indexPriceX96 is type(uint160).max, and liquidationFeeRate + tradingFeeRate is at most 2 * DIVISOR,
            // so the maximum value of
            //      size * (entryPriceX96 * liquidationFeeRate + indexPriceX96 * tradingFeeRate) / (Q96 * DIVISOR)
            // is type(uint193).max, so there will be no overflow here.
            maintenanceMargin += _liquidationExecutionFee;
        }
    }

    /// @notice calculate the liquidation price
    /// @param _positionCache The cache of position
    /// @param _side The side of the position (Long or Short)
    /// @param _fundingFee The funding fee, a positive value means the position receives a funding fee,
    /// while a negative value means the position pays funding fee
    /// @param _liquidationFeeRate The liquidation fee rate for trader positions,
    /// denominated in ten thousandths of a bip (i.e. 1e-8)
    /// @param _tradingFeeRate The trading fee rate for trader increase or decrease positions,
    /// denominated in ten thousandths of a bip (i.e. 1e-8)
    /// @param _liquidationExecutionFee The liquidation execution fee paid by the position
    /// @return liquidationPriceX96 The liquidation price of the position, as a Q64.96
    /// @return adjustedFundingFee The liquidation price based on the funding fee. If `_fundingFee` is negative,
    /// then this value is not less than `_fundingFee`
    function calculateLiquidationPriceX96(
        IMarketManager.Position memory _positionCache,
        IMarketManager.PreviousGlobalFundingRate storage _previousGlobalFundingRate,
        Side _side,
        int256 _fundingFee,
        uint32 _liquidationFeeRate,
        uint32 _tradingFeeRate,
        uint64 _liquidationExecutionFee
    ) internal view returns (uint160 liquidationPriceX96, int256 adjustedFundingFee) {
        int256 marginInt256 = int256(uint256(_positionCache.margin));
        if ((marginInt256 + _fundingFee) > 0) {
            liquidationPriceX96 = _calculateLiquidationPriceX96(
                _positionCache,
                _side,
                _fundingFee,
                _liquidationFeeRate,
                _tradingFeeRate,
                _liquidationExecutionFee
            );
            if (_isAcceptableLiquidationPriceX96(_side, liquidationPriceX96, _positionCache.entryPriceX96))
                return (liquidationPriceX96, _fundingFee);
        }
        // Try to use the previous funding rate to calculate the funding fee
        adjustedFundingFee = calculateFundingFee(
            _choosePreviousGlobalFundingRateGrowthX96(_previousGlobalFundingRate, _side),
            _positionCache.entryFundingRateGrowthX96,
            _positionCache.size
        );
        if (adjustedFundingFee > _fundingFee && (marginInt256 + adjustedFundingFee) > 0) {
            liquidationPriceX96 = _calculateLiquidationPriceX96(
                _positionCache,
                _side,
                adjustedFundingFee,
                _liquidationFeeRate,
                _tradingFeeRate,
                _liquidationExecutionFee
            );
            if (_isAcceptableLiquidationPriceX96(_side, liquidationPriceX96, _positionCache.entryPriceX96))
                return (liquidationPriceX96, adjustedFundingFee);
        } else adjustedFundingFee = _fundingFee;

        // Only try to use zero funding fee calculation when the current best funding fee is negative,
        // then zero funding fee is the best
        if (adjustedFundingFee < 0) {
            adjustedFundingFee = 0;
            liquidationPriceX96 = _calculateLiquidationPriceX96(
                _positionCache,
                _side,
                adjustedFundingFee,
                _liquidationFeeRate,
                _tradingFeeRate,
                _liquidationExecutionFee
            );
        }
    }

    function _calculateFee(
        IMarketManager.State storage _state,
        IConfigurable.MarketFeeRateConfig storage _feeRateCfg,
        DistributeFeeParameter memory _parameter
    ) private returns (uint128 tradingFee, uint128 liquidityFee) {
        unchecked {
            tradingFee = calculateTradingFee(
                _parameter.sizeDelta,
                _parameter.tradePriceX96,
                _parameter.tradingFeeState.tradingFeeRate
            );

            if (tradingFee == 0) return (0, 0);

            uint128 _protocolFee = _splitFee(tradingFee, _feeRateCfg.protocolFeeRate);
            _state.protocolFee += _protocolFee; // overflow is desired
            emit IMarketManager.ProtocolFeeIncreased(_parameter.market, _protocolFee);

            liquidityFee = tradingFee - _protocolFee;

            if (_parameter.tradingFeeState.referralToken > 0) {
                uint128 referralFee = _splitFee(tradingFee, _parameter.tradingFeeState.referralReturnFeeRate);
                _state.referralFees[_parameter.tradingFeeState.referralToken] += referralFee; // overflow is desired

                uint128 referralParentFee = _splitFee(
                    tradingFee,
                    _parameter.tradingFeeState.referralParentReturnFeeRate
                );
                // overflow is desired
                _state.referralFees[_parameter.tradingFeeState.referralParentToken] += referralParentFee;

                emit IMarketManager.ReferralFeeIncreased(
                    _parameter.market,
                    _parameter.account,
                    _parameter.tradingFeeState.referralToken,
                    referralFee,
                    _parameter.tradingFeeState.referralParentToken,
                    referralParentFee
                );

                liquidityFee -= referralFee + referralParentFee;
            }
        }
    }

    function _splitFee(uint128 _tradingFee, uint32 _feeRate) private pure returns (uint128 amount) {
        // prettier-ignore
        unchecked { amount = uint128((uint256(_tradingFee) * _feeRate) / Constants.BASIS_POINTS_DIVISOR); }
    }

    function _choosePreviousGlobalFundingRateGrowthX96(
        IMarketManager.PreviousGlobalFundingRate storage _pgrf,
        Side _side
    ) private view returns (int192) {
        return _side.isLong() ? _pgrf.longFundingRateGrowthX96 : _pgrf.shortFundingRateGrowthX96;
    }

    function _isAcceptableLiquidationPriceX96(
        Side _side,
        uint160 _liquidationPriceX96,
        uint160 _entryPriceX96
    ) private pure returns (bool) {
        return
            (_side.isLong() && _liquidationPriceX96 < _entryPriceX96) ||
            (_side.isShort() && _liquidationPriceX96 > _entryPriceX96);
    }

    /// @notice Calculate the liquidation price
    /// @dev Given the liquidation condition as:
    /// For long position: margin + fundingFee - positionSize * (entryPrice - liquidationPrice)
    ///                     = entryPrice * positionSize * liquidationFeeRate
    ///                         + liquidationPrice * positionSize * tradingFeeRate + liquidationExecutionFee
    /// For short position: margin + fundingFee - positionSize * (liquidationPrice - entryPrice)
    ///                     = entryPrice * positionSize * liquidationFeeRate
    ///                         + liquidationPrice * positionSize * tradingFeeRate + liquidationExecutionFee
    /// We can get:
    /// Long position liquidation price:
    ///     liquidationPrice
    ///       = [margin + fundingFee - liquidationExecutionFee - entryPrice * positionSize * (1 + liquidationFeeRate)]
    ///       / [positionSize * (tradingFeeRate - 1)]
    /// Short position liquidation price:
    ///     liquidationPrice
    ///       = [margin + fundingFee - liquidationExecutionFee + entryPrice * positionSize * (1 - liquidationFeeRate)]
    ///       / [positionSize * (tradingFeeRate + 1)]
    /// @param _positionCache The cache of position
    /// @param _side The side of the position (Long or Short)
    /// @param _fundingFee The funding fee, a positive value means the position receives a funding fee,
    /// while a negative value means the position pays funding fee
    /// @param _liquidationFeeRate The liquidation fee rate for trader positions,
    /// denominated in ten thousandths of a bip (i.e. 1e-8)
    /// @param _tradingFeeRate The trading fee rate for trader increase or decrease positions,
    /// denominated in ten thousandths of a bip (i.e. 1e-8)
    /// @param _liquidationExecutionFee The liquidation execution fee paid by the position
    /// @return liquidationPriceX96 The liquidation price of the position, as a Q64.96
    function _calculateLiquidationPriceX96(
        IMarketManager.Position memory _positionCache,
        Side _side,
        int256 _fundingFee,
        uint32 _liquidationFeeRate,
        uint32 _tradingFeeRate,
        uint64 _liquidationExecutionFee
    ) private pure returns (uint160 liquidationPriceX96) {
        uint256 marginAfter = uint256(_positionCache.margin);
        if (_fundingFee >= 0) marginAfter += uint256(_fundingFee);
        else marginAfter -= uint256(-_fundingFee);

        (uint256 numeratorX96, uint256 denominator) = _side.isLong()
            ? (Constants.BASIS_POINTS_DIVISOR + _liquidationFeeRate, Constants.BASIS_POINTS_DIVISOR - _tradingFeeRate)
            : (Constants.BASIS_POINTS_DIVISOR - _liquidationFeeRate, Constants.BASIS_POINTS_DIVISOR + _tradingFeeRate);

        uint256 numeratorPart2X96 = marginAfter >= _liquidationExecutionFee
            ? marginAfter - _liquidationExecutionFee
            : _liquidationExecutionFee - marginAfter;

        numeratorX96 *= uint256(_positionCache.entryPriceX96) * _positionCache.size;
        denominator *= _positionCache.size;
        numeratorPart2X96 *= Constants.BASIS_POINTS_DIVISOR * Constants.Q96;

        if (_side.isLong()) {
            numeratorX96 = marginAfter >= _liquidationExecutionFee
                ? numeratorX96 - numeratorPart2X96
                : numeratorX96 + numeratorPart2X96;
        } else {
            numeratorX96 = marginAfter >= _liquidationExecutionFee
                ? numeratorX96 + numeratorPart2X96
                : numeratorX96 - numeratorPart2X96;
        }
        liquidationPriceX96 = _side.isLong()
            ? (numeratorX96 / denominator).toUint160()
            : Math.ceilDiv(numeratorX96, denominator).toUint160();
    }

    function _validateIncreaseSize(
        IMarketManager.GlobalPosition storage _position,
        uint128 _sizeBefore,
        uint128 _sizeDelta
    ) private view returns (uint128 sizeAfter) {
        sizeAfter = _sizeBefore + _sizeDelta;
        if (sizeAfter > _position.maxSizePerPosition)
            revert IMarketErrors.SizeExceedsMaxSizePerPosition(sizeAfter, _position.maxSizePerPosition);

        uint128 totalSizeAfter = _position.longSize + _position.shortSize + _sizeDelta;
        if (totalSizeAfter > _position.maxSize)
            revert IMarketErrors.SizeExceedsMaxSize(totalSizeAfter, _position.maxSize);
    }

    function _validateGlobalLiquidity(uint128 _globalLiquidity) private pure {
        if (_globalLiquidity == 0) revert IMarketErrors.InsufficientGlobalLiquidity();
    }

    function _increaseGlobalPosition(
        IMarketManager.GlobalPosition storage _globalPosition,
        Side _side,
        uint128 _size
    ) private {
        unchecked {
            if (_side.isLong()) _globalPosition.longSize += _size;
            else _globalPosition.shortSize += _size;
        }
    }

    function _decreaseGlobalPosition(
        IMarketManager.GlobalPosition storage _globalPosition,
        Side _side,
        uint128 _size
    ) private {
        unchecked {
            if (_side.isLong()) _globalPosition.longSize -= _size;
            else _globalPosition.shortSize -= _size;
        }
    }

    function _adjustFundingRateByLiquidation(
        IMarketManager.State storage _state,
        IMarketDescriptor _market,
        Side _side,
        int256 _requiredFundingFee,
        int256 _adjustedFundingFee
    ) private returns (int256 liquidationFundLoss) {
        int256 insufficientFundingFee = _adjustedFundingFee - _requiredFundingFee;
        IMarketManager.GlobalPosition memory globalPositionCache = _state.globalPosition;
        uint128 oppositeSize = _side.isLong() ? globalPositionCache.shortSize : globalPositionCache.longSize;
        if (oppositeSize > 0) {
            int192 insufficientFundingRateGrowthDeltaX96 = Math
                .mulDiv(uint256(insufficientFundingFee), Constants.Q96, oppositeSize)
                .toInt256()
                .toInt192();
            int192 longFundingRateGrowthAfterX96 = globalPositionCache.longFundingRateGrowthX96;
            int192 shortFundingRateGrowthAfterX96 = globalPositionCache.shortFundingRateGrowthX96;
            if (_side.isLong()) shortFundingRateGrowthAfterX96 -= insufficientFundingRateGrowthDeltaX96;
            else longFundingRateGrowthAfterX96 -= insufficientFundingRateGrowthDeltaX96;
            FundingRateUtil.snapshotAndAdjustGlobalFundingRate(
                _state,
                _market,
                0,
                longFundingRateGrowthAfterX96,
                shortFundingRateGrowthAfterX96
            );
        } else liquidationFundLoss = -insufficientFundingFee;
    }

    /// @notice Validate the position has not reached the liquidation margin rate
    function _validatePositionLiquidateMaintainMarginRate(
        IConfigurable.MarketBaseConfig storage _baseCfg,
        MaintainMarginRateParameter memory _parameter
    ) private view {
        int256 unrealizedPnL = calculateUnrealizedPnL(
            _parameter.side,
            _parameter.size,
            _parameter.entryPriceX96,
            _parameter.decreasePriceX96
        );
        uint256 maintenanceMargin = calculateMaintenanceMargin(
            _parameter.size,
            _parameter.entryPriceX96,
            _parameter.decreasePriceX96,
            _baseCfg.liquidationFeeRatePerPosition,
            _parameter.tradingFeeRate,
            _baseCfg.liquidationExecutionFee
        );
        int256 marginAfter = _parameter.margin + unrealizedPnL;
        if (!_parameter.liquidatablePosition) {
            if (_parameter.margin <= 0 || marginAfter <= 0 || maintenanceMargin >= uint256(marginAfter))
                revert IMarketErrors.MarginRateTooHigh(_parameter.margin, unrealizedPnL, maintenanceMargin);
        } else {
            if (_parameter.margin > 0 && marginAfter > 0 && maintenanceMargin < uint256(marginAfter))
                revert IMarketErrors.MarginRateTooLow(_parameter.margin, unrealizedPnL, maintenanceMargin);
        }
    }

    function _buildTradingFeeState(
        IConfigurable.MarketFeeRateConfig storage _feeRateCfg,
        IEFC _EFC,
        address _account
    ) private view returns (TradingFeeState memory state) {
        (state.referralToken, state.referralParentToken) = _EFC.referrerTokens(_account);

        if (state.referralToken == 0) state.tradingFeeRate = _feeRateCfg.tradingFeeRate;
        else {
            unchecked {
                uint256 discountedTradingFeeRate = Math.ceilDiv(
                    uint256(_feeRateCfg.tradingFeeRate) * _feeRateCfg.referralDiscountRate,
                    Constants.BASIS_POINTS_DIVISOR
                );
                state.tradingFeeRate = uint32(discountedTradingFeeRate);
            }

            state.referralReturnFeeRate = _feeRateCfg.referralReturnFeeRate;
            state.referralParentReturnFeeRate = _feeRateCfg.referralParentReturnFeeRate;
        }
    }
}
