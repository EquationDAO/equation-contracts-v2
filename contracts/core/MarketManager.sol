// SPDX-License-Identifier: BUSL-1.1
pragma solidity =0.8.23;

import "../plugins/Router.sol";
import "./MarketManagerStates.sol";
import "../libraries/PositionUtil.sol";

contract MarketManager is MarketManagerStates {
    using SafeCast for *;
    using SafeERC20 for IERC20;
    using MarketUtil for State;
    using PositionUtil for State;
    using FundingRateUtil for State;
    using LiquidityPositionUtil for State;

    Router public immutable router;
    IFeeDistributor public immutable feeDistributor;
    IEFC public immutable EFC;

    constructor(IERC20 _usd, Router _router, IFeeDistributor _feeDistributor, IEFC _EFC) Configurable(_usd) {
        (router, feeDistributor, EFC) = (_router, _feeDistributor, _EFC);
    }

    /// @inheritdoc IMarketLiquidityPosition
    function increaseLiquidityPosition(
        IMarketDescriptor _market,
        address _account,
        uint128 _marginDelta,
        uint128 _liquidityDelta
    ) external override nonReentrantForMarket(_market) returns (uint128 marginAfter) {
        _onlyRouter();

        State storage state = marketStates[_market];
        IConfigurable.MarketConfig storage marketCfg = marketConfigs[_market];
        state.sampleAndAdjustFundingRate(marketCfg.baseConfig, priceFeed, _market);

        if (_marginDelta > 0) _validateTransferInAndUpdateBalance(state, _marginDelta);

        marginAfter = state.increaseLiquidityPosition(
            marketCfg,
            LiquidityPositionUtil.IncreaseLiquidityPositionParameter({
                market: _market,
                account: _account,
                marginDelta: _marginDelta,
                liquidityDelta: _liquidityDelta,
                priceFeed: priceFeed
            })
        );

        if (_liquidityDelta > 0) {
            state.changePriceVertices(marketCfg.priceConfig, _market, priceFeed.getMaxPriceX96(_market));
            state.changeMaxSize(marketConfigs[_market].baseConfig, _market, priceFeed.getMaxPriceX96(_market));
        }
    }

    /// @inheritdoc IMarketLiquidityPosition
    function decreaseLiquidityPosition(
        IMarketDescriptor _market,
        address _account,
        uint128 _marginDelta,
        uint128 _liquidityDelta,
        address _receiver
    ) external override nonReentrantForMarket(_market) returns (uint128 marginAfter) {
        _onlyRouter();

        State storage state = marketStates[_market];
        IConfigurable.MarketConfig storage marketCfg = marketConfigs[_market];
        state.sampleAndAdjustFundingRate(marketCfg.baseConfig, priceFeed, _market);

        (marginAfter, _marginDelta) = state.decreaseLiquidityPosition(
            marketCfg,
            LiquidityPositionUtil.DecreaseLiquidityPositionParameter({
                market: _market,
                account: _account,
                marginDelta: _marginDelta,
                liquidityDelta: _liquidityDelta,
                priceFeed: priceFeed,
                receiver: _receiver
            })
        );

        if (_marginDelta > 0) _transferOutAndUpdateBalance(state, _receiver, _marginDelta);

        if (_liquidityDelta > 0) {
            state.changePriceVertices(marketCfg.priceConfig, _market, priceFeed.getMaxPriceX96(_market));
            state.changeMaxSize(marketConfigs[_market].baseConfig, _market, priceFeed.getMaxPriceX96(_market));
        }
    }

    /// @inheritdoc IMarketLiquidityPosition
    function liquidateLiquidityPosition(
        IMarketDescriptor _market,
        address _account,
        address _feeReceiver
    ) external override nonReentrantForMarket(_market) {
        _onlyRouter();

        State storage state = marketStates[_market];
        IConfigurable.MarketConfig storage marketCfg = marketConfigs[_market];
        state.sampleAndAdjustFundingRate(marketCfg.baseConfig, priceFeed, _market);

        uint64 liquidateExecutionFee = state.liquidateLiquidityPosition(
            marketCfg,
            LiquidityPositionUtil.LiquidateLiquidityPositionParameter({
                market: _market,
                account: _account,
                priceFeed: priceFeed,
                feeReceiver: _feeReceiver
            })
        );

        _transferOutAndUpdateBalance(state, _feeReceiver, liquidateExecutionFee);

        state.changePriceVertices(marketCfg.priceConfig, _market, priceFeed.getMaxPriceX96(_market));
        state.changeMaxSize(marketConfigs[_market].baseConfig, _market, priceFeed.getMaxPriceX96(_market));
    }

    /// @inheritdoc IMarketManager
    function govUseLiquidationFund(
        IMarketDescriptor _market,
        address _receiver,
        uint128 _liquidationFundDelta
    ) external override nonReentrantForMarket(_market) {
        _onlyGov();

        State storage state = marketStates[_market];
        state.govUseLiquidationFund(_market, _liquidationFundDelta, _receiver);

        _transferOutAndUpdateBalance(state, _receiver, _liquidationFundDelta);
    }

    /// @inheritdoc IMarketManager
    function increaseLiquidationFundPosition(
        IMarketDescriptor _market,
        address _account,
        uint128 _liquidityDelta
    ) external override nonReentrantForMarket(_market) {
        _onlyRouter();

        State storage state = marketStates[_market];
        _validateTransferInAndUpdateBalance(state, _liquidityDelta);

        state.increaseLiquidationFundPosition(_market, _account, _liquidityDelta);
    }

    /// @inheritdoc IMarketManager
    function decreaseLiquidationFundPosition(
        IMarketDescriptor _market,
        address _account,
        uint128 _liquidityDelta,
        address _receiver
    ) external override nonReentrantForMarket(_market) {
        _onlyRouter();

        State storage state = marketStates[_market];
        state.decreaseLiquidationFundPosition(_market, _account, _liquidityDelta, _receiver);

        _transferOutAndUpdateBalance(state, _receiver, _liquidityDelta);
    }

    /// @inheritdoc IMarketPosition
    function increasePosition(
        IMarketDescriptor _market,
        address _account,
        Side _side,
        uint128 _marginDelta,
        uint128 _sizeDelta
    ) external override nonReentrantForMarket(_market) returns (uint160 tradePriceX96) {
        _onlyRouter();

        State storage state = marketStates[_market];
        IConfigurable.MarketConfig storage marketCfg = marketConfigs[_market];
        state.sampleAndAdjustFundingRate(marketCfg.baseConfig, priceFeed, _market);

        if (_marginDelta > 0) _validateTransferInAndUpdateBalance(state, _marginDelta);

        return
            state.increasePosition(
                marketCfg,
                PositionUtil.IncreasePositionParameter({
                    market: _market,
                    account: _account,
                    side: _side,
                    marginDelta: _marginDelta,
                    sizeDelta: _sizeDelta,
                    EFC: EFC,
                    priceFeed: priceFeed
                })
            );
    }

    /// @inheritdoc IMarketPosition
    function decreasePosition(
        IMarketDescriptor _market,
        address _account,
        Side _side,
        uint128 _marginDelta,
        uint128 _sizeDelta,
        address _receiver
    ) external override nonReentrantForMarket(_market) returns (uint160 tradePriceX96) {
        _onlyRouter();

        State storage state = marketStates[_market];
        IConfigurable.MarketConfig storage marketCfg = marketConfigs[_market];
        state.sampleAndAdjustFundingRate(marketCfg.baseConfig, priceFeed, _market);

        (tradePriceX96, _marginDelta) = state.decreasePosition(
            marketCfg,
            PositionUtil.DecreasePositionParameter({
                market: _market,
                account: _account,
                side: _side,
                marginDelta: _marginDelta,
                sizeDelta: _sizeDelta,
                EFC: EFC,
                priceFeed: priceFeed,
                receiver: _receiver
            })
        );
        if (_marginDelta > 0) _transferOutAndUpdateBalance(state, _receiver, _marginDelta);
    }

    /// @inheritdoc IMarketPosition
    function liquidatePosition(
        IMarketDescriptor _market,
        address _account,
        Side _side,
        address _feeReceiver
    ) external override nonReentrantForMarket(_market) {
        _onlyRouter();

        State storage state = marketStates[_market];
        IConfigurable.MarketConfig storage marketCfg = marketConfigs[_market];
        state.sampleAndAdjustFundingRate(marketCfg.baseConfig, priceFeed, _market);

        state.liquidatePosition(
            marketCfg,
            PositionUtil.LiquidatePositionParameter({
                market: _market,
                account: _account,
                side: _side,
                EFC: EFC,
                priceFeed: priceFeed,
                feeReceiver: _feeReceiver
            })
        );

        // transfer liquidation fee directly to fee receiver
        _transferOutAndUpdateBalance(state, _feeReceiver, marketCfg.baseConfig.liquidationExecutionFee);
    }

    /// @inheritdoc IMarketManager
    function sampleAndAdjustFundingRate(IMarketDescriptor _market) external override nonReentrantForMarket(_market) {
        _onlyRouter();

        marketStates[_market].sampleAndAdjustFundingRate(marketConfigs[_market].baseConfig, priceFeed, _market);
    }

    /// @inheritdoc IMarketManager
    function setPriceFeed(IPriceFeed _priceFeed) external override nonReentrant {
        _onlyGov();
        IPriceFeed priceFeedBefore = priceFeed;
        priceFeed = _priceFeed;
        emit PriceFeedChanged(priceFeedBefore, _priceFeed);
    }

    /// @inheritdoc IMarketManager
    /// @dev This function does not include the nonReentrantForMarket modifier because it is intended
    /// to be called internally by the contract itself.
    function changePriceVertex(
        IMarketDescriptor _market,
        uint8 _startExclusive,
        uint8 _endInclusive
    ) external override {
        if (msg.sender != address(this)) revert InvalidCaller(address(this));

        State storage state = marketStates[_market];
        unchecked {
            // If the vertex represented by end is the same as the vertex represented by end + 1,
            // then the vertices in the range (start, LATEST_VERTEX] need to be updated
            PriceState storage priceState = state.priceState;
            if (_endInclusive < Constants.LATEST_VERTEX) {
                PriceVertex memory previous = priceState.priceVertices[_endInclusive];
                PriceVertex memory next = priceState.priceVertices[_endInclusive + 1];
                if (previous.size >= next.size || previous.premiumRateX96 >= next.premiumRateX96)
                    _endInclusive = Constants.LATEST_VERTEX;
            }
        }
        state.changePriceVertex(
            marketConfigs[_market].priceConfig,
            _market,
            priceFeed.getMaxPriceX96(_market),
            _startExclusive,
            _endInclusive
        );
    }

    /// @inheritdoc IMarketManager
    function collectProtocolFee(IMarketDescriptor _market) external override nonReentrantForMarket(_market) {
        State storage state = marketStates[_market];
        uint128 protocolFeeCopy = state.protocolFee;
        delete state.protocolFee;

        _transferOutAndUpdateBalance(state, address(feeDistributor), protocolFeeCopy);
        feeDistributor.depositFee(protocolFeeCopy);
        emit ProtocolFeeCollected(_market, protocolFeeCopy);
    }

    /// @inheritdoc IMarketManager
    function collectReferralFee(
        IMarketDescriptor _market,
        uint256 _referralToken,
        address _receiver
    ) external override nonReentrantForMarket(_market) returns (uint256 amount) {
        _onlyRouter();

        State storage state = marketStates[_market];
        amount = state.referralFees[_referralToken];
        delete state.referralFees[_referralToken];

        _transferOutAndUpdateBalance(state, _receiver, amount.toUint128());
        emit ReferralFeeCollected(_market, _referralToken, _receiver, amount);
    }

    /// @inheritdoc Configurable
    function afterMarketEnabled(IMarketDescriptor _market) internal override {
        assert(reentrancyStatus[_market] == 0);
        reentrancyStatus[_market] = NOT_ENTERED;
        uint64 lastAdjustFundingRateTime = _calculateFundingRateTime(block.timestamp.toUint64());
        marketStates[_market].globalFundingRateSample.lastAdjustFundingRateTime = lastAdjustFundingRateTime;
    }

    /// @inheritdoc Configurable
    function afterMarketBaseConfigChanged(IMarketDescriptor _market) internal override {
        State storage state = marketStates[_market];
        state.changeMaxSize(marketConfigs[_market].baseConfig, _market, priceFeed.getMaxPriceX96(_market));
    }

    /// @inheritdoc Configurable
    function afterMarketPriceConfigChanged(IMarketDescriptor _market) internal override {
        State storage state = marketStates[_market];
        state.changePriceVertices(marketConfigs[_market].priceConfig, _market, priceFeed.getMaxPriceX96(_market));
    }

    function _onlyRouter() private view {
        if (msg.sender != address(router)) revert InvalidCaller(address(router));
    }

    function _validateTransferInAndUpdateBalance(State storage _state, uint128 _amount) private {
        uint256 balanceAfter = usd.balanceOf(address(this));
        if (balanceAfter - usdBalance < _amount) revert InsufficientBalance(usdBalance, _amount);
        usdBalance += _amount;
        _state.usdBalance += _amount;
    }

    function _transferOutAndUpdateBalance(State storage _state, address _to, uint128 _amount) private {
        usdBalance -= _amount;
        _state.usdBalance -= _amount;
        usd.safeTransfer(_to, _amount);
    }

    function _calculateFundingRateTime(uint64 _timestamp) private pure returns (uint64) {
        // prettier-ignore
        unchecked { return _timestamp - (_timestamp % Constants.ADJUST_FUNDING_RATE_INTERVAL); }
    }
}
