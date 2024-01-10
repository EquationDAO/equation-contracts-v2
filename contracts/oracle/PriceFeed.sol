// SPDX-License-Identifier: BUSL-1.1
pragma solidity =0.8.23;

import "../libraries/Constants.sol";
import {M as Math} from "../libraries/Math.sol";
import "./interfaces/IPriceFeed.sol";
import "../governance/Governable.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";

contract PriceFeed is IPriceFeed, Governable {
    using SafeCast for *;

    /// @dev value difference precision
    uint256 public constant DELTA_PRECISION = 1000 * 1000;
    /// @dev seconds after l2 sequencer comes back online that we start accepting price feed data.
    uint256 public constant GRACE_PERIOD_TIME = 30 minutes;
    uint8 public constant USD_DECIMALS = 6;
    uint8 public constant MARKET_DECIMALS = 18;

    /// @inheritdoc IPriceFeed
    IChainLinkAggregator public override stableMarketPriceFeed;
    /// @inheritdoc IPriceFeed
    uint32 public override stableMarketPriceFeedHeartBeatDuration;
    /// @inheritdoc IPriceFeed
    IChainLinkAggregator public override sequencerUptimeFeed;
    bool public immutable override ignoreReferencePriceFeedError;

    Slot private slot0;
    mapping(address => bool) private updaters;
    mapping(IMarketDescriptor market => MarketConfig) private marketConfigs0;

    /// @dev latest price
    mapping(IMarketDescriptor market => PricePack) private latestPrices0;
    mapping(IMarketDescriptor market => PriceDataItem) private priceDataItems;

    modifier onlyUpdater() {
        if (!updaters[msg.sender]) revert Forbidden();
        _;
    }

    constructor(
        IChainLinkAggregator _stableMarketPriceFeed,
        uint32 _stableMarketPriceFeedHeartBeatDuration,
        bool _ignoreReferencePriceFeedError
    ) {
        (slot0.maxDeviationRatio, slot0.cumulativeRoundDuration, slot0.updateTxTimeout) = (100e3, 1 minutes, 1 minutes);
        stableMarketPriceFeed = _stableMarketPriceFeed;
        stableMarketPriceFeedHeartBeatDuration = _stableMarketPriceFeedHeartBeatDuration;
        ignoreReferencePriceFeedError = _ignoreReferencePriceFeedError;
    }

    /// @inheritdoc IPriceFeed
    function calculatePriceX96s(
        MarketPrice[] calldata _marketPrices
    ) external view returns (uint160[] memory minPriceX96s, uint160[] memory maxPriceX96s) {
        uint256 priceX96sLength = _marketPrices.length;

        minPriceX96s = new uint160[](priceX96sLength);
        maxPriceX96s = new uint160[](priceX96sLength);
        (uint256 stableMarketPrice, uint8 stableMarketDecimals) = _getStableMarketPrice();
        for (uint256 i; i < priceX96sLength; ++i) {
            uint160 priceX96 = _marketPrices[i].priceX96;
            IMarketDescriptor market = _marketPrices[i].market;
            MarketConfig memory config = marketConfigs0[market];
            if (address(config.refPriceFeed) == address(0)) {
                if (!ignoreReferencePriceFeedError) revert ReferencePriceFeedNotSet();
                minPriceX96s[i] = priceX96;
                maxPriceX96s[i] = priceX96;
                continue;
            }

            (uint160 latestRefPriceX96, uint160 minRefPriceX96, uint160 maxRefPriceX96) = _getReferencePriceX96(
                config.refPriceFeed,
                config.refHeartbeatDuration,
                stableMarketPrice,
                stableMarketDecimals
            );

            (, bool reachMaxDeltaDiff) = _calculateNewPriceDataItem(
                market,
                priceX96,
                latestRefPriceX96,
                config.maxCumulativeDeltaDiff
            );

            (minPriceX96s[i], maxPriceX96s[i]) = _reviseMinAndMaxPriceX96(
                priceX96,
                minRefPriceX96,
                maxRefPriceX96,
                reachMaxDeltaDiff
            );
        }
        return (minPriceX96s, maxPriceX96s);
    }

    /// @inheritdoc IPriceFeed
    function setPriceX96s(MarketPrice[] calldata _marketPrices, uint64 _timestamp) external override onlyUpdater {
        uint256 marketPricesLength = _marketPrices.length;
        _checkSequencerUp();
        (uint256 stableMarketPrice, uint8 stableMarketDecimals) = _getStableMarketPrice();
        for (uint256 i; i < marketPricesLength; ++i) {
            uint160 priceX96 = _marketPrices[i].priceX96;
            IMarketDescriptor market = _marketPrices[i].market;
            PricePack storage pack = latestPrices0[market];
            if (!_setMarketLastUpdated(pack, _timestamp)) continue;
            MarketConfig memory config = marketConfigs0[market];
            if (address(config.refPriceFeed) == address(0)) {
                if (!ignoreReferencePriceFeedError) revert ReferencePriceFeedNotSet();
                pack.minPriceX96 = priceX96;
                pack.maxPriceX96 = priceX96;
                emit PriceUpdated(market, priceX96, priceX96, priceX96);
                continue;
            }
            (uint160 latestRefPriceX96, uint160 minRefPriceX96, uint160 maxRefPriceX96) = _getReferencePriceX96(
                config.refPriceFeed,
                config.refHeartbeatDuration,
                stableMarketPrice,
                stableMarketDecimals
            );

            (PriceDataItem memory newItem, bool reachMaxDeltaDiff) = _calculateNewPriceDataItem(
                market,
                priceX96,
                latestRefPriceX96,
                config.maxCumulativeDeltaDiff
            );
            priceDataItems[market] = newItem;

            if (reachMaxDeltaDiff)
                emit MaxCumulativeDeltaDiffExceeded(
                    market,
                    priceX96,
                    latestRefPriceX96,
                    newItem.cumulativePriceDelta,
                    newItem.cumulativeRefPriceDelta
                );
            (uint160 minPriceX96, uint160 maxPriceX96) = _reviseMinAndMaxPriceX96(
                priceX96,
                minRefPriceX96,
                maxRefPriceX96,
                reachMaxDeltaDiff
            );
            pack.minPriceX96 = minPriceX96;
            pack.maxPriceX96 = maxPriceX96;
            emit PriceUpdated(market, priceX96, minPriceX96, maxPriceX96);
        }
    }

    /// @inheritdoc IPriceFeed
    function getMinPriceX96(IMarketDescriptor _market) external view override returns (uint160 priceX96) {
        _checkSequencerUp();
        priceX96 = latestPrices0[_market].minPriceX96;
        if (priceX96 == 0) revert NotInitialized();
    }

    /// @inheritdoc IPriceFeed
    function getMaxPriceX96(IMarketDescriptor _market) external view override returns (uint160 priceX96) {
        _checkSequencerUp();
        priceX96 = latestPrices0[_market].maxPriceX96;
        if (priceX96 == 0) revert NotInitialized();
    }

    /// @inheritdoc IPriceFeed
    function setUpdater(address _account, bool _active) external override onlyGov {
        updaters[_account] = _active;
    }

    /// @inheritdoc IPriceFeed
    function isUpdater(address _account) external view override returns (bool active) {
        return updaters[_account];
    }

    /// @inheritdoc IPriceFeed
    function setRefPriceFeed(IMarketDescriptor _market, IChainLinkAggregator _priceFeed) external override onlyGov {
        marketConfigs0[_market].refPriceFeed = _priceFeed;
    }

    /// @inheritdoc IPriceFeed
    function setSequencerUptimeFeed(IChainLinkAggregator _sequencerUptimeFeed) external override onlyGov {
        sequencerUptimeFeed = _sequencerUptimeFeed;
    }

    /// @inheritdoc IPriceFeed
    function setRefHeartbeatDuration(IMarketDescriptor _market, uint32 _duration) external override onlyGov {
        marketConfigs0[_market].refHeartbeatDuration = _duration;
    }

    /// @inheritdoc IPriceFeed
    function setMaxDeviationRatio(uint32 _maxDeviationRatio) external override onlyGov {
        slot0.maxDeviationRatio = _maxDeviationRatio;
    }

    /// @inheritdoc IPriceFeed
    function setCumulativeRoundDuration(uint32 _cumulativeRoundDuration) external override onlyGov {
        slot0.cumulativeRoundDuration = _cumulativeRoundDuration;
    }

    /// @inheritdoc IPriceFeed
    function setMaxCumulativeDeltaDiffs(
        IMarketDescriptor _market,
        uint64 _maxCumulativeDeltaDiff
    ) external override onlyGov {
        marketConfigs0[_market].maxCumulativeDeltaDiff = _maxCumulativeDeltaDiff;
    }

    /// @inheritdoc IPriceFeed
    function setRefPriceExtraSample(uint32 _refPriceExtraSample) external override onlyGov {
        slot0.refPriceExtraSample = _refPriceExtraSample;
    }

    /// @inheritdoc IPriceFeed
    function setUpdateTxTimeout(uint32 _updateTxTimeout) external override onlyGov {
        slot0.updateTxTimeout = _updateTxTimeout;
    }

    /// @inheritdoc IPriceFeed
    function setStableMarketPriceFeed(
        IChainLinkAggregator _stableMarketPriceFeed,
        uint32 _stableMarketPriceFeedHeartBeatDuration
    ) external override onlyGov {
        (stableMarketPriceFeed, stableMarketPriceFeedHeartBeatDuration) = (
            _stableMarketPriceFeed,
            _stableMarketPriceFeedHeartBeatDuration
        );
    }

    /// @inheritdoc IPriceFeed
    function latestPrice(IMarketDescriptor market) external view override returns (PricePack memory) {
        return latestPrices0[market];
    }

    /// @inheritdoc IPriceFeed
    function marketConfig(IMarketDescriptor market) external view override returns (MarketConfig memory) {
        return marketConfigs0[market];
    }

    /// @inheritdoc IPriceFeed
    function slot() external view override returns (Slot memory) {
        return slot0;
    }

    function _calculateNewPriceDataItem(
        IMarketDescriptor _market,
        uint160 _priceX96,
        uint160 _refPriceX96,
        uint64 _maxCumulativeDeltaDiffs
    ) private view returns (PriceDataItem memory item, bool reachMaxDeltaDiff) {
        item = priceDataItems[_market];
        uint32 currentRound = uint32(block.timestamp / slot0.cumulativeRoundDuration);
        if (currentRound != item.prevRound || item.prevRefPriceX96 == 0 || item.prevPriceX96 == 0) {
            item.cumulativePriceDelta = 0;
            item.cumulativeRefPriceDelta = 0;
            item.prevRefPriceX96 = _refPriceX96;
            item.prevPriceX96 = _priceX96;
            item.prevRound = currentRound;
            return (item, false);
        }
        uint256 cumulativeRefPriceDelta = _calculateDiffBasisPoints(_refPriceX96, item.prevRefPriceX96);
        uint256 cumulativePriceDelta = _calculateDiffBasisPoints(_priceX96, item.prevPriceX96);

        item.cumulativeRefPriceDelta = (item.cumulativeRefPriceDelta + cumulativeRefPriceDelta).toUint64();
        item.cumulativePriceDelta = (item.cumulativePriceDelta + cumulativePriceDelta).toUint64();
        unchecked {
            if (
                item.cumulativePriceDelta > item.cumulativeRefPriceDelta &&
                item.cumulativePriceDelta - item.cumulativeRefPriceDelta > _maxCumulativeDeltaDiffs
            ) reachMaxDeltaDiff = true;

            item.prevRefPriceX96 = _refPriceX96;
            item.prevPriceX96 = _priceX96;
            item.prevRound = currentRound;
            return (item, reachMaxDeltaDiff);
        }
    }

    function _getReferencePriceX96(
        IChainLinkAggregator _aggregator,
        uint32 _refHeartbeatDuration,
        uint256 _stableMarketPrice,
        uint8 _stableMarketPriceDecimals
    ) private view returns (uint160 _latestRefPriceX96, uint160 _minRefPriceX96, uint160 _maxRefPriceX96) {
        (uint80 roundID, int256 refUSDPrice, , uint256 timestamp, ) = _aggregator.latestRoundData();
        if (refUSDPrice <= 0) revert InvalidReferencePrice(refUSDPrice);
        if (_refHeartbeatDuration != 0 && block.timestamp - timestamp > _refHeartbeatDuration)
            revert ReferencePriceTimeout(block.timestamp - timestamp);
        uint256 priceDecimalsMagnification = 10 ** uint256(_stableMarketPriceDecimals);
        uint256 refPrice = Math.mulDiv(uint256(refUSDPrice), priceDecimalsMagnification, _stableMarketPrice);
        uint256 magnification = 10 ** uint256(_aggregator.decimals());
        _latestRefPriceX96 = _toPriceX96(refPrice, magnification);
        if (slot0.refPriceExtraSample == 0) return (_latestRefPriceX96, _latestRefPriceX96, _latestRefPriceX96);

        (int256 minRefUSDPrice, int256 maxRefUSDPrice) = (refUSDPrice, refUSDPrice);
        for (uint256 i = 1; i <= slot0.refPriceExtraSample; ++i) {
            (, int256 price, , , ) = _aggregator.getRoundData(uint80(roundID - i));
            if (price > maxRefUSDPrice) maxRefUSDPrice = price;

            if (price < minRefUSDPrice) minRefUSDPrice = price;
        }
        if (minRefUSDPrice <= 0) revert InvalidReferencePrice(minRefUSDPrice);

        uint256 minRefPrice = Math.mulDiv(uint256(minRefUSDPrice), priceDecimalsMagnification, _stableMarketPrice);
        uint256 maxRefPrice = Math.mulDiv(uint256(maxRefUSDPrice), priceDecimalsMagnification, _stableMarketPrice);
        _minRefPriceX96 = _toPriceX96(minRefPrice, magnification);
        _maxRefPriceX96 = _toPriceX96(maxRefPrice, magnification);
    }

    function _toPriceX96(uint256 _price, uint256 _magnification) private pure returns (uint160) {
        // prettier-ignore
        unchecked { _price = Math.mulDiv(_price, Constants.Q96, uint256(10) ** MARKET_DECIMALS); }
        _price = uint256(10) ** USD_DECIMALS >= _magnification
            ? _price * (uint256(10) ** USD_DECIMALS / _magnification)
            : _price / (_magnification / uint256(10) ** USD_DECIMALS);
        return _price.toUint160();
    }

    function _setMarketLastUpdated(PricePack storage _latestPrice, uint64 _timestamp) private returns (bool) {
        // Execution delay may cause the update time to be out of order.
        if (block.timestamp == _latestPrice.updateBlockTimestamp || _timestamp <= _latestPrice.updateTimestamp)
            return false;

        uint32 _updateTxTimeout = slot0.updateTxTimeout;
        // timeout and revert
        if (_timestamp <= block.timestamp - _updateTxTimeout || _timestamp >= block.timestamp + _updateTxTimeout)
            revert InvalidUpdateTimestamp(_timestamp);

        _latestPrice.updateTimestamp = _timestamp;
        _latestPrice.updateBlockTimestamp = block.timestamp.toUint64();
        return true;
    }

    function _reviseMinAndMaxPriceX96(
        uint160 _priceX96,
        uint160 _minRefPriceX96,
        uint160 _maxRefPriceX96,
        bool _reachMaxDeltaDiff
    ) private view returns (uint160 minPriceX96, uint160 maxPriceX96) {
        uint256 diffBasisPointsMin = _calculateDiffBasisPoints(_priceX96, _minRefPriceX96);
        if ((diffBasisPointsMin > slot0.maxDeviationRatio || _reachMaxDeltaDiff) && _minRefPriceX96 < _priceX96)
            minPriceX96 = _minRefPriceX96;
        else minPriceX96 = _priceX96;

        uint256 diffBasisPointsMax = _calculateDiffBasisPoints(_priceX96, _maxRefPriceX96);
        if ((diffBasisPointsMax > slot0.maxDeviationRatio || _reachMaxDeltaDiff) && _maxRefPriceX96 > _priceX96)
            maxPriceX96 = _maxRefPriceX96;
        else maxPriceX96 = _priceX96;
    }

    function _calculateDiffBasisPoints(uint160 _priceX96, uint160 _basisPriceX96) private pure returns (uint256) {
        unchecked {
            uint160 deltaX96 = _priceX96 > _basisPriceX96 ? _priceX96 - _basisPriceX96 : _basisPriceX96 - _priceX96;
            return (uint256(deltaX96) * DELTA_PRECISION) / _basisPriceX96;
        }
    }

    function _checkSequencerUp() private view {
        if (address(sequencerUptimeFeed) == address(0)) return;
        (, int256 answer, uint256 startedAt, , ) = sequencerUptimeFeed.latestRoundData();

        // Answer == 0: Sequencer is up
        // Answer == 1: Sequencer is down
        if (answer != 0) revert SequencerDown();

        // Make sure the grace period has passed after the sequencer is back up.
        if (block.timestamp - startedAt <= GRACE_PERIOD_TIME) revert GracePeriodNotOver(startedAt);
    }

    function _getStableMarketPrice() private view returns (uint256, uint8) {
        IChainLinkAggregator priceFeed = stableMarketPriceFeed;
        uint32 heartbeatDuration = stableMarketPriceFeedHeartBeatDuration;

        (, int256 stableMarketPrice, , uint256 timestamp, ) = priceFeed.latestRoundData();
        if (heartbeatDuration != 0 && block.timestamp - timestamp > heartbeatDuration)
            revert StableMarketPriceTimeout(block.timestamp - timestamp);

        if (stableMarketPrice <= 0) revert InvalidStableMarketPrice(stableMarketPrice);
        return (uint256(stableMarketPrice), priceFeed.decimals());
    }
}
