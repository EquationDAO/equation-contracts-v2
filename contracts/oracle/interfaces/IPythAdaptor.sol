// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import "../../types/PackedValue.sol";

interface IPythAdaptor {
    // copy from @pythnetwork/pyth-sdk-solidity/PythStructs.sol:Price
    // A price with a degree of uncertainty, represented as a price +- a confidence interval.
    //
    // The confidence interval roughly corresponds to the standard error of a normal distribution.
    // Both the price and confidence are stored in a fixed-point numeric representation,
    // `x * (10^expo)`, where `expo` is the exponent.
    //
    // Please refer to the documentation at https://docs.pyth.network/documentation/pythnet-price-feeds/best-practices
    // for how to how this price safely.
    struct PythStructsPrice {
        // Price
        int64 price;
        // Confidence interval around the price
        uint64 conf;
        // Price exponent
        int32 expo;
        // Unix timestamp describing when the price was published
        uint publishTime;
    }

    struct CompressedPrice {
        /// @notice price tick, refer: https://docs.uniswap.org/contracts/v3/reference/core/libraries/TickMath
        int24 tick;
        /// @notice The differences value from the `minPublishTime` for each asset
        uint24 publishTimeDiff;
        /// @notice Indicate if price data is exist or not
        bool set;
    }

    /// @notice Emitted when a index is assigned to a asset
    /// @param asset The address of the asset
    /// @param index The index assigned to the asset
    event AssetIndexAssigned(bytes32 indexed asset, uint256 indexed index);

    /// @notice Emitted when price data extracted in Vaas is committed
    /// @param encodedVaas The hash of vaas
    event LogVaas(bytes32 encodedVaas);

    /// @notice Error thrown when the asset index is already assigned
    error AssetIndexAlreadyAssigned(bytes32 asset);

    /// @notice Error thrown when the asset index is not exist
    error InvalidAssetIndex(uint256 index);

    /// @notice Error thrown when the asset price data not found
    error PriceDataNotExist(bytes32 asset);

    /// @notice Update price feeds with given update messages.
    /// @param prices Array of price update data. A price data is split into 4 slots. Slot is consisted of asset index,
    /// price tick and price publish time difference.
    ///                                 slot-3             slot-2           slot-1             slot-0
    /// The example packed value:   0x000003001da30004 | 0x00000200b2ad0003 | 0x00000101a0ad0002 | 0x0000000132240001
    ///                              /       \      \
    ///       publishTimeDiff=0x000003 tick=0x001da3 assetIdIndex=0x0004
    /// @param minPublishTime The minimum publish time of the prices
    /// @param encodedVaas Encoded Vaas data
    /// @return affectedAssetIds List of affected asset ids.
    function updatePriceFeeds(
        PackedValue[] calldata prices,
        uint256 minPublishTime,
        bytes32 encodedVaas
    ) external returns (bytes32[] memory affectedAssetIds);

    /// @notice Clear price data for gas optimization
    /// @param toClear List of asset ids to clear
    function clearPrices(bytes32[] memory toClear) external;

    /// @notice Set updater status active or not
    /// @param account Updater address
    /// @param active Status of updater permission to set
    function setUpdater(address account, bool active) external;

    /// @notice Check if is updater
    /// @param account The address to query the status
    /// @return active Status of updater
    function isUpdater(address account) external returns (bool active);

    /// @notice Returns the price of a price feed without any sanity checks.
    /// @dev This function returns the most recent price update in this contract without any recency checks.
    /// This function is unsafe as the returned price update may be arbitrarily far in the past.
    ///
    /// Users of this function should check the `publishTime` in the price to ensure that the returned price is
    /// sufficiently recent for their application. If you are considering using this function, it may be
    /// safer / easier to use either `getPrice` or `getPriceNoOlderThan`.
    /// @return price - please read the documentation of PythStructs.Price to understand how to use this safely.
    function getPriceUnsafe(bytes32 id) external view returns (PythStructsPrice memory price);

    /// @notice Assign indexes to assets
    /// @param assets Array of asset ids
    function assignAssetsIndexes(bytes32[] calldata assets) external;
}
