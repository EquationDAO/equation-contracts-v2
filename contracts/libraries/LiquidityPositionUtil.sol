// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.0;

import "./MarketUtil.sol";

/// @notice Utility library for managing liquidity positions
library LiquidityPositionUtil {
    using SafeCast for *;

    struct IncreaseLiquidityPositionParameter {
        IMarketDescriptor market;
        address account;
        uint128 marginDelta;
        uint128 liquidityDelta;
        IPriceFeed priceFeed;
    }

    struct DecreaseLiquidityPositionParameter {
        IMarketDescriptor market;
        address account;
        uint128 marginDelta;
        uint128 liquidityDelta;
        IPriceFeed priceFeed;
        address receiver;
    }

    struct LiquidateLiquidityPositionParameter {
        IMarketDescriptor market;
        address account;
        IPriceFeed priceFeed;
        address feeReceiver;
    }

    function increaseLiquidityPosition(
        IMarketManager.State storage _state,
        IConfigurable.MarketConfig storage _marketCfg,
        IncreaseLiquidityPositionParameter memory _parameter
    ) public returns (uint128 marginAfter) {
        MarketUtil.settleLiquidityUnrealizedPnL(_state, _parameter.priceFeed, _parameter.market);

        IConfigurable.MarketBaseConfig storage baseCfg = _marketCfg.baseConfig;
        IMarketManager.LiquidityPosition memory positionCache = _state.liquidityPositions[_parameter.account];
        IMarketManager.GlobalLiquidityPosition storage globalLiquidityPosition = _state.globalLiquidityPosition;
        int256 realizedPnLDelta;
        if (positionCache.liquidity == 0) {
            if (_parameter.liquidityDelta == 0) revert IMarketErrors.LiquidityPositionNotFound(_parameter.account);

            MarketUtil.validateMargin(_parameter.marginDelta, baseCfg.minMarginPerLiquidityPosition);
        } else {
            realizedPnLDelta = _calculateRealizedPnL(globalLiquidityPosition, positionCache);
        }

        int256 marginAfterInt256;
        // prettier-ignore
        { marginAfterInt256 = int256(uint256(positionCache.margin) + _parameter.marginDelta); }
        marginAfterInt256 += realizedPnLDelta;
        if (marginAfterInt256 <= 0) revert IMarketErrors.InsufficientMargin();

        marginAfter = uint256(marginAfterInt256).toUint128();
        uint128 liquidityAfter = positionCache.liquidity;
        if (_parameter.liquidityDelta > 0) {
            liquidityAfter += _parameter.liquidityDelta;

            MarketUtil.validateLeverage(marginAfter, liquidityAfter, baseCfg.maxLeveragePerLiquidityPosition);
            globalLiquidityPosition.liquidity = globalLiquidityPosition.liquidity + _parameter.liquidityDelta;
        }

        _validateLiquidityPositionRiskRate(baseCfg, marginAfterInt256, liquidityAfter, false);

        IMarketManager.LiquidityPosition storage position = _state.liquidityPositions[_parameter.account];
        position.margin = marginAfter;
        position.liquidity = liquidityAfter;
        position.entryUnrealizedPnLGrowthX64 = globalLiquidityPosition.unrealizedPnLGrowthX64;

        emit IMarketLiquidityPosition.LiquidityPositionIncreased(
            _parameter.market,
            _parameter.account,
            _parameter.marginDelta,
            marginAfter,
            liquidityAfter,
            realizedPnLDelta
        );
    }

    function decreaseLiquidityPosition(
        IMarketManager.State storage _state,
        IConfigurable.MarketConfig storage _marketCfg,
        DecreaseLiquidityPositionParameter memory _parameter
    ) public returns (uint128 marginAfter, uint128 adjustedMarginDelta) {
        MarketUtil.settleLiquidityUnrealizedPnL(_state, _parameter.priceFeed, _parameter.market);

        IMarketManager.LiquidityPosition memory positionCache = _state.liquidityPositions[_parameter.account];
        if (positionCache.liquidity == 0) revert IMarketErrors.LiquidityPositionNotFound(_parameter.account);

        if (positionCache.liquidity < _parameter.liquidityDelta)
            revert IMarketErrors.InsufficientLiquidityToDecrease(positionCache.liquidity, _parameter.liquidityDelta);

        IMarketManager.GlobalLiquidityPosition storage globalLiquidityPosition = _state.globalLiquidityPosition;
        int256 realizedPnLDelta = _calculateRealizedPnL(globalLiquidityPosition, positionCache);

        int256 marginAfterInt256 = int256(uint256(positionCache.margin));
        marginAfterInt256 += realizedPnLDelta - int256(uint256(_parameter.marginDelta));
        if (marginAfterInt256 < 0) revert IMarketErrors.InsufficientMargin();

        uint128 liquidityAfter = positionCache.liquidity;
        if (_parameter.liquidityDelta > 0) {
            _decreaseGlobalLiquidity(globalLiquidityPosition, _state.globalPosition, _parameter.liquidityDelta);
            // prettier-ignore
            unchecked { liquidityAfter = positionCache.liquidity - _parameter.liquidityDelta; }
        }

        marginAfter = uint256(marginAfterInt256).toUint128();
        if (liquidityAfter > 0) {
            IConfigurable.MarketBaseConfig storage baseCfg = _marketCfg.baseConfig;
            _validateLiquidityPositionRiskRate(baseCfg, marginAfterInt256, liquidityAfter, false);
            if (_parameter.marginDelta > 0)
                MarketUtil.validateLeverage(marginAfter, liquidityAfter, baseCfg.maxLeveragePerLiquidityPosition);

            // Update position
            IMarketManager.LiquidityPosition storage position = _state.liquidityPositions[_parameter.account];
            position.margin = marginAfter;
            position.liquidity = liquidityAfter;
            position.entryUnrealizedPnLGrowthX64 = globalLiquidityPosition.unrealizedPnLGrowthX64;
        } else {
            // If the position is closed, the marginDelta needs to be added back to ensure that the
            // remaining margin of the position is 0.
            _parameter.marginDelta += marginAfter;
            marginAfter = 0;

            // Delete position
            delete _state.liquidityPositions[_parameter.account];
        }

        adjustedMarginDelta = _parameter.marginDelta;

        emit IMarketLiquidityPosition.LiquidityPositionDecreased(
            _parameter.market,
            _parameter.account,
            _parameter.marginDelta,
            marginAfter,
            liquidityAfter,
            realizedPnLDelta,
            _parameter.receiver
        );
    }

    function liquidateLiquidityPosition(
        IMarketManager.State storage _state,
        IConfigurable.MarketConfig storage _marketCfg,
        LiquidateLiquidityPositionParameter memory _parameter
    ) public returns (uint64 liquidationExecutionFee) {
        MarketUtil.settleLiquidityUnrealizedPnL(_state, _parameter.priceFeed, _parameter.market);

        IMarketManager.LiquidityPosition memory positionCache = _state.liquidityPositions[_parameter.account];
        if (positionCache.liquidity == 0) revert IMarketErrors.LiquidityPositionNotFound(_parameter.account);

        IMarketManager.GlobalLiquidityPosition storage globalLiquidityPosition = _state.globalLiquidityPosition;
        int256 realizedPnLDelta = _calculateRealizedPnL(globalLiquidityPosition, positionCache);

        int256 marginAfter = int256(uint256(positionCache.margin)) + realizedPnLDelta;
        IConfigurable.MarketBaseConfig storage baseCfg = _marketCfg.baseConfig;
        _validateLiquidityPositionRiskRate(baseCfg, marginAfter, positionCache.liquidity, true);

        // Update global liquidity position
        _decreaseGlobalLiquidity(globalLiquidityPosition, _state.globalPosition, positionCache.liquidity);

        liquidationExecutionFee = baseCfg.liquidationExecutionFee;
        marginAfter -= int256(uint256(liquidationExecutionFee));

        int256 unrealizedPnLGrowthAfterX64 = globalLiquidityPosition.unrealizedPnLGrowthX64;
        if (marginAfter < 0) {
            uint256 liquidationLoss;
            // Even if `marginAfter` is `type(int256).min`, the unsafe type conversion
            // will still produce the correct result
            // prettier-ignore
            unchecked { liquidationLoss = uint256(-marginAfter); }

            int256 unrealizedPnLGrowthDeltaX64 = Math
                .mulDiv(liquidationLoss, Constants.Q64, globalLiquidityPosition.liquidity, Math.Rounding.Up)
                .toInt256();
            unrealizedPnLGrowthAfterX64 -= unrealizedPnLGrowthDeltaX64;

            globalLiquidityPosition.unrealizedPnLGrowthX64 = unrealizedPnLGrowthAfterX64;
        } else {
            _state.globalLiquidationFund.liquidationFund += marginAfter;
        }

        delete _state.liquidityPositions[_parameter.account];

        emit IMarketLiquidityPosition.LiquidityPositionLiquidated(
            _parameter.market,
            _parameter.account,
            msg.sender,
            marginAfter,
            unrealizedPnLGrowthAfterX64,
            _parameter.feeReceiver
        );
    }

    function _decreaseGlobalLiquidity(
        IMarketManager.GlobalLiquidityPosition storage _globalLiquidityPosition,
        IMarketManager.GlobalPosition storage _globalPosition,
        uint128 _liquidityDelta
    ) private {
        unchecked {
            uint128 liquidityAfter = _globalLiquidityPosition.liquidity - _liquidityDelta;
            if (liquidityAfter == 0 && (_globalPosition.longSize | _globalPosition.shortSize) > 0)
                revert IMarketErrors.LastLiquidityPositionCannotBeClosed();
            _globalLiquidityPosition.liquidity = liquidityAfter;
        }
    }

    function _validateLiquidityPositionRiskRate(
        IConfigurable.MarketBaseConfig storage _baseCfg,
        int256 _margin,
        uint128 _liquidity,
        bool _liquidatablePosition
    ) private view {
        unchecked {
            uint256 maintenanceMargin = Math.ceilDiv(
                uint256(_liquidity) * _baseCfg.liquidationFeeRatePerLiquidityPosition,
                Constants.BASIS_POINTS_DIVISOR
            ) + _baseCfg.liquidationExecutionFee;
            if (!_liquidatablePosition) {
                if (_margin < 0 || maintenanceMargin >= uint256(_margin))
                    revert IMarketErrors.RiskRateTooHigh(_margin, maintenanceMargin);
            } else {
                if (_margin >= 0 && maintenanceMargin < uint256(_margin))
                    revert IMarketErrors.RiskRateTooLow(_margin, maintenanceMargin);
            }
        }
    }

    function _calculateRealizedPnL(
        IMarketManager.GlobalLiquidityPosition storage _globalLiquidityPosition,
        IMarketManager.LiquidityPosition memory _positionCache
    ) private view returns (int256 realizedPnL) {
        int256 unrealizedPnLGrowthDeltaX64 = (_globalLiquidityPosition.unrealizedPnLGrowthX64 -
            _positionCache.entryUnrealizedPnLGrowthX64);

        realizedPnL = unrealizedPnLGrowthDeltaX64 >= 0
            ? Math.mulDiv(uint256(unrealizedPnLGrowthDeltaX64), _positionCache.liquidity, Constants.Q64).toInt256()
            : -Math.mulDivUp(uint256(-unrealizedPnLGrowthDeltaX64), _positionCache.liquidity, Constants.Q64).toInt256();
    }
}
