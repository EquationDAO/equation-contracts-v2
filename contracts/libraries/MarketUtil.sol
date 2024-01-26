// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.0;

import "./PriceUtil.sol";
import "./ConfigurableUtil.sol";
import "../IEquationContractsV1Minimum.sol";

/// @notice Utility library for market manager
library MarketUtil {
    using SafeCast for *;

    /// @notice `Gov` uses the liquidation fund
    /// @param _state The state of the market
    /// @param _market The descriptor used to describe the metadata of the market, such as symbol, name, decimals
    /// @param _liquidationFundDelta The amount of liquidation fund to be used
    /// @param _receiver The address to receive the liquidation fund
    function govUseLiquidationFund(
        IMarketManager.State storage _state,
        IMarketDescriptor _market,
        uint128 _liquidationFundDelta,
        address _receiver
    ) public {
        int256 liquidationFundAfter = _state.globalLiquidationFund.liquidationFund -
            int256(uint256(_liquidationFundDelta));
        if (liquidationFundAfter < _state.globalLiquidationFund.liquidity.toInt256())
            revert IMarketErrors.InsufficientLiquidationFund(_liquidationFundDelta);

        _state.globalLiquidationFund.liquidationFund = liquidationFundAfter;

        emit IMarketManager.GlobalLiquidationFundGovUsed(_market, _receiver, _liquidationFundDelta);
    }

    /// @notice Increase the liquidity of a liquidation fund position
    /// @param _state The state of the market
    /// @param _market The descriptor used to describe the metadata of the market, such as symbol, name, decimals
    /// @param _account The owner of the position
    /// @param _liquidityDelta The increase in liquidity
    function increaseLiquidationFundPosition(
        IMarketManager.State storage _state,
        IMarketDescriptor _market,
        address _account,
        uint128 _liquidityDelta
    ) public {
        _state.globalLiquidationFund.liquidity += _liquidityDelta;

        int256 liquidationFundAfter = _state.globalLiquidationFund.liquidationFund + int256(uint256(_liquidityDelta));
        _state.globalLiquidationFund.liquidationFund = liquidationFundAfter;

        unchecked {
            // Because `positionLiquidityAfter` is less than or equal to `globalLiquidityAfter`, it will not overflow
            uint256 positionLiquidityAfter = _state.liquidationFundPositions[_account] + _liquidityDelta;
            _state.liquidationFundPositions[_account] = positionLiquidityAfter;

            emit IMarketManager.LiquidationFundPositionIncreased(_market, _account, positionLiquidityAfter);
        }
    }

    /// @notice Decrease the liquidity of a liquidation fund position
    /// @param _state The state of the market
    /// @param _market The descriptor used to describe the metadata of the market, such as symbol, name, decimals
    /// @param _liquidityDelta The decrease in liquidity
    /// @param _receiver The address to receive the liquidity when it is decreased
    function decreaseLiquidationFundPosition(
        IMarketManager.State storage _state,
        IMarketDescriptor _market,
        address _account,
        uint128 _liquidityDelta,
        address _receiver
    ) public {
        uint256 positionLiquidity = _state.liquidationFundPositions[_account];
        if (positionLiquidity < _liquidityDelta)
            revert IMarketErrors.InsufficientLiquidityToDecrease(positionLiquidity, _liquidityDelta);

        if (_state.globalLiquidationFund.liquidationFund < _state.globalLiquidationFund.liquidity.toInt256())
            revert IMarketErrors.LiquidationFundLoss();

        unchecked {
            _state.globalLiquidationFund.liquidity -= _liquidityDelta;
            _state.globalLiquidationFund.liquidationFund -= int256(uint256(_liquidityDelta));

            uint256 positionLiquidityAfter = positionLiquidity - _liquidityDelta;
            _state.liquidationFundPositions[_account] = positionLiquidityAfter;

            emit IMarketManager.LiquidationFundPositionDecreased(_market, _account, positionLiquidityAfter, _receiver);
        }
    }

    /// @notice Change the price vertices of a market
    /// @param _state The state of the market
    /// @param _marketPriceCfg The price configuration of the market
    /// @param _market The descriptor used to describe the metadata of the market, such as symbol, name, decimals
    /// @param _indexPriceX96 The index price used to calculate the price vertices, as a Q64.96
    function changePriceVertices(
        IMarketManager.State storage _state,
        IConfigurable.MarketPriceConfig storage _marketPriceCfg,
        IMarketDescriptor _market,
        uint160 _indexPriceX96
    ) internal {
        IMarketManager.PriceState storage priceState = _state.priceState;
        uint8 currentVertexIndex = priceState.currentVertexIndex;
        priceState.pendingVertexIndex = currentVertexIndex;

        changePriceVertex(
            _state,
            _marketPriceCfg,
            _market,
            _indexPriceX96,
            currentVertexIndex,
            Constants.LATEST_VERTEX
        );
    }

    function changePriceVertex(
        IMarketManager.State storage _state,
        IConfigurable.MarketPriceConfig storage _marketPriceCfg,
        IMarketDescriptor _market,
        uint160 _indexPriceX96,
        uint8 _startExclusive,
        uint8 _endInclusive
    ) internal {
        uint128 liquidity = uint128(
            Math.min(_state.globalLiquidityPosition.liquidity, _marketPriceCfg.maxPriceImpactLiquidity)
        );

        unchecked {
            IMarketManager.PriceVertex[10] storage priceVertices = _state.priceState.priceVertices;
            IConfigurable.VertexConfig[10] storage vertexCfgs = _marketPriceCfg.vertices;
            for (uint8 index = _startExclusive + 1; index <= _endInclusive; ++index) {
                (uint128 sizeAfter, uint128 premiumRateAfterX96) = _calculatePriceVertex(
                    vertexCfgs[index],
                    liquidity,
                    _indexPriceX96
                );
                if (index > 1) {
                    IMarketManager.PriceVertex memory previous = priceVertices[index - 1];
                    if (previous.size >= sizeAfter || previous.premiumRateX96 >= premiumRateAfterX96)
                        (sizeAfter, premiumRateAfterX96) = (previous.size, previous.premiumRateX96);
                }

                priceVertices[index].size = sizeAfter;
                priceVertices[index].premiumRateX96 = premiumRateAfterX96;
                emit IMarketManager.PriceVertexChanged(_market, index, sizeAfter, premiumRateAfterX96);

                // If the vertex represented by end is the same as the vertex represented by end + 1,
                // then the vertices in range (start, LATEST_VERTEX] need to be updated
                if (index == _endInclusive && _endInclusive < Constants.LATEST_VERTEX) {
                    IMarketManager.PriceVertex memory next = priceVertices[index + 1];
                    if (sizeAfter >= next.size || premiumRateAfterX96 >= next.premiumRateX96)
                        _endInclusive = Constants.LATEST_VERTEX;
                }
            }
        }
    }

    /// @notice Validate the leverage of a position
    /// @param _margin The margin of the position
    /// @param _liquidity The liquidity of the position
    /// @param _maxLeverage The maximum acceptable leverage of the position
    function validateLeverage(uint256 _margin, uint128 _liquidity, uint32 _maxLeverage) internal pure {
        if (_margin * _maxLeverage < _liquidity)
            revert IMarketErrors.LeverageTooHigh(_margin, _liquidity, _maxLeverage);
    }

    /// @notice Validate the margin of a position
    /// @param _margin The margin of the position
    /// @param _minMargin The minimum acceptable margin of the position
    function validateMargin(uint128 _margin, uint64 _minMargin) internal pure {
        if (_margin < _minMargin) revert IMarketErrors.InsufficientMargin();
    }

    /// @notice Initialize the previous Settlement Point Price if it is not initialized
    /// @dev This function MUST be called when the trader's position is changed, to ensure that the LP can correctly
    /// initialize the Settlment Point Price after holding the net position
    /// @param _market The descriptor used to describe the metadata of the market, such as symbol, name, decimals
    /// @param _indexPriceX96 The index price when operating the trader's position, as a Q64.96
    function initializePreviousSPPrice(
        IMarketManager.GlobalLiquidityPosition storage _position,
        IMarketDescriptor _market,
        uint160 _indexPriceX96
    ) internal {
        if ((_position.netSize | _position.liquidationBufferNetSize) == 0) {
            _position.previousSPPriceX96 = _indexPriceX96;
            emit IMarketLiquidityPosition.PreviousSPPriceInitialized(_market, _indexPriceX96);
        }
    }

    /// @notice Settle the unrealized PnL of the LP position
    /// @dev This function MUST be called before the following actions:
    ///     1. Increase liquidity's position
    ///     2. Decrease liquidity's position
    ///     3. Liquidate liquidity's position
    ///     4. Increase trader's position
    ///     5. Decrease trader's position
    ///     6. Liquidate trader's position
    /// @param _state The state of market
    /// @param _priceFeed The price feed of the market
    function settleLiquidityUnrealizedPnL(
        IMarketManager.State storage _state,
        IPriceFeed _priceFeed,
        IMarketDescriptor _market
    ) internal {
        IMarketManager.GlobalLiquidityPosition storage globalLiquidityPosition = _state.globalLiquidityPosition;
        uint256 totalNetSize;
        unchecked {
            totalNetSize = uint256(globalLiquidityPosition.netSize) + globalLiquidityPosition.liquidationBufferNetSize;
        }
        if (totalNetSize == 0) return;

        Side side = globalLiquidityPosition.side;
        uint160 spPriceAfterX96 = chooseDecreaseIndexPriceX96(_priceFeed, _market, side);
        int256 priceDeltaX96 = int256(uint256(spPriceAfterX96)) -
            int256(uint256(globalLiquidityPosition.previousSPPriceX96));
        int256 totalNetSizeInt256 = side.isLong() ? int256(totalNetSize) : -int256(totalNetSize);
        bool isSameSign = (priceDeltaX96 ^ totalNetSizeInt256) >= 0;
        // abs(priceDeltaX96) * totalNetSize / (liquidity * (1 << 32))
        int256 unrealizedPnLGrowthDeltaX64 = Math
            .mulDiv(
                priceDeltaX96 >= 0 ? uint256(priceDeltaX96) : uint256(-priceDeltaX96),
                totalNetSize,
                Constants.Q32 * globalLiquidityPosition.liquidity,
                isSameSign ? Math.Rounding.Down : Math.Rounding.Up
            )
            .toInt256();
        int256 unrealizedPnLGrowthAfterX64 = globalLiquidityPosition.unrealizedPnLGrowthX64 +
            (isSameSign ? unrealizedPnLGrowthDeltaX64 : -unrealizedPnLGrowthDeltaX64);

        globalLiquidityPosition.unrealizedPnLGrowthX64 = unrealizedPnLGrowthAfterX64;
        globalLiquidityPosition.previousSPPriceX96 = spPriceAfterX96;

        emit IMarketLiquidityPosition.SettlementPointReached(_market, unrealizedPnLGrowthAfterX64, spPriceAfterX96);
    }

    /// @dev The function selects the appropriate index price based on the given side (Long or Short).
    /// For Long positions, it returns the minimum index price; for Short positions, it returns the maximum
    /// index price.
    /// @param _side The side of the position: Long for decreasing long position, Short for decreasing short position.
    /// @return indexPriceX96 The selected index price, as a Q64.96
    function chooseDecreaseIndexPriceX96(
        IPriceFeed _priceFeed,
        IMarketDescriptor _market,
        Side _side
    ) internal view returns (uint160) {
        return chooseIndexPriceX96(_priceFeed, _market, _side.flip());
    }

    /// @dev The function selects the appropriate index price based on the given side (Long or Short).
    /// For Long positions, it returns the maximum index price; for Short positions, it returns the minimum
    /// index price.
    /// @param _side The side of the position: Long for increasing long position or decreasing short position,
    /// Short for increasing short position or decreasing long position.
    /// @return indexPriceX96 The selected index price, as a Q64.96
    function chooseIndexPriceX96(
        IPriceFeed _priceFeed,
        IMarketDescriptor _market,
        Side _side
    ) internal view returns (uint160) {
        return _side.isLong() ? _priceFeed.getMaxPriceX96(_market) : _priceFeed.getMinPriceX96(_market);
    }

    function _validateGlobalLiquidity(uint128 _globalLiquidity) private pure {
        if (_globalLiquidity == 0) revert IMarketErrors.InsufficientGlobalLiquidity();
    }

    function _calculatePriceVertex(
        IConfigurable.VertexConfig memory _vertexCfg,
        uint128 _liquidity,
        uint160 _indexPriceX96
    ) private pure returns (uint128 size, uint128 premiumRateX96) {
        unchecked {
            uint256 balanceRateX96 = (Constants.Q96 * _vertexCfg.balanceRate) / Constants.BASIS_POINTS_DIVISOR;
            size = Math.mulDiv(balanceRateX96, _liquidity, _indexPriceX96).toUint128();

            premiumRateX96 = uint128((Constants.Q96 * _vertexCfg.premiumRate) / Constants.BASIS_POINTS_DIVISOR);
        }
    }
}
