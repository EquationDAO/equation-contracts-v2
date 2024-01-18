// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.0;

import "./Constants.sol";
import {Side} from "../types/Side.sol";
import "../core/interfaces/IMarketManager.sol";
import {M as Math} from "../libraries/Math.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";

library PriceUtil {
    using SafeCast for *;

    struct UpdatePriceStateParameter {
        IMarketDescriptor market;
        Side side;
        uint128 sizeDelta;
        uint160 indexPriceX96;
        uint8 liquidationVertexIndex;
        bool liquidation;
    }

    struct SimulateMoveStep {
        Side side;
        uint128 sizeLeft;
        uint160 indexPriceX96;
        uint160 basisIndexPriceX96;
        bool improveBalance;
        IMarketManager.PriceVertex from;
        IMarketManager.PriceVertex current;
        IMarketManager.PriceVertex to;
    }

    struct PriceStateCache {
        uint128 premiumRateX96;
        uint8 pendingVertexIndex;
        uint8 liquidationVertexIndex;
        uint8 currentVertexIndex;
        uint160 basisIndexPriceX96;
    }

    /// @notice Calculate trade price and update the price state when trader positions adjusted.
    /// @param _globalPosition Global position of the lp (will be updated)
    /// @param _priceState States of the price (will be updated)
    /// @return tradePriceX96 The average price of the adjustment
    function updatePriceState(
        IMarketManager.GlobalLiquidityPosition storage _globalPosition,
        IMarketManager.PriceState storage _priceState,
        UpdatePriceStateParameter memory _parameter
    ) internal returns (uint160 tradePriceX96) {
        if (_parameter.sizeDelta == 0) revert IMarketErrors.ZeroSizeDelta();
        IMarketManager.GlobalLiquidityPosition memory globalPositionCache = _globalPosition;
        PriceStateCache memory priceStateCache = PriceStateCache({
            premiumRateX96: _priceState.premiumRateX96,
            pendingVertexIndex: _priceState.pendingVertexIndex,
            liquidationVertexIndex: _parameter.liquidationVertexIndex,
            currentVertexIndex: _priceState.currentVertexIndex,
            basisIndexPriceX96: _priceState.basisIndexPriceX96
        });

        bool balanced = (globalPositionCache.netSize | globalPositionCache.liquidationBufferNetSize) == 0;
        if (balanced) priceStateCache.basisIndexPriceX96 = _parameter.indexPriceX96;

        bool improveBalance = _parameter.side == globalPositionCache.side && !balanced;
        (int256 tradePriceX96TimesSizeTotal, uint128 sizeLeft, uint128 totalBufferUsed) = _updatePriceState(
            globalPositionCache,
            _priceState,
            priceStateCache,
            _parameter,
            improveBalance
        );

        if (!improveBalance) {
            globalPositionCache.side = _parameter.side.flip();
            globalPositionCache.netSize += _parameter.sizeDelta - totalBufferUsed;
            globalPositionCache.liquidationBufferNetSize += totalBufferUsed;
        } else {
            // When the net position of LP decreases and reaches or crosses the vertex,
            // at least the vertex represented by (current, pending] needs to be updated
            if (priceStateCache.pendingVertexIndex > priceStateCache.currentVertexIndex) {
                IMarketManager(address(this)).changePriceVertex(
                    _parameter.market,
                    priceStateCache.currentVertexIndex,
                    priceStateCache.pendingVertexIndex
                );
                _priceState.pendingVertexIndex = priceStateCache.currentVertexIndex;
            }

            globalPositionCache.netSize -= _parameter.sizeDelta - sizeLeft - totalBufferUsed;
            globalPositionCache.liquidationBufferNetSize -= totalBufferUsed;
        }

        if (sizeLeft > 0) {
            assert((globalPositionCache.netSize | globalPositionCache.liquidationBufferNetSize) == 0);
            globalPositionCache.side = globalPositionCache.side.flip();

            balanced = true;
            priceStateCache.basisIndexPriceX96 = _parameter.indexPriceX96;

            uint128 sizeDeltaCopy = _parameter.sizeDelta;
            _parameter.sizeDelta = sizeLeft;
            (int256 tradePriceX96TimesSizeTotal2, , uint128 totalBufferUsed2) = _updatePriceState(
                globalPositionCache,
                _priceState,
                priceStateCache,
                _parameter,
                false
            );
            _parameter.sizeDelta = sizeDeltaCopy; // Restore the original value

            tradePriceX96TimesSizeTotal += tradePriceX96TimesSizeTotal2;

            globalPositionCache.netSize = sizeLeft - totalBufferUsed2;
            globalPositionCache.liquidationBufferNetSize = totalBufferUsed2;
        }

        if (tradePriceX96TimesSizeTotal < 0) revert IMarketErrors.InvalidTradePrice(tradePriceX96TimesSizeTotal);

        tradePriceX96 = _parameter.side.isLong()
            ? Math.ceilDiv(uint256(tradePriceX96TimesSizeTotal), _parameter.sizeDelta).toUint160()
            : (uint256(tradePriceX96TimesSizeTotal) / _parameter.sizeDelta).toUint160();

        // Write the changes back to storage
        _globalPosition.side = globalPositionCache.side;
        _globalPosition.netSize = globalPositionCache.netSize;
        _globalPosition.liquidationBufferNetSize = globalPositionCache.liquidationBufferNetSize;
        emit IMarketLiquidityPosition.GlobalLiquidityPositionNetPositionChanged(
            _parameter.market,
            globalPositionCache.side,
            globalPositionCache.netSize,
            globalPositionCache.liquidationBufferNetSize
        );
        if (balanced) {
            _priceState.basisIndexPriceX96 = priceStateCache.basisIndexPriceX96;
            emit IMarketManager.BasisIndexPriceChanged(_parameter.market, priceStateCache.basisIndexPriceX96);
        }
        _priceState.currentVertexIndex = priceStateCache.currentVertexIndex;
        _priceState.premiumRateX96 = priceStateCache.premiumRateX96;
        emit IMarketManager.PremiumRateChanged(_parameter.market, priceStateCache.premiumRateX96);
    }

    function _updatePriceState(
        IMarketManager.GlobalLiquidityPosition memory _globalPositionCache,
        IMarketManager.PriceState storage _priceState,
        PriceStateCache memory _priceStateCache,
        UpdatePriceStateParameter memory _parameter,
        bool _improveBalance
    ) internal returns (int256 tradePriceX96TimesSizeTotal, uint128 sizeLeft, uint128 totalBufferUsed) {
        SimulateMoveStep memory step = SimulateMoveStep({
            side: _parameter.side,
            sizeLeft: _parameter.sizeDelta,
            indexPriceX96: _parameter.indexPriceX96,
            basisIndexPriceX96: _priceStateCache.basisIndexPriceX96,
            improveBalance: _improveBalance,
            from: IMarketManager.PriceVertex(0, 0),
            current: IMarketManager.PriceVertex(_globalPositionCache.netSize, _priceStateCache.premiumRateX96),
            to: IMarketManager.PriceVertex(0, 0)
        });
        if (!step.improveBalance) {
            // Balance rate got worse
            if (_priceStateCache.currentVertexIndex == 0) _priceStateCache.currentVertexIndex = 1;
            uint8 end = _parameter.liquidation ? _priceStateCache.liquidationVertexIndex + 1 : Constants.VERTEX_NUM;
            for (uint8 i = _priceStateCache.currentVertexIndex; i < end && step.sizeLeft > 0; ++i) {
                (step.from, step.to) = (_priceState.priceVertices[i - 1], _priceState.priceVertices[i]);
                (int160 tradePriceX96, uint128 sizeUsed, , uint128 premiumRateAfterX96) = simulateMove(step);

                if (
                    sizeUsed < step.sizeLeft &&
                    !(_parameter.liquidation && i == _priceStateCache.liquidationVertexIndex)
                ) {
                    // Crossed
                    // prettier-ignore
                    unchecked { _priceStateCache.currentVertexIndex = i + 1; }
                    step.current = step.to;
                }

                // prettier-ignore
                unchecked { step.sizeLeft -= sizeUsed; }
                tradePriceX96TimesSizeTotal += tradePriceX96 * int256(uint256(sizeUsed));
                _priceStateCache.premiumRateX96 = premiumRateAfterX96;
            }

            if (step.sizeLeft > 0) {
                if (!_parameter.liquidation) revert IMarketErrors.MaxPremiumRateExceeded();

                step.current = step.from = step.to = _priceState.priceVertices[_priceStateCache.liquidationVertexIndex];
                (int160 tradePriceX96, , , ) = simulateMove(step);
                tradePriceX96TimesSizeTotal += tradePriceX96 * int256(uint256(step.sizeLeft));

                // prettier-ignore
                unchecked { totalBufferUsed += step.sizeLeft; }

                uint8 liquidationVertexIndex = _priceStateCache.liquidationVertexIndex;
                uint128 liquidationBufferNetSizeAfter = _priceState.liquidationBufferNetSizes[liquidationVertexIndex] +
                    step.sizeLeft;
                _priceState.liquidationBufferNetSizes[liquidationVertexIndex] = liquidationBufferNetSizeAfter;
                emit IMarketManager.LiquidationBufferNetSizeChanged(
                    _parameter.market,
                    liquidationVertexIndex,
                    liquidationBufferNetSizeAfter
                );
            }
        } else {
            // Balance rate got better, note that when `i` == 0, loop continues to use liquidation buffer in (0, 0)
            for (uint8 i = _priceStateCache.currentVertexIndex; i >= 0 && step.sizeLeft > 0; --i) {
                // Use liquidation buffer in `from`
                uint128 bufferSizeAfter = _priceState.liquidationBufferNetSizes[i];
                if (bufferSizeAfter > 0) {
                    step.from = step.to = _priceState.priceVertices[uint8(i)];
                    (int160 tradePriceX96, , , ) = simulateMove(step);
                    uint128 sizeUsed = uint128(Math.min(bufferSizeAfter, step.sizeLeft));
                    // prettier-ignore
                    unchecked { bufferSizeAfter -= sizeUsed; }
                    _priceState.liquidationBufferNetSizes[i] = bufferSizeAfter;
                    // prettier-ignore
                    unchecked { totalBufferUsed += sizeUsed; }

                    // prettier-ignore
                    unchecked { step.sizeLeft -= sizeUsed; }
                    tradePriceX96TimesSizeTotal += tradePriceX96 * int256(uint256(sizeUsed));
                    emit IMarketManager.LiquidationBufferNetSizeChanged(_parameter.market, i, bufferSizeAfter);
                }
                if (i == 0) break;
                if (step.sizeLeft > 0) {
                    step.from = _priceState.priceVertices[uint8(i)];
                    step.to = _priceState.priceVertices[uint8(i - 1)];
                    (int160 tradePriceX96, uint128 sizeUsed, bool reached, uint128 premiumRateAfterX96) = simulateMove(
                        step
                    );
                    if (reached) {
                        // Reached or crossed
                        _priceStateCache.currentVertexIndex = uint8(i - 1);
                        step.current = step.to;
                    }
                    // prettier-ignore
                    unchecked { step.sizeLeft -= sizeUsed; }
                    tradePriceX96TimesSizeTotal += tradePriceX96 * int256(uint256(sizeUsed));
                    _priceStateCache.premiumRateX96 = premiumRateAfterX96;
                }
            }
            sizeLeft = step.sizeLeft;
        }
    }

    function calculateAX248AndBX96(
        Side _globalSide,
        IMarketManager.PriceVertex memory _from,
        IMarketManager.PriceVertex memory _to
    ) internal pure returns (uint256 aX248, int256 bX96) {
        if (_from.size > _to.size) (_from, _to) = (_to, _from);
        assert(_to.premiumRateX96 >= _from.premiumRateX96);

        unchecked {
            uint128 sizeDelta = _to.size - _from.size;
            aX248 = Math.mulDivUp(_to.premiumRateX96 - _from.premiumRateX96, Constants.Q152, sizeDelta);

            uint256 numeratorPart1X96 = uint256(_from.premiumRateX96) * _to.size;
            uint256 numeratorPart2X96 = uint256(_to.premiumRateX96) * _from.size;
            if (_globalSide.isShort()) {
                if (numeratorPart1X96 >= numeratorPart2X96)
                    bX96 = ((numeratorPart1X96 - numeratorPart2X96) / sizeDelta).toInt256();
                else bX96 = -((numeratorPart2X96 - numeratorPart1X96) / sizeDelta).toInt256();
            } else {
                if (numeratorPart2X96 >= numeratorPart1X96)
                    bX96 = ((numeratorPart2X96 - numeratorPart1X96) / sizeDelta).toInt256();
                else bX96 = -((numeratorPart1X96 - numeratorPart2X96) / sizeDelta).toInt256();
            }
        }
    }

    function simulateMove(
        SimulateMoveStep memory _step
    ) internal pure returns (int160 tradePriceX96, uint128 sizeUsed, bool reached, uint128 premiumRateAfterX96) {
        (reached, sizeUsed) = calculateReachedAndSizeUsed(_step);
        premiumRateAfterX96 = calculatePremiumRateAfterX96(_step, reached, sizeUsed);
        uint128 premiumRateBeforeX96 = _step.current.premiumRateX96;
        (uint256 priceDeltaX96Down, uint256 priceDeltaX96Up) = Math.mulDiv2(
            _step.basisIndexPriceX96,
            uint256(premiumRateBeforeX96) + premiumRateAfterX96,
            Constants.Q96 << 1
        );

        if (_step.side.isLong())
            tradePriceX96 = _step.improveBalance
                ? (int256(uint256(_step.indexPriceX96)) - int256(priceDeltaX96Down)).toInt160()
                : (_step.indexPriceX96 + priceDeltaX96Up).toInt256().toInt160();
        else
            tradePriceX96 = _step.improveBalance
                ? (_step.indexPriceX96 + priceDeltaX96Down).toInt256().toInt160()
                : (int256(uint256(_step.indexPriceX96)) - int256(priceDeltaX96Up)).toInt160();
    }

    function calculateReachedAndSizeUsed(
        SimulateMoveStep memory _step
    ) internal pure returns (bool reached, uint128 sizeUsed) {
        uint128 sizeCost = _step.improveBalance
            ? _step.current.size - _step.to.size
            : _step.to.size - _step.current.size;
        reached = _step.sizeLeft >= sizeCost;
        sizeUsed = reached ? sizeCost : _step.sizeLeft;
    }

    function calculatePremiumRateAfterX96(
        SimulateMoveStep memory _step,
        bool _reached,
        uint128 _sizeUsed
    ) internal pure returns (uint128 premiumRateAfterX96) {
        if (_reached) {
            premiumRateAfterX96 = _step.to.premiumRateX96;
        } else {
            Side globalSide = _step.improveBalance ? _step.side : _step.side.flip();
            (uint256 aX248, int256 bX96) = calculateAX248AndBX96(globalSide, _step.from, _step.to);
            uint256 sizeAfter = _step.improveBalance ? _step.current.size - _sizeUsed : _step.current.size + _sizeUsed;
            if (globalSide.isLong()) bX96 = -bX96;
            premiumRateAfterX96 = (Math.mulDivUp(aX248, sizeAfter, Constants.Q152).toInt256() + bX96)
                .toUint256()
                .toUint128();
        }
    }

    function calculateMarketPriceX96(
        Side _globalSide,
        Side _side,
        uint160 _indexPriceX96,
        uint160 _basisIndexPriceX96,
        uint128 _premiumRateX96
    ) internal pure returns (uint160 marketPriceX96) {
        (uint256 priceDeltaX96Down, uint256 priceDeltaX96Up) = Math.mulDiv2(
            _basisIndexPriceX96,
            _premiumRateX96,
            Constants.Q96
        );
        if (_globalSide.isLong()) {
            if (_side.isLong())
                marketPriceX96 = (_indexPriceX96 > priceDeltaX96Down ? _indexPriceX96 - priceDeltaX96Down : 0)
                    .toUint160();
            else marketPriceX96 = (_indexPriceX96 > priceDeltaX96Up ? _indexPriceX96 - priceDeltaX96Up : 0).toUint160();
        } else
            marketPriceX96 = (_side.isLong() ? _indexPriceX96 + priceDeltaX96Up : _indexPriceX96 + priceDeltaX96Down)
                .toUint160();
    }
}
