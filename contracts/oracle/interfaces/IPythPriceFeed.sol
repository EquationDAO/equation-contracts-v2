// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import "../../core/interfaces/IMarketDescriptor.sol";
import "./IChainLinkAggregator.sol";

interface IPythPriceFeed {
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

    struct MarketConfig {
        /// @notice The pyth price feed id of which to fetch the price and confidence interval.
        bytes32 pythAssetId;
        /// @notice Maximum deviation ratio between price and pyth price.
        uint32 maxDeviationRatio;
        /// @notice The timeout for price update transactions.the period (in seconds) that a price feed is considered
        /// valid since its publish time
        uint32 validTimePeriod;
        /// @notice There are some markets like 1000BONK/USDT in the equation protocol, and its price is 1000 times
        /// of BONK/USDT. The prices provided by Pyth are the original prices of the trading pairs, so it needs to be
        /// magnified accordingly when updating the price.
        uint32 referencePriceAdjustmentMagnification;
    }

    /// @notice Emitted when market price updated
    /// @param market Market address
    /// @param priceX96 The price passed in by updater, as a Q64.96
    /// @param maxPriceX96 Calculated maximum price, as a Q64.96
    /// @param minPriceX96 Calculated minimum price, as a Q64.96
    event PriceUpdated(IMarketDescriptor indexed market, uint160 priceX96, uint160 minPriceX96, uint160 maxPriceX96);

    /// @notice Emitted when `maxDeviationRatio` changed
    /// @param market Market address
    /// @param newConfig New market config value
    event MarketConfigChanged(IMarketDescriptor indexed market, MarketConfig newConfig);

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

    /// @notice Get the pyth asset id of the stable market
    /// @return id The id of stable market asset
    function stableMarketAssetId() external view returns (bytes32 id);

    /// @notice Get valid time period of the stable market
    /// @return period The period (in seconds) that a price feed is considered valid since its publish time
    function stableMarketValidTimePeriod() external view returns (uint32 period);

    /// @notice `ReferencePriceFeedNotSet` will be ignored when `ignoreReferencePriceFeedError` is true
    function ignoreReferencePriceFeedError() external view returns (bool);

    /// @notice Get latest price data for corresponding market.
    /// @param market The market address to query the price data
    /// @return packedData The packed price data
    function latestPrices(IMarketDescriptor market) external view returns (PricePack memory packedData);

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

    /// @notice Set market config for corresponding market.
    /// @param market The market address to set
    /// @param marketConfig The packed market config data
    function setMarketConfig(IMarketDescriptor market, MarketConfig calldata marketConfig) external;

    /// @notice Get market configuration for updating price
    /// @param market The market address to query the configuration
    /// @return marketConfig The packed market config data
    function marketConfigs(IMarketDescriptor market) external view returns (MarketConfig memory marketConfig);
}
