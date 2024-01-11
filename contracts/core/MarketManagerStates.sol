// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.0;

import "./Configurable.sol";
import "./interfaces/IMarketManager.sol";
import "../libraries/LiquidityPositionUtil.sol";

abstract contract MarketManagerStates is IMarketManager, Configurable {
    uint256 internal constant NOT_ENTERED = 1;
    uint256 internal constant ENTERED = 2;

    uint256 public usdBalance;
    IPriceFeed public priceFeed;
    mapping(IMarketDescriptor market => uint256 status) internal reentrancyStatus;
    mapping(IMarketDescriptor market => State) internal marketStates;

    modifier nonReentrantForMarket(IMarketDescriptor _market) {
        if (!_isEnabledMarket(_market)) revert IConfigurable.MarketNotEnabled(_market);

        if (reentrancyStatus[_market] == ENTERED) revert ReentrancyGuard.ReentrancyGuardReentrantCall();

        reentrancyStatus[_market] = ENTERED;
        _;
        reentrancyStatus[_market] = NOT_ENTERED;
    }

    /// @inheritdoc IMarketManager
    function priceStates(IMarketDescriptor _market) external view override returns (PriceState memory) {
        return marketStates[_market].priceState;
    }

    /// @inheritdoc IMarketManager
    function usdBalances(IMarketDescriptor _market) external view override returns (uint256) {
        return marketStates[_market].usdBalance;
    }

    /// @inheritdoc IMarketManager
    function protocolFees(IMarketDescriptor _market) external view override returns (uint128) {
        return marketStates[_market].protocolFee;
    }

    /// @inheritdoc IMarketManager
    function referralFees(IMarketDescriptor _market, uint256 _referralToken) external view override returns (uint256) {
        return marketStates[_market].referralFees[_referralToken];
    }

    /// @inheritdoc IMarketLiquidityPosition
    function globalLiquidityPositions(
        IMarketDescriptor _market
    ) external view override returns (GlobalLiquidityPosition memory) {
        return marketStates[_market].globalLiquidityPosition;
    }

    /// @inheritdoc IMarketLiquidityPosition
    function liquidityPositions(
        IMarketDescriptor _market,
        address _account
    ) external view override returns (LiquidityPosition memory) {
        return marketStates[_market].liquidityPositions[_account];
    }

    /// @inheritdoc IMarketPosition
    function globalPositions(
        IMarketDescriptor _market
    ) external view override returns (IMarketManager.GlobalPosition memory) {
        return marketStates[_market].globalPosition;
    }

    /// @inheritdoc IMarketPosition
    function previousGlobalFundingRates(
        IMarketDescriptor _market
    ) external view override returns (IMarketManager.PreviousGlobalFundingRate memory) {
        return marketStates[_market].previousGlobalFundingRate;
    }

    /// @inheritdoc IMarketPosition
    function globalFundingRateSamples(
        IMarketDescriptor _market
    ) external view override returns (IMarketManager.GlobalFundingRateSample memory) {
        return marketStates[_market].globalFundingRateSample;
    }

    /// @inheritdoc IMarketPosition
    function positions(
        IMarketDescriptor _market,
        address _account,
        Side _side
    ) external view override returns (IMarketManager.Position memory) {
        return marketStates[_market].positions[_account][_side];
    }

    /// @inheritdoc IMarketManager
    function globalLiquidationFunds(
        IMarketDescriptor _market
    ) external view override returns (IMarketManager.GlobalLiquidationFund memory) {
        return marketStates[_market].globalLiquidationFund;
    }

    /// @inheritdoc IMarketManager
    function liquidationFundPositions(
        IMarketDescriptor _market,
        address _account
    ) external view override returns (uint256) {
        return marketStates[_market].liquidationFundPositions[_account];
    }

    /// @inheritdoc IMarketManager
    function marketPriceX96s(
        IMarketDescriptor _market,
        Side _side
    ) external view override returns (uint160 marketPriceX96) {
        State storage state = marketStates[_market];
        marketPriceX96 = PriceUtil.calculateMarketPriceX96(
            state.globalLiquidityPosition.side,
            _side,
            MarketUtil.chooseIndexPriceX96(priceFeed, _market, _side),
            state.priceState.basisIndexPriceX96,
            state.priceState.premiumRateX96
        );
    }
}
