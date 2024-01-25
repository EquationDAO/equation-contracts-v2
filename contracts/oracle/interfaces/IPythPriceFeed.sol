// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import "../../core/interfaces/IMarketDescriptor.sol";
import "./IChainLinkAggregator.sol";

interface IPythPriceFeed {
    struct Slot {
        // Maximum deviation ratio between price and ChainLink price.
        uint32 maxDeviationRatio;
        // The timeout for price update transactions.
        uint32 validTimePeriod;
    }

    struct PricePack {
        /// @notice The timestamp when updater uploads the price
        uint64 updateTimestamp;
        /// @notice Calculated maximum price, as a Q64.96
        uint160 maxPriceX96;
        /// @notice Calculated minimum price, as a Q64.96
        uint160 minPriceX96;
        /// @notice The block timestamp when price is committed
        uint64 updateBlockTimestamp;
    }

    struct MarketPrice {
        IMarketDescriptor market;
        uint160 priceX96;
    }

    /// @notice Emitted when market price updated
    /// @param market Market address
    /// @param priceX96 The price passed in by updater, as a Q64.96
    /// @param maxPriceX96 Calculated maximum price, as a Q64.96
    /// @param minPriceX96 Calculated minimum price, as a Q64.96
    event PriceUpdated(IMarketDescriptor indexed market, uint160 priceX96, uint160 minPriceX96, uint160 maxPriceX96);

    /// @notice Emitted when `maxDeviationRatio` changed
    /// @param newMaxDeviationRatio new `maxDeviationRatio` value
    event MaxDeviationRatioChanged(uint32 newMaxDeviationRatio);

    /// @notice stale price, may because of transaction execution too late or breakdown price feed
    /// @param timestamp stale price timestamp
    /// @param blockTimestamp block timestamp
    error StalePriceTimestamp(uint256 timestamp, uint256 blockTimestamp);

    /// @notice Invalid market price
    /// @param marketPrice market price
    error InvalidMarketPrice(int256 marketPrice);

    /// @notice Reference price feed not set
    error ReferencePriceFeedNotSet();

    /// @notice Price not be initialized
    error NotInitialized();

    /// @notice Update prices
    /// @dev Updater calls this method to update prices for multiple markets. The contract calculation requires
    /// higher precision prices, so the passed-in prices need to be adjusted.
    ///
    /// ## Example
    ///
    /// The price of ETH is $2000, and ETH has 18 decimals, so the price of one unit of ETH is $`2000 / (10 ^ 18)`.
    ///
    /// The price of USD is $1, and USD has 6 decimals, so the price of one unit of USD is $`1 / (10 ^ 6)`.
    ///
    /// Then the price of ETH/USD pair is 2000 / (10 ^ 18) * (10 ^ 6)
    ///
    /// Finally convert the price to Q64.96, ETH/USD priceX96 = 2000 / (10 ^ 18) * (10 ^ 6) * (2 ^ 96)
    /// @param marketPrices Array of market addresses and prices to update for
    /// @param timestamp The timestamp of price update
    function setPriceX96s(MarketPrice[] calldata marketPrices, uint64 timestamp) external;

    /// @notice Get the pyth asset id of stable market
    /// @return id The id of stable market asset
    function stableMarketAssetId() external view returns (bytes32 id);

    /// @notice The 0th storage slot in the price feed stores many values, which helps reduce gas
    /// costs when interacting with the price feed.
    function slot() external view returns (Slot memory);

    /// @notice `ReferencePriceFeedNotSet` will be ignored when `ignoreReferencePriceFeedError` is true
    function ignoreReferencePriceFeedError() external view returns (bool);

    /// @notice Get latest price data for corresponding market.
    /// @param market The market address to query the price data
    /// @return packedData The packed price data
    function latestPrice(IMarketDescriptor market) external view returns (PricePack memory packedData);

    /// @notice Get minimum market price
    /// @param market The market address to query the price
    /// @return priceX96 Minimum market price
    function getMinPriceX96(IMarketDescriptor market) external view returns (uint160 priceX96);

    /// @notice Get maximum market price
    /// @param market The market address to query the price
    /// @return priceX96 Maximum market price
    function getMaxPriceX96(IMarketDescriptor market) external view returns (uint160 priceX96);

    /// @notice Set updater status active or not
    /// @param account Updater address
    /// @param active Status of updater permission to set
    function setUpdater(address account, bool active) external;

    /// @notice Check if is updater
    /// @param account The address to query the status
    /// @return active Status of updater
    function isUpdater(address account) external returns (bool active);

    /// @notice Set pyth asset id for corresponding market.
    /// @param market The market address to set
    /// @param assetId pyth asset id
    function setPythAssetId(IMarketDescriptor market, bytes32 assetId) external;

    /// @notice Set maximum deviation ratio between price and pyth price.
    /// If exceeded, the updated price will refer to pyth price.
    /// @param maxDeviationRatio Maximum deviation ratio
    function setMaxDeviationRatio(uint32 maxDeviationRatio) external;

    /// @notice Set the period (in seconds) that a price feed is considered valid since its publish time
    /// @param validTimePeriod The period (in seconds) that a price feed is considered valid since its publish time
    function setValidTimePeriod(uint32 validTimePeriod) external;

    /// @notice Some market prices are too low, it is necessary to enlarge the price for better display. Set the
    /// magnification for the corresponding market
    /// @param market The market address to set
    /// @param magnification Positive number of magnification.
    function setReferencePriceAdjustmentMagnification(IMarketDescriptor market, uint160 magnification) external;
}
