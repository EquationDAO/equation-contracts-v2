// SPDX-License-Identifier: BUSL-1.1
pragma solidity =0.8.23;

import "./interfaces/IMarketDescriptor.sol";

/// @title Market Descriptor
/// @notice This contract is used to describe a market
contract MarketDescriptor is IMarketDescriptor {
    /// @inheritdoc IMarketDescriptor
    string public override symbol;

    function initialize(string memory _symbol) external {
        if (bytes(symbol).length != 0) revert SymbolAlreadyInitialized();

        symbol = _symbol;
    }

    /// @inheritdoc IMarketDescriptor
    function name() external view override returns (string memory) {
        return string.concat("Equation Market V2 - ", symbol);
    }

    /// @inheritdoc IMarketDescriptor
    function decimals() external pure override returns (uint8) {
        return 18;
    }
}
