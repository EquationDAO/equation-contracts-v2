// SPDX-License-Identifier: BUSL-1.1
pragma solidity =0.8.23;

import "../libraries/Constants.sol";
import {M as Math} from "../libraries/Math.sol";
import "./interfaces/IPriceFeed.sol";
import "../governance/Governable.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "./interfaces/IPythAdaptor.sol";
import {IPythPriceFeed} from "./interfaces/IPythPriceFeed.sol";

contract PythPriceFeed is IPythPriceFeed, Governable {
    using SafeCast for *;

    /// @dev value difference precision
    uint256 public constant DELTA_PRECISION = 1e6;

    uint8 public constant USD_DECIMALS = 6;
    uint8 public constant MARKET_DECIMALS = 18;

    bytes32 public immutable override stableMarketAssetId;

    uint32 public immutable override stableMarketValidTimePeriod;

    IPythAdaptor private immutable pyth;

    bool public immutable ignoreReferencePriceFeedError;

    mapping(address => bool) private updaters;

    mapping(IMarketDescriptor market => MarketConfig) private marketConfigs0;

    /// @dev latest price
    mapping(IMarketDescriptor market => PricePack) private latestPrices0;

    modifier onlyUpdater() {
        if (!updaters[msg.sender]) revert Forbidden();
        _;
    }

    constructor(
        IPythAdaptor _pyth,
        bytes32 _stableMarketAssetId,
        uint32 _stableMarketValidTimePeriod,
        bool _ignoreReferencePriceFeedError
    ) {
        pyth = _pyth;
        stableMarketAssetId = _stableMarketAssetId;
        stableMarketValidTimePeriod = _stableMarketValidTimePeriod;
        ignoreReferencePriceFeedError = _ignoreReferencePriceFeedError;
    }

    /// @inheritdoc IPythPriceFeed
    function setPriceX96s(MarketPrice[] calldata _marketPrices, uint64 _timestamp) external override onlyUpdater {
        uint256 marketPricesLength = _marketPrices.length;
        (int64 stableMarketPrice, int32 stableMarketExpo) = _getStableMarketPrice();
        for (uint256 i; i < marketPricesLength; ++i) {
            uint160 priceX96 = _marketPrices[i].priceX96;
            IMarketDescriptor market = _marketPrices[i].market;
            MarketConfig memory _marketConfig = marketConfigs0[market];
            PricePack storage pack = latestPrices0[market];
            if (!_setMarketLastUpdated(pack, _timestamp, _marketConfig.validTimePeriod)) continue;

            if (_marketConfig.pythAssetId == bytes32(0)) {
                if (!ignoreReferencePriceFeedError) revert ReferencePriceFeedNotSet();
                (pack.minPriceX96, pack.maxPriceX96) = (priceX96, priceX96);
                emit PriceUpdated(market, priceX96, priceX96, priceX96);
                continue;
            }
            IPythAdaptor.PythStructsPrice memory refUsdPrice = pyth.getPriceUnsafe(_marketConfig.pythAssetId);
            if (refUsdPrice.price <= 0) revert InvalidMarketPrice(refUsdPrice.price);
            _checkUpdateTime(refUsdPrice.publishTime, block.timestamp, _marketConfig.validTimePeriod);

            uint256 refPrice;
            if (stableMarketExpo > 0) {
                refPrice =
                    uint64(refUsdPrice.price) /
                    uint64(stableMarketPrice) /
                    uint256(10) ** uint32(stableMarketExpo);
            } else {
                refPrice = Math.mulDiv(
                    uint64(refUsdPrice.price),
                    uint256(10) ** uint32(-stableMarketExpo),
                    uint64(stableMarketPrice)
                );
            }
            uint160 refPriceX96 = _toPriceX96(refPrice, refUsdPrice.expo);
            uint160 adjustmentMagnification = _marketConfig.referencePriceAdjustmentMagnification;
            if (adjustmentMagnification != 0) refPriceX96 = refPriceX96 * adjustmentMagnification;

            uint160 minPriceX96;
            uint160 maxPriceX96;
            if (_calculateDiffBasisPoints(refPriceX96, priceX96) > _marketConfig.maxDeviationRatio) {
                (minPriceX96, maxPriceX96) = refPriceX96 < priceX96 ? (refPriceX96, priceX96) : (priceX96, refPriceX96);
            } else {
                (minPriceX96, maxPriceX96) = (priceX96, priceX96);
            }
            (pack.minPriceX96, pack.maxPriceX96) = (minPriceX96, maxPriceX96);
            emit PriceUpdated(market, priceX96, minPriceX96, maxPriceX96);
        }
    }

    /// @inheritdoc IPythPriceFeed
    function getMinPriceX96(IMarketDescriptor _market) external view override returns (uint160 priceX96) {
        priceX96 = latestPrices0[_market].minPriceX96;
        if (priceX96 == 0) revert NotInitialized();
    }

    /// @inheritdoc IPythPriceFeed
    function getMaxPriceX96(IMarketDescriptor _market) external view override returns (uint160 priceX96) {
        priceX96 = latestPrices0[_market].maxPriceX96;
        if (priceX96 == 0) revert NotInitialized();
    }

    /// @inheritdoc IPythPriceFeed
    function setUpdater(address _account, bool _active) external override onlyGov {
        updaters[_account] = _active;
    }

    /// @inheritdoc IPythPriceFeed
    function isUpdater(address _account) external view override returns (bool active) {
        return updaters[_account];
    }

    /// @inheritdoc IPythPriceFeed
    function setMarketConfig(IMarketDescriptor _market, MarketConfig calldata _marketConfig) external override onlyGov {
        marketConfigs0[_market] = _marketConfig;
        emit MarketConfigChanged(_market, _marketConfig);
    }

    /// @inheritdoc IPythPriceFeed
    function marketConfigs(IMarketDescriptor _market) external view override returns (MarketConfig memory) {
        return marketConfigs0[_market];
    }

    /// @inheritdoc IPythPriceFeed
    function latestPrices(IMarketDescriptor _market) external view override returns (PricePack memory) {
        return latestPrices0[_market];
    }

    function _toPriceX96(uint256 _price, int32 _expo) private pure returns (uint160) {
        // prettier-ignore
        unchecked { _price = Math.mulDiv(_price, Constants.Q96, uint256(10) ** MARKET_DECIMALS); }
        int32 finalExpo = _expo + int8(USD_DECIMALS);
        if (finalExpo > 0) {
            _price = _price * uint256(10) ** uint32(finalExpo);
        } else {
            _price = _price / uint256(10) ** uint32(-finalExpo);
        }
        return _price.toUint160();
    }

    function _setMarketLastUpdated(
        PricePack storage _latestPrice,
        uint64 _timestamp,
        uint256 _validTimePeriod
    ) private returns (bool) {
        // Execution delay may cause the update time to be out of order.
        if (block.timestamp == _latestPrice.updateBlockTimestamp || _timestamp <= _latestPrice.updateTimestamp)
            return false;

        _checkUpdateTime(_timestamp, block.timestamp, _validTimePeriod);

        _latestPrice.updateTimestamp = _timestamp;
        _latestPrice.updateBlockTimestamp = block.timestamp.toUint64();
        return true;
    }

    function _calculateDiffBasisPoints(uint160 _priceX96, uint160 _basisPriceX96) private pure returns (uint256) {
        // prettier-ignore
        unchecked { return (_absSub(_priceX96, _basisPriceX96) * DELTA_PRECISION) / _basisPriceX96; }
    }

    function _getStableMarketPrice() private view returns (int64, int32) {
        IPythAdaptor.PythStructsPrice memory usdPrice = pyth.getPriceUnsafe(stableMarketAssetId);
        _checkUpdateTime(usdPrice.publishTime, block.timestamp, stableMarketValidTimePeriod);

        if (usdPrice.price <= 0) revert InvalidMarketPrice(usdPrice.price);
        return (usdPrice.price, usdPrice.expo);
    }

    function _checkUpdateTime(
        uint256 _priceTimestamp,
        uint256 _blockTimestamp,
        uint256 _validTimePeriod
    ) internal pure {
        if (_absSub(_priceTimestamp, _blockTimestamp) > _validTimePeriod)
            revert StalePriceTimestamp(_priceTimestamp, _blockTimestamp);
    }

    function _absSub(uint256 _x, uint256 _y) internal pure returns (uint256) {
        if (_x > _y) {
            return _x - _y;
        } else {
            return _y - _x;
        }
    }
}
