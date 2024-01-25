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

    uint32 private constant DEFAULT_MAX_DEVIATION_RATIO = 1e5;

    uint32 private constant DEFAULT_VALID_TIME_PERIOD = 1 minutes;

    uint8 public constant USD_DECIMALS = 6;
    uint8 public constant MARKET_DECIMALS = 18;

    Slot private slot0;

    bytes32 public immutable override stableMarketAssetId;

    IPythAdaptor private immutable pyth;

    bool public immutable ignoreReferencePriceFeedError;

    mapping(address => bool) private updaters;

    mapping(IMarketDescriptor market => bytes32) public pythAssetIds;

    /// @dev latest price
    mapping(IMarketDescriptor market => PricePack) private latestPrices0;

    mapping(IMarketDescriptor market => uint160) public referencePriceAdjustmentMagnifications;

    modifier onlyUpdater() {
        if (!updaters[msg.sender]) revert Forbidden();
        _;
    }

    constructor(IPythAdaptor _pyth, bytes32 _stableMarketAssetId, bool _ignoreReferencePriceFeedError) {
        pyth = _pyth;
        stableMarketAssetId = _stableMarketAssetId;
        ignoreReferencePriceFeedError = _ignoreReferencePriceFeedError;
        (slot0.maxDeviationRatio, slot0.validTimePeriod) = (DEFAULT_MAX_DEVIATION_RATIO, DEFAULT_VALID_TIME_PERIOD);
        emit MaxDeviationRatioChanged(DEFAULT_MAX_DEVIATION_RATIO);
    }

    /// @inheritdoc IPythPriceFeed
    function setPriceX96s(MarketPrice[] calldata _marketPrices, uint64 _timestamp) external override onlyUpdater {
        uint256 marketPricesLength = _marketPrices.length;
        (int64 stableMarketPrice, int32 stableMarketExpo) = _getStableMarketPrice();
        for (uint256 i; i < marketPricesLength; ++i) {
            uint160 priceX96 = _marketPrices[i].priceX96;
            IMarketDescriptor market = _marketPrices[i].market;
            PricePack storage pack = latestPrices0[market];
            if (!_setMarketLastUpdated(pack, _timestamp)) continue;

            bytes32 assetId = pythAssetIds[market];
            if (assetId == bytes32(0)) {
                if (!ignoreReferencePriceFeedError) revert ReferencePriceFeedNotSet();
                (pack.minPriceX96, pack.maxPriceX96) = (priceX96, priceX96);
                emit PriceUpdated(market, priceX96, priceX96, priceX96);
                continue;
            }
            IPythAdaptor.PythStructsPrice memory refUsdPrice = pyth.getPriceUnsafe(assetId);
            if (refUsdPrice.price <= 0) revert InvalidMarketPrice(refUsdPrice.price);
            _checkUpdateTime(refUsdPrice.publishTime, block.timestamp);

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
            uint160 adjustmentMagnification = referencePriceAdjustmentMagnifications[market];
            if (adjustmentMagnification != 0) {
                refPriceX96 = refPriceX96 * adjustmentMagnification;
            }

            uint160 minPriceX96;
            uint160 maxPriceX96;
            if (_calculateDiffBasisPoints(refPriceX96, priceX96) > slot0.maxDeviationRatio) {
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
    function setPythAssetId(IMarketDescriptor _market, bytes32 assetId) external override onlyGov {
        pythAssetIds[_market] = assetId;
    }

    /// @inheritdoc IPythPriceFeed
    function setReferencePriceAdjustmentMagnification(
        IMarketDescriptor _market,
        uint160 _magnification
    ) external override onlyGov {
        referencePriceAdjustmentMagnifications[_market] = _magnification;
    }

    /// @inheritdoc IPythPriceFeed
    function setMaxDeviationRatio(uint32 _maxDeviationRatio) external override onlyGov {
        slot0.maxDeviationRatio = _maxDeviationRatio;
        emit MaxDeviationRatioChanged(_maxDeviationRatio);
    }

    /// @inheritdoc IPythPriceFeed
    function setValidTimePeriod(uint32 _validTimePeriod) external override onlyGov {
        slot0.validTimePeriod = _validTimePeriod;
    }

    /// @inheritdoc IPythPriceFeed
    function latestPrice(IMarketDescriptor _market) external view override returns (PricePack memory) {
        return latestPrices0[_market];
    }

    /// @inheritdoc IPythPriceFeed
    function slot() external view override returns (Slot memory) {
        return slot0;
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

    function _setMarketLastUpdated(PricePack storage _latestPrice, uint64 _timestamp) private returns (bool) {
        // Execution delay may cause the update time to be out of order.
        if (block.timestamp == _latestPrice.updateBlockTimestamp || _timestamp <= _latestPrice.updateTimestamp)
            return false;

        _checkUpdateTime(_timestamp, block.timestamp);

        _latestPrice.updateTimestamp = _timestamp;
        _latestPrice.updateBlockTimestamp = block.timestamp.toUint64();
        return true;
    }

    function _calculateDiffBasisPoints(uint160 _priceX96, uint160 _basisPriceX96) private pure returns (uint256) {
        unchecked {
            return (_diff(_priceX96, _basisPriceX96) * DELTA_PRECISION) / _basisPriceX96;
        }
    }

    function _getStableMarketPrice() private view returns (int64, int32) {
        IPythAdaptor.PythStructsPrice memory usdPrice = pyth.getPriceUnsafe(stableMarketAssetId);
        _checkUpdateTime(usdPrice.publishTime, block.timestamp);

        if (usdPrice.price <= 0) revert InvalidMarketPrice(usdPrice.price);
        return (usdPrice.price, usdPrice.expo);
    }

    function _checkUpdateTime(uint256 _priceTimestamp, uint256 _blockTimestamp) internal view {
        if (_diff(_priceTimestamp, _blockTimestamp) > slot0.validTimePeriod) {
            revert StalePriceTimestamp(_priceTimestamp, _blockTimestamp);
        }
    }

    function _diff(uint256 _x, uint256 _y) internal pure returns (uint256) {
        if (_x > _y) {
            return _x - _y;
        } else {
            return _y - _x;
        }
    }
}
