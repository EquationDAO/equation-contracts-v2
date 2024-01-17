// SPDX-License-Identifier: BUSL-1.1
pragma solidity =0.8.23;

import "../types/PackedValue.sol";
import "../governance/Governable.sol";
import "../libraries/TickMath.sol";
import {IPythAdaptor} from "./interfaces/IPythAdaptor.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";

contract PythAdaptor is IPythAdaptor, Governable {
    using SafeCast for int256;

    // whitelist mapping of price updater
    mapping(address => bool) private updaters;

    mapping(bytes32 => CompressedPrice) private priceData;
    /// @notice
    bytes32[] private existPriceDataAssets;
    /// @notice The minimum publish time of every asset from the latest round of price feed
    uint256 private minPublishTime;

    /// @notice Mapping of indexes to their assets
    mapping(uint256 index => bytes32 asset) private indexAssets;
    /// @notice Mapping of assets to their indexes
    mapping(bytes32 asset => uint256 index) public assetsIndexes;
    /// @notice The current index of the asset assigned
    uint256 public assetIndex;

    // @notice each price and each publish time diff will occupy 24 bits. price asset index will occupy 16 bits.
    // uint256 will be able to contain 4 (4 * (24 + 24 + 16) = 256 bits) entries
    uint8 public constant MAX_PRICE_PER_WORD = 4;

    modifier onlyUpdater() {
        if (!updaters[msg.sender]) revert Forbidden();
        _;
    }

    /// @inheritdoc IPythAdaptor
    function updatePriceFeeds(
        PackedValue[] calldata _prices,
        uint256 _minPublishTime,
        bytes32 _encodedVaas
    ) external onlyUpdater {
        uint256 packedValueLen = _prices.length;
        uint256 maxAssetsIndex = assetIndex;
        for (uint256 i; i < packedValueLen; ++i) {
            PackedValue price = _prices[i];
            for (uint8 j; j < MAX_PRICE_PER_WORD; ++j) {
                uint16 assetIdIndex = price.unpackUint16(j * 64);
                if (assetIndex == 0) break;
                int24 priceTick = int24(price.unpackUint24(j * 64 + 16));
                uint24 pricePublishTimeDiff = price.unpackUint24(j * 64 + 40);
                if (assetIdIndex > maxAssetsIndex) revert InvalidAssetIndex(assetIdIndex);
                bytes32 assetId = indexAssets[assetIdIndex];
                priceData[assetId] = CompressedPrice({
                    tick: priceTick,
                    publishTimeDiff: pricePublishTimeDiff,
                    set: true
                });
                existPriceDataAssets.push(assetId);
            }
        }

        minPublishTime = _minPublishTime;

        emit LogVaas(_encodedVaas);
    }

    /// @inheritdoc IPythAdaptor
    function clearPrices() public onlyUpdater {
        uint256 dataLength = existPriceDataAssets.length;
        for (uint256 i; i < dataLength; ++i) {
            delete priceData[existPriceDataAssets[i]];
            delete existPriceDataAssets[i];
        }
        minPublishTime = 0;
    }

    /// @inheritdoc IPythAdaptor
    function getPriceUnsafe(bytes32 _id) external view returns (PythStructsPrice memory price) {
        CompressedPrice memory compressedPrice = priceData[_id];
        if (!compressedPrice.set) revert PriceDataNotExist(_id);
        price.publishTime = minPublishTime + compressedPrice.publishTimeDiff;
        price.expo = -8;
        uint160 sqrtPriceX96 = TickMath.getSqrtRatioAtTick(compressedPrice.tick);
        uint256 spotPrice = (uint256(sqrtPriceX96) * (uint256(sqrtPriceX96)) * (1e8)) >> (96 * 2);
        price.price = int256(spotPrice).toInt64();
        price.conf = 0;
        return price;
    }

    /// @inheritdoc IPythAdaptor
    function setUpdater(address _account, bool _active) external onlyGov {
        updaters[_account] = _active;
    }

    /// @inheritdoc IPythAdaptor
    function isUpdater(address _account) external view returns (bool active) {
        return updaters[_account];
    }

    /// @inheritdoc IPythAdaptor
    function assignAssetsIndexes(bytes32[] calldata _assets) external onlyGov {
        for (uint256 i; i < _assets.length; ++i) {
            bytes32 asset = _assets[i];
            if (assetsIndexes[asset] != 0) revert AssetIndexAlreadyAssigned(asset);

            uint256 index = ++assetIndex;
            assetsIndexes[asset] = index;
            indexAssets[index] = asset;
            emit AssetIndexAssigned(asset, index);
        }
    }
}
