// SPDX-License-Identifier: BUSL-1.1
pragma solidity =0.8.23;

import "../core/Configurable.sol";

contract MockConfigurable is Configurable {
    bool public afterMarketEnabledCalled;
    bool public afterMarketBaseConfigChangedCalled;
    bool public afterMarketPriceConfigChangedCalled;

    constructor(IERC20 _usd) Configurable(_usd) {}

    function afterMarketEnabled(IMarketDescriptor /* _market */) internal override {
        afterMarketEnabledCalled = true;
    }

    function afterMarketBaseConfigChanged(IMarketDescriptor /* _market */) internal override {
        afterMarketBaseConfigChangedCalled = true;
    }

    function afterMarketPriceConfigChanged(IMarketDescriptor /* _market */) internal override {
        afterMarketPriceConfigChangedCalled = true;
    }
}
