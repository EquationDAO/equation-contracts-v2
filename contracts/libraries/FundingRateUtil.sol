// SPDX-License-Identifier: BUSL-1.1
pragma solidity =0.8.23;

import "./MarketUtil.sol";

/// @notice Utility library for calculating funding rates
library FundingRateUtil {
    using SafeCast for *;

    /// @notice Snapshot and adjust the global funding rate
    /// @param _state The state of the market
    /// @param _market The descriptor used to describe the metadata of the market, such as symbol, name, decimals
    /// @param _fundingRateDeltaX96 The delta of the funding rate, as a Q160.96
    /// @param _longFundingRateGrowthAfterX96 The long funding rate growth after the funding rate is updated,
    /// as a Q96.96
    /// @param _shortFundingRateGrowthAfterX96 The short funding rate growth after the funding rate is updated,
    /// as a Q96.96
    function snapshotAndAdjustGlobalFundingRate(
        IMarketManager.State storage _state,
        IMarketDescriptor _market,
        int256 _fundingRateDeltaX96,
        int192 _longFundingRateGrowthAfterX96,
        int192 _shortFundingRateGrowthAfterX96
    ) internal {
        // snapshot previous global funding rate
        _state.previousGlobalFundingRate.longFundingRateGrowthX96 = _state.globalPosition.longFundingRateGrowthX96;
        _state.previousGlobalFundingRate.shortFundingRateGrowthX96 = _state.globalPosition.shortFundingRateGrowthX96;

        _state.globalPosition.longFundingRateGrowthX96 = _longFundingRateGrowthAfterX96;
        _state.globalPosition.shortFundingRateGrowthX96 = _shortFundingRateGrowthAfterX96;
        emit IMarketPosition.FundingRateGrowthAdjusted(
            _market,
            _fundingRateDeltaX96,
            _longFundingRateGrowthAfterX96,
            _shortFundingRateGrowthAfterX96,
            _state.globalFundingRateSample.lastAdjustFundingRateTime
        );
    }

    /// @notice Sample the actual premium rate and calculate the funding rate
    /// @param _state The state of the market
    /// @param _cfg The base configuration of the market
    /// @param _priceFeed The address of the price feed
    /// @param _market The descriptor used to describe the metadata of the market, such as symbol, name, decimals
    function sampleAndAdjustFundingRate(
        IMarketManager.State storage _state,
        IConfigurable.MarketBaseConfig storage _cfg,
        IPriceFeed _priceFeed,
        IMarketDescriptor _market
    ) public {
        (bool shouldAdjustFundingRate, int256 fundingRateDeltaX96) = _samplePremiumRate(
            _state,
            _market,
            MarketUtil.chooseIndexPriceX96(_priceFeed, _market, _state.globalLiquidityPosition.side.flip()),
            _cfg.interestRate
        );

        if (shouldAdjustFundingRate) {
            (
                int256 clampedDeltaX96,
                int192 longGrowthAfterX96,
                int192 shortGrowthAfterX96
            ) = _calculateFundingRateGrowthX96(
                    _state,
                    _market,
                    fundingRateDeltaX96,
                    _cfg.maxFundingRate,
                    _priceFeed.getMaxPriceX96(_market)
                );

            snapshotAndAdjustGlobalFundingRate(
                _state,
                _market,
                clampedDeltaX96,
                longGrowthAfterX96,
                shortGrowthAfterX96
            );
        }
    }

    /// @notice Sample the premium rate
    /// @param _state The state of the market
    /// @param _market The descriptor used to describe the metadata of the market, such as symbol, name, decimals
    /// @param _interestRate The interest rate used to calculate the funding rate,
    /// denominated in ten thousandths of a bip (i.e. 1e-8)
    /// @return shouldAdjustFundingRate Indicates whether the funding rate should be adjusted
    /// @return fundingRateDeltaX96 The delta of the funding rate, as a Q160.96
    function _samplePremiumRate(
        IMarketManager.State storage _state,
        IMarketDescriptor _market,
        uint160 _indexPriceX96,
        uint32 _interestRate
    ) private returns (bool shouldAdjustFundingRate, int256 fundingRateDeltaX96) {
        IMarketManager.GlobalFundingRateSample storage sample = _state.globalFundingRateSample;
        uint64 lastAdjustFundingRateTime = sample.lastAdjustFundingRateTime;
        uint64 maxSamplingTime = lastAdjustFundingRateTime + Constants.ADJUST_FUNDING_RATE_INTERVAL;

        uint64 currentTimestamp = block.timestamp.toUint64();
        // At most 1 hour of premium rate sampling
        if (maxSamplingTime < currentTimestamp) currentTimestamp = maxSamplingTime;

        unchecked {
            uint64 lastSamplingTime = lastAdjustFundingRateTime +
                sample.sampleCount *
                Constants.SAMPLE_PREMIUM_RATE_INTERVAL;

            uint16 timeDelta = uint16(currentTimestamp - lastSamplingTime);
            if (timeDelta < Constants.SAMPLE_PREMIUM_RATE_INTERVAL) return (false, 0);

            IMarketManager.PriceState storage priceState = _state.priceState;
            // actualPremiumRate = marketPrice / indexPrice - 1
            //                   = (indexPrice + premiumRate * basisIndexPrice) / indexPrice - 1
            //                   = premiumRate * basisIndexPrice / indexPrice
            uint128 actualPremiumRateX96 = Math
                .mulDivUp(priceState.premiumRateX96, priceState.basisIndexPriceX96, _indexPriceX96)
                .toUint128();
            (shouldAdjustFundingRate, fundingRateDeltaX96) = _samplePremiumRateAndCalculateFundingRate(
                sample,
                _state.globalLiquidityPosition.side,
                actualPremiumRateX96,
                _interestRate,
                maxSamplingTime,
                timeDelta
            );

            emit IMarketPosition.GlobalFundingRateSampleAdjusted(
                _market,
                sample.sampleCount,
                sample.cumulativePremiumRateX96
            );
        }
    }

    function _samplePremiumRateAndCalculateFundingRate(
        IMarketPosition.GlobalFundingRateSample storage _sample,
        Side _side,
        uint128 _premiumRateX96,
        uint32 _interestRate,
        uint64 _maxSamplingTime,
        uint16 _timeDelta
    ) private returns (bool shouldAdjustFundingRate, int256 fundingRateDeltaX96) {
        // When the net position held by LP is long, the premium rate is negative, otherwise it is positive
        int176 premiumRateX96 = _side.isLong() ? -int176(uint176(_premiumRateX96)) : int176(uint176(_premiumRateX96));

        int176 cumulativePremiumRateX96;
        unchecked {
            // The number of samples is limited to a maximum of 720, so there will be no overflow here
            uint16 sampleCountDelta = _timeDelta / Constants.SAMPLE_PREMIUM_RATE_INTERVAL;
            uint16 sampleCountAfter = _sample.sampleCount + sampleCountDelta;
            // formula: cumulativePremiumRateDeltaX96 = premiumRateX96 * (n + (n+1) + (n+2) + ... + (n+m))
            // Since (n + (n+1) + (n+2) + ... + (n+m)) is at most equal to 259560, it can be stored using int24.
            // Additionally, since the type of premiumRateX96 is int136, storing the result of
            // type(int136).max * type(int24).max in int176 will not overflow
            int176 cumulativePremiumRateDeltaX96 = premiumRateX96 *
                int24(((uint24(_sample.sampleCount) + 1 + sampleCountAfter) * sampleCountDelta) >> 1);
            cumulativePremiumRateX96 = _sample.cumulativePremiumRateX96 + cumulativePremiumRateDeltaX96;

            // If the sample count is less than the required sample count, there is no need to update the funding rate
            if (sampleCountAfter < Constants.REQUIRED_SAMPLE_COUNT) {
                _sample.sampleCount = sampleCountAfter;
                _sample.cumulativePremiumRateX96 = cumulativePremiumRateX96;
                return (false, 0);
            }
        }

        int256 premiumRateAvgX96 = cumulativePremiumRateX96 >= 0
            ? int256(Math.ceilDiv(uint256(int256(cumulativePremiumRateX96)), Constants.PREMIUM_RATE_AVG_DENOMINATOR))
            : -int256(Math.ceilDiv(uint256(-int256(cumulativePremiumRateX96)), Constants.PREMIUM_RATE_AVG_DENOMINATOR));

        fundingRateDeltaX96 = premiumRateAvgX96 + _clamp(premiumRateAvgX96, _interestRate);

        // Update the sample data
        _sample.lastAdjustFundingRateTime = _maxSamplingTime;
        _sample.sampleCount = 0;
        _sample.cumulativePremiumRateX96 = 0;

        return (true, fundingRateDeltaX96);
    }

    /// @notice Calculate the funding rate growth
    /// @param _fundingRateDeltaX96 The delta of the funding rate, as a Q160.96
    /// @param _market The descriptor used to describe the metadata of the market, such as symbol, name, decimals
    /// @param _maxFundingRate The maximum funding rate, denominated in ten thousandths of a bip (i.e. 1e-8).
    /// If the funding rate exceeds the maximum funding rate, the funding rate will be clamped to the maximum funding
    /// rate. If the funding rate is less than the negative value of the maximum funding rate, the funding rate will
    /// be clamped to the negative value of the maximum funding rate
    /// @param _indexPriceX96 The index price, as a Q64.96
    /// @return clampedFundingRateDeltaX96 The clamped delta of the funding rate, as a Q160.96
    /// @return longFundingRateGrowthAfterX96 The long funding rate growth after the funding rate is updated, as
    /// a Q96.96
    /// @return shortFundingRateGrowthAfterX96 The short funding rate growth after the funding rate is updated, as
    /// a Q96.96
    function _calculateFundingRateGrowthX96(
        IMarketManager.State storage _state,
        IMarketDescriptor _market,
        int256 _fundingRateDeltaX96,
        uint32 _maxFundingRate,
        uint160 _indexPriceX96
    )
        private
        returns (
            int256 clampedFundingRateDeltaX96,
            int192 longFundingRateGrowthAfterX96,
            int192 shortFundingRateGrowthAfterX96
        )
    {
        // The funding rate is clamped to the maximum funding rate
        int256 maxFundingRateX96 = _calculateMaxFundingRateX96(_maxFundingRate);
        if (_fundingRateDeltaX96 > maxFundingRateX96) clampedFundingRateDeltaX96 = maxFundingRateX96;
        else if (_fundingRateDeltaX96 < -maxFundingRateX96) clampedFundingRateDeltaX96 = -maxFundingRateX96;
        else clampedFundingRateDeltaX96 = _fundingRateDeltaX96;

        IMarketManager.GlobalPosition memory globalPositionCache = _state.globalPosition;
        (uint128 paidSize, uint128 receivedSize, uint256 clampedFundingRateDeltaAbsX96) = clampedFundingRateDeltaX96 >=
            0
            ? (globalPositionCache.longSize, globalPositionCache.shortSize, uint256(clampedFundingRateDeltaX96))
            : (globalPositionCache.shortSize, globalPositionCache.longSize, uint256(-clampedFundingRateDeltaX96));

        if (paidSize == 0)
            return (
                clampedFundingRateDeltaX96,
                globalPositionCache.longFundingRateGrowthX96,
                globalPositionCache.shortFundingRateGrowthX96
            );

        // paidFundingRateGrowthDelta = (paidSize * price * fundingRate) / paidSize = price * fundingRate
        int192 paidFundingRateGrowthDeltaX96 = Math
            .mulDivUp(_indexPriceX96, clampedFundingRateDeltaAbsX96, Constants.Q96)
            .toInt256()
            .toInt192();

        int192 receivedFundingRateGrowthDeltaX96;
        if (paidFundingRateGrowthDeltaX96 > 0) {
            if (paidSize > receivedSize) {
                IMarketManager.GlobalLiquidityPosition storage globalLiquidityPosition = _state.globalLiquidityPosition;
                uint128 liquidity = globalLiquidityPosition.liquidity;
                // Because there is always a trading position when there is a liquidity position, the funding fee
                // will be distributed to the trading position and the liquidity position

                // PnLGrowthDelta = (paidSize - receivedSize) / paidSize * (paidSize * price * fundingRate)
                //                  / ((1 << 32) * liquidity)
                //                = (paidSize - receivedSize) * price * fundingRate / ((1 << 32) * liquidity)
                //                = (paidSize - receivedSize) * paidFundingRateGrowthDelta / ((1 << 32) * liquidity)
                int256 unrealizedPnLGrowthDeltaX64;
                unchecked {
                    unrealizedPnLGrowthDeltaX64 = Math
                        .mulDiv(
                            paidSize - receivedSize,
                            uint192(paidFundingRateGrowthDeltaX96),
                            Constants.Q32 * liquidity
                        )
                        .toInt256();
                }

                int256 unrealizedPnLGrowthAfterX64 = globalLiquidityPosition.unrealizedPnLGrowthX64 +
                    unrealizedPnLGrowthDeltaX64;
                globalLiquidityPosition.unrealizedPnLGrowthX64 = unrealizedPnLGrowthAfterX64;

                emit IMarketLiquidityPosition.GlobalLiquidityPositionPnLGrowthIncreasedByFundingFee(
                    _market,
                    unrealizedPnLGrowthAfterX64
                );

                // receivedFundingRateGrowthDelta = receivedSize / paidSize * (paidSize * price * fundingRate)
                //                                  / receivedSize
                //                                = price * fundingRate
                receivedFundingRateGrowthDeltaX96 = receivedSize == 0 ? int192(0) : paidFundingRateGrowthDeltaX96;
            } else {
                // receivedFundingRateGrowthDelta = (paidSize * price * fundingRate) / receivedSize
                //                                = (paidSize * paidFundingRateGrowthDelta) / receivedSize
                receivedFundingRateGrowthDeltaX96 = receivedSize == 0
                    ? int192(0)
                    : Math.mulDiv(paidSize, uint192(paidFundingRateGrowthDeltaX96), receivedSize).toInt256().toInt192();
            }
        }

        longFundingRateGrowthAfterX96 = globalPositionCache.longFundingRateGrowthX96;
        shortFundingRateGrowthAfterX96 = globalPositionCache.shortFundingRateGrowthX96;
        if (clampedFundingRateDeltaX96 >= 0) {
            longFundingRateGrowthAfterX96 -= paidFundingRateGrowthDeltaX96;
            shortFundingRateGrowthAfterX96 += receivedFundingRateGrowthDeltaX96;
        } else {
            shortFundingRateGrowthAfterX96 -= paidFundingRateGrowthDeltaX96;
            longFundingRateGrowthAfterX96 += receivedFundingRateGrowthDeltaX96;
        }
    }

    function _calculateMaxFundingRateX96(uint32 _maxFundingRate) private pure returns (int256 maxFundingRateX96) {
        return int256(Math.mulDivUp(_maxFundingRate, Constants.Q96, Constants.BASIS_POINTS_DIVISOR));
    }

    function _clamp(int256 _premiumRateAvgX96, uint32 _interestRate) private pure returns (int256) {
        int256 interestRateX96 = int256(Math.mulDivUp(_interestRate, Constants.Q96, Constants.BASIS_POINTS_DIVISOR));
        int256 rateDeltaX96 = interestRateX96 - _premiumRateAvgX96;
        if (rateDeltaX96 > Constants.PREMIUM_RATE_CLAMP_BOUNDARY_X96) return Constants.PREMIUM_RATE_CLAMP_BOUNDARY_X96;
        else if (rateDeltaX96 < -Constants.PREMIUM_RATE_CLAMP_BOUNDARY_X96)
            return -Constants.PREMIUM_RATE_CLAMP_BOUNDARY_X96;
        else return rateDeltaX96;
    }
}
