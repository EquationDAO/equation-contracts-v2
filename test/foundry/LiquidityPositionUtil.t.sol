// SPDX-License-Identifier: UNLICENSED
pragma solidity =0.8.23;

import "forge-std/Test.sol";
import "../../contracts/types/Side.sol";
import "../../contracts/test/MockPriceFeed.sol";
import "../../contracts/libraries/LiquidityPositionUtil.sol";

contract LiquidityPositionUtilTest is Test {
    using LiquidityPositionUtil for IMarketManager.State;

    IMarketDescriptor private constant MARKET = IMarketDescriptor(address(0x101));
    address private constant ACCOUNT = address(0x102);
    address private constant RECEIVER = address(0x103);
    IPriceFeed private priceFeed;

    IMarketManager.State private state;
    IConfigurable.MarketConfig private marketConfig;

    function setUp() public {
        priceFeed = IPriceFeed(address(new MockPriceFeed()));
        state.globalLiquidityPosition = IMarketLiquidityPosition.GlobalLiquidityPosition({
            netSize: 100e18,
            liquidationBufferNetSize: 200e18,
            previousSPPriceX96: _toPriceX96(2000),
            side: LONG,
            liquidity: 1_000_000e6,
            unrealizedPnLGrowthX64: 10 << 64
        });

        marketConfig.baseConfig.minMarginPerLiquidityPosition = 10e6;
        marketConfig.baseConfig.maxLeveragePerLiquidityPosition = 100;
        marketConfig.baseConfig.liquidationFeeRatePerLiquidityPosition = 0.2e6; // 0.2%
        marketConfig.baseConfig.liquidationExecutionFee = 0.5e6;
        _mockMinPrice(1000);
    }

    function test_increaseLiquidityPosition_RevertIf_OpenLiquidityPositionWithLiquidityDeltaZero() public {
        LiquidityPositionUtil.IncreaseLiquidityPositionParameter memory params = LiquidityPositionUtil
            .IncreaseLiquidityPositionParameter(MARKET, ACCOUNT, 100e6, 0, priceFeed);
        _expectSettleLiquidityUnrealizedPnLCalled();
        vm.expectRevert(abi.encodeWithSelector(IMarketErrors.LiquidityPositionNotFound.selector, ACCOUNT));
        state.increaseLiquidityPosition(marketConfig, params);
    }

    function test_increaseLiquidityPosition_RevertIf_OpenLiquidityPositionWithLessMarginDelta() public {
        LiquidityPositionUtil.IncreaseLiquidityPositionParameter memory params = LiquidityPositionUtil
            .IncreaseLiquidityPositionParameter(MARKET, ACCOUNT, 5e6, 50e6, priceFeed);
        _expectSettleLiquidityUnrealizedPnLCalled();
        vm.expectRevert(IMarketErrors.InsufficientMargin.selector);
        state.increaseLiquidityPosition(marketConfig, params);
    }

    function test_increaseLiquidityPosition_RevertIf_MarginAfterLeZeroAfterIncreasingLiquidityPosition() public {
        LiquidityPositionUtil.IncreaseLiquidityPositionParameter memory params = LiquidityPositionUtil
            .IncreaseLiquidityPositionParameter(MARKET, ACCOUNT, 10e6, 50e6, priceFeed);
        state.liquidityPositions[ACCOUNT] = IMarketLiquidityPosition.LiquidityPosition({
            margin: 10e6,
            liquidity: 1e6,
            entryUnrealizedPnLGrowthX64: 100 << 64
        });
        _expectSettleLiquidityUnrealizedPnLCalled();
        vm.expectRevert(IMarketErrors.InsufficientMargin.selector);
        state.increaseLiquidityPosition(marketConfig, params);
    }

    function test_increaseLiquidityPosition_RevertIf_LeverageTooHighAfterOpenningLiquidityPosition() public {
        LiquidityPositionUtil.IncreaseLiquidityPositionParameter memory params = LiquidityPositionUtil
            .IncreaseLiquidityPositionParameter(MARKET, ACCOUNT, 20e6, 5000e6, priceFeed);
        _expectSettleLiquidityUnrealizedPnLCalled();
        vm.expectRevert(abi.encodeWithSelector(IMarketErrors.LeverageTooHigh.selector, 20e6, 5000e6, 100));
        state.increaseLiquidityPosition(marketConfig, params);
    }

    function test_increaseLiquidityPosition_RevertIf_LeverageTooHighAfterIncreasingLiquidityPosition() public {
        LiquidityPositionUtil.IncreaseLiquidityPositionParameter memory params = LiquidityPositionUtil
            .IncreaseLiquidityPositionParameter(MARKET, ACCOUNT, 10e6, 4990e6, priceFeed);
        state.liquidityPositions[ACCOUNT] = IMarketLiquidityPosition.LiquidityPosition({
            margin: 10e6,
            liquidity: 10e6,
            entryUnrealizedPnLGrowthX64: 10 << 64
        });
        _expectSettleLiquidityUnrealizedPnLCalled();
        vm.expectRevert(abi.encodeWithSelector(IMarketErrors.LeverageTooHigh.selector, 16999999, 5000e6, 100)); // 20e6-3000001
        state.increaseLiquidityPosition(marketConfig, params);
    }

    function test_increaseLiquidityPosition_RevertIf_RiskRateTooHighAfterOpenLiquidityPosition() public {
        LiquidityPositionUtil.IncreaseLiquidityPositionParameter memory params = LiquidityPositionUtil
            .IncreaseLiquidityPositionParameter(MARKET, ACCOUNT, 10e6, 50e6, priceFeed);
        marketConfig.baseConfig.liquidationExecutionFee = 10e6;
        _expectSettleLiquidityUnrealizedPnLCalled();
        // realizedPnL: 0, margin: 10e6, maintenanceMargin: 10e6+50e6*0.2e6/1e8
        vm.expectRevert(abi.encodeWithSelector(IMarketErrors.RiskRateTooHigh.selector, 10e6, 10.1e6));
        state.increaseLiquidityPosition(marketConfig, params);
    }

    function test_increaseLiquidityPosition_RevertIf_RiskRateTooHighAfterIncreasingLiquidityPosition() public {
        LiquidityPositionUtil.IncreaseLiquidityPositionParameter memory params = LiquidityPositionUtil
            .IncreaseLiquidityPositionParameter(MARKET, ACCOUNT, 10e6, 50e6, priceFeed);
        state.liquidityPositions[ACCOUNT] = IMarketLiquidityPosition.LiquidityPosition({
            margin: 10e6,
            liquidity: 10e6,
            entryUnrealizedPnLGrowthX64: 10 << 64
        });
        marketConfig.baseConfig.liquidationExecutionFee = 20e6;
        _expectSettleLiquidityUnrealizedPnLCalled();
        // realizedPnL: -3000001, margin: 20e6-3000001, maintenanceMargin: 20e6+(50e6+10e6)*0.2e6/1e8
        vm.expectRevert(abi.encodeWithSelector(IMarketErrors.RiskRateTooHigh.selector, 16999999, 20.12e6));
        state.increaseLiquidityPosition(marketConfig, params);
    }

    function test_increaseLiquidityPosition_OpenLiquidityPositionWithTheRightState() public {
        LiquidityPositionUtil.IncreaseLiquidityPositionParameter memory params = LiquidityPositionUtil
            .IncreaseLiquidityPositionParameter(MARKET, ACCOUNT, 10e6, 50e6, priceFeed);
        uint128 globalLiquidity = state.globalLiquidityPosition.liquidity;
        _expectSettleLiquidityUnrealizedPnLCalled();
        vm.expectEmit(true, true, false, true);
        emit IMarketLiquidityPosition.LiquidityPositionIncreased(MARKET, ACCOUNT, 10e6, 10e6, 50e6, 0);
        uint128 marginAfter = state.increaseLiquidityPosition(marketConfig, params);
        assertEq(marginAfter, 10e6);
        IMarketManager.LiquidityPosition memory liquidityPosition = state.liquidityPositions[ACCOUNT];
        assertEq(liquidityPosition.margin, 10e6);
        assertEq(liquidityPosition.liquidity, 50e6);
        assertEq(liquidityPosition.entryUnrealizedPnLGrowthX64, state.globalLiquidityPosition.unrealizedPnLGrowthX64);
        assertEq(state.globalLiquidityPosition.liquidity, globalLiquidity + 50e6);
    }

    function test_increaseLiquidityPosition_IncreasingLiquidityPositionWithTheRightState() public {
        LiquidityPositionUtil.IncreaseLiquidityPositionParameter memory params = LiquidityPositionUtil
            .IncreaseLiquidityPositionParameter(MARKET, ACCOUNT, 10e6, 50e6, priceFeed);
        state.liquidityPositions[ACCOUNT] = IMarketLiquidityPosition.LiquidityPosition({
            margin: 10e6,
            liquidity: 10e6,
            entryUnrealizedPnLGrowthX64: 10 << 64
        });
        uint128 globalLiquidity = state.globalLiquidityPosition.liquidity;
        _expectSettleLiquidityUnrealizedPnLCalled();
        vm.expectEmit(true, true, false, true);
        // realizedPnL: -3000001, marginAfter: 20e6-3000001
        emit IMarketLiquidityPosition.LiquidityPositionIncreased(MARKET, ACCOUNT, 10e6, 16999999, 60e6, -3000001);
        uint128 marginAfter = state.increaseLiquidityPosition(marketConfig, params);
        assertEq(marginAfter, 16999999); // 20e6-3000001
        IMarketManager.LiquidityPosition memory liquidityPosition = state.liquidityPositions[ACCOUNT];
        assertEq(liquidityPosition.margin, 16999999);
        assertEq(liquidityPosition.liquidity, 60e6);
        assertEq(liquidityPosition.entryUnrealizedPnLGrowthX64, state.globalLiquidityPosition.unrealizedPnLGrowthX64);
        assertEq(state.globalLiquidityPosition.liquidity, globalLiquidity + 50e6);
    }

    function test_increaseLiquidityPosition_IncreasingLiquidityPositionWithTheRightStateWhenRealizedPnLGtZero() public {
        LiquidityPositionUtil.IncreaseLiquidityPositionParameter memory params = LiquidityPositionUtil
            .IncreaseLiquidityPositionParameter(MARKET, ACCOUNT, 10e6, 50e6, priceFeed);
        state.liquidityPositions[ACCOUNT] = IMarketLiquidityPosition.LiquidityPosition({
            margin: 10e6,
            liquidity: 10e6,
            entryUnrealizedPnLGrowthX64: 10 << 64
        });
        uint128 globalLiquidity = state.globalLiquidityPosition.liquidity;
        _mockMinPrice(3000); // ensure realizedPnL is positive
        _expectSettleLiquidityUnrealizedPnLCalled();
        vm.expectEmit(true, true, false, true);
        emit IMarketLiquidityPosition.LiquidityPositionIncreased(MARKET, ACCOUNT, 10e6, 22999999, 60e6, 2999999); // 20e6+2999999
        state.increaseLiquidityPosition(marketConfig, params);
        IMarketManager.LiquidityPosition memory liquidityPosition = state.liquidityPositions[ACCOUNT];
        assertEq(liquidityPosition.margin, 22999999);
        assertEq(liquidityPosition.liquidity, 60e6);
        assertEq(liquidityPosition.entryUnrealizedPnLGrowthX64, state.globalLiquidityPosition.unrealizedPnLGrowthX64);
        assertEq(state.globalLiquidityPosition.liquidity, globalLiquidity + 50e6);
    }

    function test_decreaseLiquidityPosition_RevertIf_LiquidityPositionNotFound() public {
        LiquidityPositionUtil.DecreaseLiquidityPositionParameter memory params = LiquidityPositionUtil
            .DecreaseLiquidityPositionParameter(MARKET, ACCOUNT, 10e6, 50e6, priceFeed, RECEIVER);
        _expectSettleLiquidityUnrealizedPnLCalled();
        vm.expectRevert(abi.encodeWithSelector(IMarketErrors.LiquidityPositionNotFound.selector, ACCOUNT));
        state.decreaseLiquidityPosition(marketConfig, params);
    }

    function test_decreaseLiquidityPosition_RevertIf_InsufficientLiquidityToDecrease() public {
        LiquidityPositionUtil.DecreaseLiquidityPositionParameter memory params = LiquidityPositionUtil
            .DecreaseLiquidityPositionParameter(MARKET, ACCOUNT, 10e6, 60e6, priceFeed, RECEIVER);
        state.liquidityPositions[ACCOUNT] = IMarketLiquidityPosition.LiquidityPosition({
            margin: 10e6,
            liquidity: 50e6,
            entryUnrealizedPnLGrowthX64: 10 << 64
        });
        _expectSettleLiquidityUnrealizedPnLCalled();
        vm.expectRevert(abi.encodeWithSelector(IMarketErrors.InsufficientLiquidityToDecrease.selector, 50e6, 60e6));
        state.decreaseLiquidityPosition(marketConfig, params);
    }

    function test_decreaseLiquidityPosition_RevertIf_MarginAfterLtZero() public {
        LiquidityPositionUtil.DecreaseLiquidityPositionParameter memory params = LiquidityPositionUtil
            .DecreaseLiquidityPositionParameter(MARKET, ACCOUNT, 10e6, 20e6, priceFeed, RECEIVER);
        state.liquidityPositions[ACCOUNT] = IMarketLiquidityPosition.LiquidityPosition({
            margin: 10e6,
            liquidity: 50e6,
            entryUnrealizedPnLGrowthX64: 10 << 64
        });
        _expectSettleLiquidityUnrealizedPnLCalled();
        vm.expectRevert(IMarketErrors.InsufficientMargin.selector);
        state.decreaseLiquidityPosition(marketConfig, params);
    }

    function test_decreaseLiquidityPosition_RevertIf_LastLiquidityPosition() public {
        LiquidityPositionUtil.DecreaseLiquidityPositionParameter memory params = LiquidityPositionUtil
            .DecreaseLiquidityPositionParameter(
                MARKET,
                ACCOUNT,
                0,
                state.globalLiquidityPosition.liquidity,
                priceFeed,
                RECEIVER
            );
        state.liquidityPositions[ACCOUNT] = IMarketLiquidityPosition.LiquidityPosition({
            margin: 10e6,
            liquidity: state.globalLiquidityPosition.liquidity,
            entryUnrealizedPnLGrowthX64: 10 << 64
        });
        state.globalPosition.longSize = 10e6;
        _mockMinPrice(3000); // ensure realizedPnL is positive, will not revert with InsufficientMargin
        _expectSettleLiquidityUnrealizedPnLCalled();
        vm.expectRevert(IMarketErrors.LastLiquidityPositionCannotBeClosed.selector);
        state.decreaseLiquidityPosition(marketConfig, params);
    }

    function test_decreaseLiquidityPosition_RevertIf_RiskRateTooHighAfterDecreasingLiquidityPosition() public {
        LiquidityPositionUtil.DecreaseLiquidityPositionParameter memory params = LiquidityPositionUtil
            .DecreaseLiquidityPositionParameter(MARKET, ACCOUNT, 0, 20e6, priceFeed, RECEIVER);
        state.liquidityPositions[ACCOUNT] = IMarketLiquidityPosition.LiquidityPosition({
            margin: 20e6,
            liquidity: 50e6,
            entryUnrealizedPnLGrowthX64: 10 << 64
        });
        marketConfig.baseConfig.liquidationExecutionFee = 20e6;
        _expectSettleLiquidityUnrealizedPnLCalled();
        // realizedPnL: -15000001, marginAfter: 20e6-15000001, maintenanceMargin: 20e6+(50e6-20e6)*0.2e6/1e8
        vm.expectRevert(abi.encodeWithSelector(IMarketErrors.RiskRateTooHigh.selector, 4999999, 20.06e6));
        state.decreaseLiquidityPosition(marketConfig, params);
    }

    function test_decreaseLiquidityPosition_RevertIf_LeverageTooHighAfterDecreasingLiquidityPosition() public {
        LiquidityPositionUtil.DecreaseLiquidityPositionParameter memory params = LiquidityPositionUtil
            .DecreaseLiquidityPositionParameter(MARKET, ACCOUNT, 20e6, 20e6, priceFeed, RECEIVER);
        state.liquidityPositions[ACCOUNT] = IMarketLiquidityPosition.LiquidityPosition({
            margin: 100e6,
            liquidity: 200e6,
            entryUnrealizedPnLGrowthX64: 10 << 64
        });
        marketConfig.baseConfig.maxLeveragePerLiquidityPosition = 5;
        _expectSettleLiquidityUnrealizedPnLCalled();
        vm.expectRevert(abi.encodeWithSelector(IMarketErrors.LeverageTooHigh.selector, 19999999, 180e6, 5));
        state.decreaseLiquidityPosition(marketConfig, params);
    }

    function test_decreaseLiquidityPosition_CloseLiquidityPositionWithTheRightState() public {
        LiquidityPositionUtil.DecreaseLiquidityPositionParameter memory params = LiquidityPositionUtil
            .DecreaseLiquidityPositionParameter(MARKET, ACCOUNT, 0, 50e6, priceFeed, RECEIVER);
        state.liquidityPositions[ACCOUNT] = IMarketLiquidityPosition.LiquidityPosition({
            margin: 20e6,
            liquidity: 50e6,
            entryUnrealizedPnLGrowthX64: 10 << 64
        });
        uint128 globalLiquidity = state.globalLiquidityPosition.liquidity;
        _expectSettleLiquidityUnrealizedPnLCalled();
        vm.expectEmit(true, true, false, true);
        // realizedPnL: -15000001, marginDelta: 20e6-15000001
        emit IMarketLiquidityPosition.LiquidityPositionDecreased(MARKET, ACCOUNT, 4999999, 0, 0, -15000001, RECEIVER);
        (uint128 marginAfter, uint128 adjustedMarginDelta) = state.decreaseLiquidityPosition(marketConfig, params);
        assertEq(marginAfter, 0);
        assertEq(adjustedMarginDelta, 4999999); // 20e6-15000001
        assertEq(state.liquidityPositions[ACCOUNT].liquidity, 0);
        assertEq(state.globalLiquidityPosition.liquidity, globalLiquidity - 50e6);
    }

    function test_decreaseLiquidityPosition_DecreasingLiquidityPositionWithTheRightState() public {
        LiquidityPositionUtil.DecreaseLiquidityPositionParameter memory params = LiquidityPositionUtil
            .DecreaseLiquidityPositionParameter(MARKET, ACCOUNT, 2e6, 20e6, priceFeed, RECEIVER);
        state.liquidityPositions[ACCOUNT] = IMarketLiquidityPosition.LiquidityPosition({
            margin: 20e6,
            liquidity: 50e6,
            entryUnrealizedPnLGrowthX64: 10 << 64
        });
        uint128 globalLiquidity = state.globalLiquidityPosition.liquidity;
        _expectSettleLiquidityUnrealizedPnLCalled();
        vm.expectEmit(true, true, false, true);
        // realizedPnL: -15000001, marginDelta: 2e6, marginAfter: 20e6-2e6-15000001
        emit IMarketLiquidityPosition.LiquidityPositionDecreased(
            MARKET,
            ACCOUNT,
            2e6,
            2999999, // 20e6-2e6-15000001
            30e6,
            -15000001,
            RECEIVER
        );
        (uint128 marginAfter, uint128 adjustedMarginDelta) = state.decreaseLiquidityPosition(marketConfig, params);
        assertEq(marginAfter, 2999999); // 20e6-2e6-15000001
        assertEq(adjustedMarginDelta, 2e6);
        assertEq(state.liquidityPositions[ACCOUNT].liquidity, 30e6);
        assertEq(state.globalLiquidityPosition.liquidity, globalLiquidity - 20e6);
    }

    function test_decreaseLiquidityPosition_DecreasingLiquidityPositionWithTheRightStateWhenGlobalLiquidityPositionSideIsShort()
        public
    {
        LiquidityPositionUtil.DecreaseLiquidityPositionParameter memory params = LiquidityPositionUtil
            .DecreaseLiquidityPositionParameter(MARKET, ACCOUNT, 2e6, 20e6, priceFeed, RECEIVER);
        state.liquidityPositions[ACCOUNT] = IMarketLiquidityPosition.LiquidityPosition({
            margin: 20e6,
            liquidity: 50e6,
            entryUnrealizedPnLGrowthX64: 10 << 64
        });
        state.globalLiquidityPosition.side = SHORT;
        uint128 globalLiquidity = state.globalLiquidityPosition.liquidity;
        _mockMaxPrice(3000); // ensure realizedPnL is negative
        _expectSettleLiquidityUnrealizedPnLCalled();
        vm.expectEmit(true, true, false, true);
        // realizedPnL: -15000001, marginDelta: 2e6, marginAfter: 20e6-2e6-15000001
        emit IMarketLiquidityPosition.LiquidityPositionDecreased(
            MARKET,
            ACCOUNT,
            2e6,
            2999999, // 20e6-2e6-15000001
            30e6,
            -15000001,
            RECEIVER
        );
        (uint128 marginAfter, uint128 adjustedMarginDelta) = state.decreaseLiquidityPosition(marketConfig, params);
        assertEq(marginAfter, 2999999); // 20e6-2e6-15000001
        assertEq(adjustedMarginDelta, 2e6);
        assertEq(state.liquidityPositions[ACCOUNT].liquidity, 30e6);
        assertEq(state.globalLiquidityPosition.liquidity, globalLiquidity - 20e6);
    }

    function test_decreaseLiquidityPosition_DecreasingLiquidityPositionWithTheRightStateWhenRealizedPnLGtZero() public {
        LiquidityPositionUtil.DecreaseLiquidityPositionParameter memory params = LiquidityPositionUtil
            .DecreaseLiquidityPositionParameter(MARKET, ACCOUNT, 2e6, 20e6, priceFeed, RECEIVER);
        state.liquidityPositions[ACCOUNT] = IMarketLiquidityPosition.LiquidityPosition({
            margin: 20e6,
            liquidity: 50e6,
            entryUnrealizedPnLGrowthX64: 10 << 64
        });
        uint128 globalLiquidity = state.globalLiquidityPosition.liquidity;
        _mockMinPrice(3000); // ensure realizedPnL is positive
        _expectSettleLiquidityUnrealizedPnLCalled();
        vm.expectEmit(true, true, false, true);
        // realizedPnL: 14999999, marginDelta: 2e6, marginAfter: 20e6-2e6+14999999
        emit IMarketLiquidityPosition.LiquidityPositionDecreased(
            MARKET,
            ACCOUNT,
            2e6,
            32999999,
            30e6,
            14999999,
            RECEIVER
        );
        (uint128 marginAfter, uint128 adjustedMarginDelta) = state.decreaseLiquidityPosition(marketConfig, params);
        assertEq(marginAfter, 32999999); // 20e6-2e6+14999999
        assertEq(adjustedMarginDelta, 2e6);
        assertEq(state.liquidityPositions[ACCOUNT].liquidity, 30e6);
        assertEq(state.globalLiquidityPosition.liquidity, globalLiquidity - 20e6);
    }

    function test_liquidateLiquidityPosition_RevertIf_LiquidityPositionNotFound() public {
        LiquidityPositionUtil.LiquidateLiquidityPositionParameter memory params = LiquidityPositionUtil
            .LiquidateLiquidityPositionParameter(MARKET, ACCOUNT, priceFeed, RECEIVER);
        _expectSettleLiquidityUnrealizedPnLCalled();
        vm.expectRevert(abi.encodeWithSelector(IMarketErrors.LiquidityPositionNotFound.selector, ACCOUNT));
        state.liquidateLiquidityPosition(marketConfig, params);
    }

    function test_liquidateLiquidityPosition_RevertIf_RiskRateTooLow() public {
        LiquidityPositionUtil.LiquidateLiquidityPositionParameter memory params = LiquidityPositionUtil
            .LiquidateLiquidityPositionParameter(MARKET, ACCOUNT, priceFeed, RECEIVER);
        state.liquidityPositions[ACCOUNT] = IMarketLiquidityPosition.LiquidityPosition({
            margin: 20e6,
            liquidity: 50e6,
            entryUnrealizedPnLGrowthX64: 10 << 64
        });
        _expectSettleLiquidityUnrealizedPnLCalled();
        // realizedPnL: -15000001, margin: 20e6-15000001, maintenanceMargin: 0.5e6+50e6*0.2e6/1e8
        vm.expectRevert(abi.encodeWithSelector(IMarketErrors.RiskRateTooLow.selector, 4999999, 600000));
        state.liquidateLiquidityPosition(marketConfig, params);
    }

    function test_liquidateLiquidityPosition_RevertIf_LastLiquidityPositionCannotBeClosed() public {
        LiquidityPositionUtil.LiquidateLiquidityPositionParameter memory params = LiquidityPositionUtil
            .LiquidateLiquidityPositionParameter(MARKET, ACCOUNT, priceFeed, RECEIVER);
        state.liquidityPositions[ACCOUNT] = IMarketLiquidityPosition.LiquidityPosition({
            margin: 10e6,
            liquidity: state.globalLiquidityPosition.liquidity,
            entryUnrealizedPnLGrowthX64: 10 << 64
        });
        state.globalPosition.longSize = 10e6;
        _expectSettleLiquidityUnrealizedPnLCalled();
        vm.expectRevert(IMarketErrors.LastLiquidityPositionCannotBeClosed.selector);
        state.liquidateLiquidityPosition(marketConfig, params);
    }

    function test_liquidateLiquidityPosition_LiquidatedWithTheRightStateWhenRealizedPnlLtZeroAndMarginAfterLtZero()
        public
    {
        LiquidityPositionUtil.LiquidateLiquidityPositionParameter memory params = LiquidityPositionUtil
            .LiquidateLiquidityPositionParameter(MARKET, ACCOUNT, priceFeed, RECEIVER);
        state.liquidityPositions[ACCOUNT] = IMarketLiquidityPosition.LiquidityPosition({
            margin: 10e6,
            liquidity: 100e6,
            entryUnrealizedPnLGrowthX64: 10 << 64
        });
        uint128 globalLiquidity = state.globalLiquidityPosition.liquidity;
        int256 liquidationFund = state.globalLiquidationFund.liquidationFund;
        _expectSettleLiquidityUnrealizedPnLCalled();
        vm.expectEmit(true, true, true, true);
        // realizedPnL: -30000001, marginAfter: 10e6-30000001-0.5e6, unrealizedPnLGrowthAfterX64: 184467440737095516160-5534023222112865485-378196091566947
        emit IMarketLiquidityPosition.LiquidityPositionLiquidated(
            MARKET,
            ACCOUNT,
            msg.sender,
            -20500001, // 10e6-30000001-0.5e6
            178933039318891083728, // 184467440737095516160-5534023222112865485-378196091566947
            RECEIVER
        );
        uint64 liquidationExecutionFee = state.liquidateLiquidityPosition(marketConfig, params);
        assertEq(liquidationExecutionFee, 0.5e6);
        assertEq(state.liquidityPositions[ACCOUNT].liquidity, 0);
        assertEq(state.globalLiquidityPosition.liquidity, globalLiquidity - 100e6);
        assertEq(state.globalLiquidationFund.liquidationFund, liquidationFund);
    }

    function test_liquidateLiquidityPosition_LiquidatedWithTheRightStateWhenRealizedPnlGtZeroAndMarginAfterLtZero()
        public
    {
        LiquidityPositionUtil.LiquidateLiquidityPositionParameter memory params = LiquidityPositionUtil
            .LiquidateLiquidityPositionParameter(MARKET, ACCOUNT, priceFeed, RECEIVER);
        state.liquidityPositions[ACCOUNT] = IMarketLiquidityPosition.LiquidityPosition({
            margin: 10e6,
            liquidity: 30e6,
            entryUnrealizedPnLGrowthX64: 10 << 64
        });
        marketConfig.baseConfig.liquidationExecutionFee = 20e6;
        uint128 globalLiquidity = state.globalLiquidityPosition.liquidity;
        int256 liquidationFund = state.globalLiquidationFund.liquidationFund;
        _mockMinPrice(3000); // ensure realizedPnL is positive
        _expectSettleLiquidityUnrealizedPnLCalled();
        vm.expectEmit(true, true, true, true);
        // realizedPnL: 8999999, marginAfter: 10e6+8999999-20e6, unrealizedPnLGrowthAfterX64: 184467440737095516160+5534023222112865484-18447315939932
        emit IMarketLiquidityPosition.LiquidityPositionLiquidated(
            MARKET,
            ACCOUNT,
            msg.sender,
            -1000001, // 10e6+8999999-20e6
            190001445511892441712, // 184467440737095516160+5534023222112865484-18447315939932
            RECEIVER
        );
        uint64 liquidationExecutionFee = state.liquidateLiquidityPosition(marketConfig, params);
        assertEq(liquidationExecutionFee, 20e6);
        assertEq(state.liquidityPositions[ACCOUNT].liquidity, 0);
        assertEq(state.globalLiquidityPosition.liquidity, globalLiquidity - 30e6);
        assertEq(state.globalLiquidationFund.liquidationFund, liquidationFund);
    }

    function test_liquidateLiquidityPosition_LiquidatedWithTheRightStateWhenMarginAfterGtZero() public {
        LiquidityPositionUtil.LiquidateLiquidityPositionParameter memory params = LiquidityPositionUtil
            .LiquidateLiquidityPositionParameter(MARKET, ACCOUNT, priceFeed, RECEIVER);
        state.liquidityPositions[ACCOUNT] = IMarketLiquidityPosition.LiquidityPosition({
            margin: 10e6,
            liquidity: 20e6,
            entryUnrealizedPnLGrowthX64: 10 << 64
        });
        marketConfig.baseConfig.liquidationExecutionFee = 3.99e6;
        uint128 globalLiquidity = state.globalLiquidityPosition.liquidity;
        int256 liquidationFund = state.globalLiquidationFund.liquidationFund;
        _expectSettleLiquidityUnrealizedPnLCalled();
        vm.expectEmit(true, true, true, true);
        // realizedPnL: -6000001, marginAfter: 10e6-6000001-3.99e6, unrealizedPnLGrowthAfterX64: 184467440737095516160-5534023222112865485
        emit IMarketLiquidityPosition.LiquidityPositionLiquidated(
            MARKET,
            ACCOUNT,
            msg.sender,
            9999, // 10e6-6000001-3.99e6
            178933417514982650675, // 184467440737095516160-5534023222112865485
            RECEIVER
        );
        uint64 liquidationExecutionFee = state.liquidateLiquidityPosition(marketConfig, params);
        assertEq(liquidationExecutionFee, 3.99e6);
        assertEq(state.liquidityPositions[ACCOUNT].liquidity, 0);
        assertEq(state.globalLiquidityPosition.liquidity, globalLiquidity - 20e6);
        assertEq(state.globalLiquidationFund.liquidationFund, liquidationFund + 9999);
    }

    function test_liquidateLiquidityPosition_LiquidatedWithTheRightStateWhenGlobalLiquidityPositionSideIsShort()
        public
    {
        LiquidityPositionUtil.LiquidateLiquidityPositionParameter memory params = LiquidityPositionUtil
            .LiquidateLiquidityPositionParameter(MARKET, ACCOUNT, priceFeed, RECEIVER);
        state.liquidityPositions[ACCOUNT] = IMarketLiquidityPosition.LiquidityPosition({
            margin: 10e6,
            liquidity: 20e6,
            entryUnrealizedPnLGrowthX64: 10 << 64
        });
        state.globalLiquidityPosition.side = SHORT;
        marketConfig.baseConfig.liquidationExecutionFee = 3.99e6;
        uint128 globalLiquidity = state.globalLiquidityPosition.liquidity;
        int256 liquidationFund = state.globalLiquidationFund.liquidationFund;
        _mockMaxPrice(3000); // ensure realizedPnL is negative
        _expectSettleLiquidityUnrealizedPnLCalled();
        vm.expectEmit(true, true, true, true);
        // realizedPnL: -6000001, marginAfter: 10e6-6000001-3.99e6, unrealizedPnLGrowthAfterX64: 184467440737095516160-5534023222112865485
        emit IMarketLiquidityPosition.LiquidityPositionLiquidated(
            MARKET,
            ACCOUNT,
            msg.sender,
            9999, // 10e6-6000001-3.99e6
            178933417514982650675, // 184467440737095516160-5534023222112865485
            RECEIVER
        );
        uint64 liquidationExecutionFee = state.liquidateLiquidityPosition(marketConfig, params);
        assertEq(liquidationExecutionFee, 3.99e6);
        assertEq(state.liquidityPositions[ACCOUNT].liquidity, 0);
        assertEq(state.globalLiquidityPosition.liquidity, globalLiquidity - 20e6);
        assertEq(state.globalLiquidationFund.liquidationFund, liquidationFund + 9999);
    }

    function _expectSettleLiquidityUnrealizedPnLCalled() private {
        // the event is emitted after the settleLiquidityUnrealizedPnL call
        vm.expectEmit(true, false, false, false);
        emit IMarketLiquidityPosition.SettlementPointReached(MARKET, 0, 0);
    }

    function _toPriceX96(uint256 _price) private pure returns (uint160) {
        return uint160((_price * 2 ** 96 * 10 ** 6) / 10 ** 18);
    }

    function _mockMaxPrice(uint256 _price) private {
        vm.mockCall(
            address(priceFeed),
            abi.encodeWithSignature("getMaxPriceX96(address)", address(MARKET)),
            abi.encode(_toPriceX96(_price))
        );
    }

    function _mockMinPrice(uint256 _price) private {
        vm.mockCall(
            address(priceFeed),
            abi.encodeWithSignature("getMinPriceX96(address)", address(MARKET)),
            abi.encode(_toPriceX96(_price))
        );
    }
}
