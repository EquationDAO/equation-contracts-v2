// SPDX-License-Identifier: BUSL-1.1
pragma solidity =0.8.23;

import "./interfaces/IMarketManager.sol";

/// @notice The contract is used for assigning market indexes.
/// Using an index instead of an address can effectively reduce the gas cost of the transaction.
contract MarketIndexer {
    /// @notice The address of the market manager
    IMarketManager public immutable marketManager;
    /// @notice The current index of the market assigned
    uint24 public marketIndex;
    /// @notice Mapping of markets to their indexes
    mapping(IMarketDescriptor market => uint24 index) public marketIndexes;
    /// @notice Mapping of indexes to their markets
    mapping(uint24 index => IMarketDescriptor market) public indexMarkets;

    /// @notice Emitted when a index is assigned to a market
    /// @param market The address of the market
    /// @param index The index assigned to the market
    event MarketIndexAssigned(IMarketDescriptor indexed market, uint24 indexed index);

    /// @notice Error thrown when the market index is already assigned
    error MarketIndexAlreadyAssigned(IMarketDescriptor market);
    /// @notice Error thrown when the market is invalid
    error InvalidMarket(IMarketDescriptor market);

    /// @notice Construct the market indexer contract
    constructor(IMarketManager _marketManager) {
        marketManager = _marketManager;
    }

    /// @notice Assign a market index to a market
    function assignMarketIndex(IMarketDescriptor _market) external returns (uint24 index) {
        if (marketIndexes[_market] != 0) revert MarketIndexAlreadyAssigned(_market);
        if (!marketManager.isEnabledMarket(_market)) revert InvalidMarket(_market);

        index = ++marketIndex;
        marketIndexes[_market] = index;
        indexMarkets[index] = _market;

        emit MarketIndexAssigned(_market, index);
    }
}
