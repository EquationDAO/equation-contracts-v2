// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "../oracle/interfaces/IPythAdaptor.sol";

contract PythAdaptorHelper {
    IPythAdaptor adaptor;

    uint256 public affectedAssetIdLength;

    constructor(IPythAdaptor _adaptor) {
        adaptor = _adaptor;
    }

    function updatePriceFeeds(PackedValue[] calldata _prices, uint256 _minPublishTime, bytes32 _encodedVaas) external {
        bytes32[] memory assetIds = adaptor.updatePriceFeeds(_prices, _minPublishTime, _encodedVaas);
        adaptor.clearPrices(assetIds);
        affectedAssetIdLength = assetIds.length;
    }
}
