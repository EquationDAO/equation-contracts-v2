// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "../libraries/MarketUtil.sol";

contract MarketUtilHarness {
    using MarketUtil for IMarketManager.State;
    IMarketManager.State public state;
    IConfigurable.MarketPriceConfig public priceConfig;

    function globalLiquidationFund() external view returns (IMarketManager.GlobalLiquidationFund memory) {
        return state.globalLiquidationFund;
    }

    function liquidationFundPositions(address _account) external view returns (uint256) {
        return state.liquidationFundPositions[_account];
    }

    function setLiquidationFund(int256 _value) external {
        state.globalLiquidationFund.liquidationFund = _value;
    }

    function globalLiquidityPosition() external view returns (IMarketManager.GlobalLiquidityPosition memory) {
        return state.globalLiquidityPosition;
    }

    function setGlobalLiquidityPosition(IMarketManager.GlobalLiquidityPosition calldata _value) external {
        state.globalLiquidityPosition = _value;
    }

    function setPriceState(IMarketManager.PriceState calldata _value) external {
        state.priceState = _value;
    }

    function priceState() external view returns (IMarketManager.PriceState memory) {
        return state.priceState;
    }

    function increaseLiquidationFundPosition(
        IMarketDescriptor _market,
        address _account,
        uint128 _liquidityDelta
    ) external {
        state.increaseLiquidationFundPosition(_market, _account, _liquidityDelta);
    }

    function decreaseLiquidationFundPosition(
        IMarketDescriptor _market,
        address _account,
        uint128 _liquidityDelta,
        address _receiver
    ) external {
        state.decreaseLiquidationFundPosition(_market, _account, _liquidityDelta, _receiver);
    }

    function govUseLiquidationFund(IMarketDescriptor _market, uint128 _liquidityDelta, address _receiver) external {
        state.govUseLiquidationFund(_market, _liquidityDelta, _receiver);
    }

    function initializePreviousSPPrice(IMarketDescriptor _market, uint160 _indexPriceX96) external {
        MarketUtil.initializePreviousSPPrice(state.globalLiquidityPosition, _market, _indexPriceX96);
    }

    function chooseIndexPriceX96(
        IPriceFeed _priceFeed,
        IMarketDescriptor _market,
        Side _side
    ) external view returns (uint160) {
        return MarketUtil.chooseIndexPriceX96(_priceFeed, _market, _side);
    }

    function chooseDecreaseIndexPriceX96(
        IPriceFeed _priceFeed,
        IMarketDescriptor _market,
        Side _side
    ) external view returns (uint160) {
        return MarketUtil.chooseDecreaseIndexPriceX96(_priceFeed, _market, _side);
    }

    function settleLiquidityUnrealizedPnL(IPriceFeed _priceFeed, IMarketDescriptor _market) external {
        state.settleLiquidityUnrealizedPnL(_priceFeed, _market);
    }

    function changePriceVertices(
        IConfigurable.MarketPriceConfig calldata _cfg,
        IMarketDescriptor _market,
        uint160 _indexPriceX96
    ) external {
        priceConfig = _cfg;
        state.changePriceVertices(priceConfig, _market, _indexPriceX96);
    }
}
