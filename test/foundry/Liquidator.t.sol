// SPDX-License-Identifier: UNLICENSED
pragma solidity =0.8.23;

import "forge-std/Test.sol";
import "forge-std/mocks/MockERC20.sol";
import "../../contracts/test/MockEFC.sol";
import "../../contracts/test/MockRouter.sol";
import "../../contracts/test/MockPriceFeed.sol";
import "../../contracts/plugins/Liquidator.sol";
import "../../contracts/test/MockMarketManager.sol";

contract LiquidatorTest is Test {
    address private constant MARKET = address(0x111);
    address private constant ACCOUNT = address(0x222);
    address private constant FEE_RECEIVER = address(0x333);
    MockRouter private router;
    MockMarketManager private marketManager;
    MockPriceFeed private priceFeed;
    Liquidator private liquidator;
    MockERC20 private usd;
    MockEFC private efc;

    function setUp() public {
        router = new MockRouter();
        priceFeed = new MockPriceFeed();
        marketManager = new MockMarketManager();
        usd = StdUtils.deployMockERC20("USD", "USD", 6);
        efc = new MockEFC();
        marketManager.setPriceFeed(IPriceFeed(address(priceFeed)));

        liquidator = new Liquidator(
            Router(address(router)),
            MarketManager(address(marketManager)),
            IERC20(address(usd)),
            IEFC(address(efc))
        );
        liquidator.updateExecutor(address(this), true);
    }

    function test_updatePriceFeed() public {
        vm.prank(address(1));
        vm.expectRevert(Governable.Forbidden.selector);
        liquidator.updatePriceFeed();

        marketManager.setPriceFeed(IPriceFeed(address(1)));
        liquidator.updatePriceFeed();
        assertEq(address(liquidator.priceFeed()), address(1));
    }

    function test_updateExecutor() public {
        vm.prank(address(1));
        vm.expectRevert(Governable.Forbidden.selector);
        liquidator.updateExecutor(address(1), true);

        vm.expectEmit(false, false, false, true);
        emit ILiquidator.ExecutorUpdated(address(1), true);
        liquidator.updateExecutor(address(1), true);
        assertTrue(liquidator.executors(address(1)));

        vm.expectEmit(false, false, false, true);
        emit ILiquidator.ExecutorUpdated(address(1), false);
        liquidator.updateExecutor(address(1), false);
        assertFalse(liquidator.executors(address(1)));
    }

    function test_liquidateLiquidityPosition() public {
        vm.prank(address(1));
        vm.expectRevert(Governable.Forbidden.selector);
        liquidator.liquidateLiquidityPosition(IMarketDescriptor(MARKET), ACCOUNT, FEE_RECEIVER);

        vm.expectCall(
            address(router),
            abi.encodeWithSignature(
                "pluginLiquidateLiquidityPosition(address,address,address)",
                MARKET,
                ACCOUNT,
                FEE_RECEIVER
            )
        );
        liquidator.liquidateLiquidityPosition(IMarketDescriptor(MARKET), ACCOUNT, FEE_RECEIVER);
    }

    function test_liquidatePosition_RevertIf_SenderIsNotExecutor() public {
        vm.prank(address(1));
        vm.expectRevert(Governable.Forbidden.selector);
        liquidator.liquidatePosition(IMarketDescriptor(MARKET), ACCOUNT, LONG, FEE_RECEIVER);
    }

    function test_liquidatePosition_LiquidateWhenPositionSideIsLongAndSizeIsZero() public {
        vm.expectCall(address(priceFeed), abi.encodeWithSignature("getMinPriceX96(address)", MARKET), 1);
        vm.expectCall(
            address(marketManager),
            abi.encodeWithSignature("positions(address,address,uint8)", MARKET, ACCOUNT, LONG),
            1
        );
        vm.expectCall(
            address(router),
            abi.encodeWithSignature(
                "pluginLiquidatePosition(address,address,uint8,address)",
                MARKET,
                ACCOUNT,
                LONG,
                FEE_RECEIVER
            ),
            1
        );
        liquidator.liquidatePosition(IMarketDescriptor(MARKET), ACCOUNT, LONG, FEE_RECEIVER);
    }

    function test_liquidatePosition_LiquidateWhenPositionSideIsLongAndSizeIsGtZeroAndHasNotUnrealizedProfit() public {
        vm.mockCall(
            address(priceFeed),
            abi.encodeWithSignature("getMinPriceX96(address)", MARKET),
            abi.encode(uint160(1 << 96))
        );
        vm.mockCall(
            address(marketManager),
            abi.encodeWithSignature("positions(address,address,uint8)", MARKET, ACCOUNT, LONG),
            abi.encode(IMarketPosition.Position(1, 1, (1 << 96) * 2, 1))
        );
        vm.expectCall(address(priceFeed), abi.encodeWithSignature("getMinPriceX96(address)", MARKET), 1);
        vm.expectCall(
            address(marketManager),
            abi.encodeWithSignature("positions(address,address,uint8)", MARKET, ACCOUNT, LONG),
            1
        );
        vm.expectCall(
            address(router),
            abi.encodeWithSignature(
                "pluginLiquidatePosition(address,address,uint8,address)",
                MARKET,
                ACCOUNT,
                LONG,
                FEE_RECEIVER
            ),
            1
        );
        liquidator.liquidatePosition(IMarketDescriptor(MARKET), ACCOUNT, LONG, FEE_RECEIVER);
    }

    function test_liquidatePosition_LiquidateWhenPositionSideIsShortAndSizeIsZero() public {
        vm.expectCall(address(priceFeed), abi.encodeWithSignature("getMaxPriceX96(address)", MARKET), 1);
        vm.expectCall(
            address(marketManager),
            abi.encodeWithSignature("positions(address,address,uint8)", MARKET, ACCOUNT, SHORT),
            1
        );
        vm.expectCall(
            address(router),
            abi.encodeWithSignature(
                "pluginLiquidatePosition(address,address,uint8,address)",
                MARKET,
                ACCOUNT,
                SHORT,
                FEE_RECEIVER
            ),
            1
        );
        liquidator.liquidatePosition(IMarketDescriptor(MARKET), ACCOUNT, SHORT, FEE_RECEIVER);
    }

    function test_liquidatePosition_LiquidateWhenPositionSideIsShortAndSizeIsGtZeroAndHasNotUnrealizedProfit() public {
        vm.mockCall(
            address(priceFeed),
            abi.encodeWithSignature("getMaxPriceX96(address)", MARKET),
            abi.encode(uint160(1 << 96))
        );
        vm.mockCall(
            address(marketManager),
            abi.encodeWithSignature("positions(address,address,uint8)", MARKET, ACCOUNT, SHORT),
            abi.encode(IMarketPosition.Position(1, 1, (1 << 96) / 2, 1))
        );
        vm.expectCall(address(priceFeed), abi.encodeWithSignature("getMaxPriceX96(address)", MARKET), 1);
        vm.expectCall(
            address(marketManager),
            abi.encodeWithSignature("positions(address,address,uint8)", MARKET, ACCOUNT, SHORT),
            1
        );
        vm.expectCall(
            address(router),
            abi.encodeWithSignature(
                "pluginLiquidatePosition(address,address,uint8,address)",
                MARKET,
                ACCOUNT,
                SHORT,
                FEE_RECEIVER
            ),
            1
        );
        liquidator.liquidatePosition(IMarketDescriptor(MARKET), ACCOUNT, SHORT, FEE_RECEIVER);
    }

    function test_liquidatePosition_RevertIfMarginRateTooLow() public {
        priceFeed.setMaxPriceX96(uint160(1 << 96));
        marketManager.setPosition(
            IMarketDescriptor(address(MARKET)),
            ACCOUNT,
            SHORT,
            IMarketPosition.Position(2, 1, (1 << 96) * 2, 1)
        );
        vm.expectCall(address(priceFeed), abi.encodeWithSignature("getMaxPriceX96(address)", MARKET), 1);
        vm.expectCall(
            address(marketManager),
            abi.encodeWithSignature("positions(address,address,uint8)", MARKET, ACCOUNT, SHORT),
            1
        );
        vm.expectCall(address(router), abi.encodeWithSignature("pluginSampleAndAdjustFundingRate(address)", MARKET), 1);
        vm.expectCall(address(marketManager), abi.encodeWithSignature("marketFeeRateConfigs(address)", MARKET), 1);
        vm.expectCall(address(efc), abi.encodeWithSignature("referrerTokens(address)", ACCOUNT), 1);
        vm.expectCall(address(marketManager), abi.encodeWithSignature("marketBaseConfigs(address)", MARKET), 1);
        vm.expectRevert(abi.encodeWithSelector(IMarketErrors.MarginRateTooLow.selector, 1, 1, 0));
        liquidator.liquidatePosition(IMarketDescriptor(MARKET), ACCOUNT, SHORT, FEE_RECEIVER);
    }

    function test_liquidatePosition_ClosePositionByLiquidatorWhenMarginIsSufficient() public {
        priceFeed.setMaxPriceX96(uint160(1 << 96));
        marketManager.setPosition(
            IMarketDescriptor(address(MARKET)),
            ACCOUNT,
            SHORT,
            IMarketPosition.Position(1, 1, (1 << 96) * 2, 1)
        );
        deal(address(usd), address(liquidator), 100); // balance: 100
        vm.mockCall(
            address(marketManager),
            abi.encodeWithSignature("marketBaseConfigs(address)", MARKET),
            abi.encode(IConfigurable.MarketBaseConfig(0, 0, 0, 0, 0, 0, 0, 0, 0, 10, 0, 0)) // liquidationExecutionFee: 10
        );
        vm.expectCall(address(priceFeed), abi.encodeWithSignature("getMaxPriceX96(address)", MARKET), 1);
        vm.expectCall(
            address(marketManager),
            abi.encodeWithSignature("positions(address,address,uint8)", MARKET, ACCOUNT, SHORT),
            1
        );
        vm.expectCall(address(router), abi.encodeWithSignature("pluginSampleAndAdjustFundingRate(address)", MARKET), 1);
        vm.expectCall(address(marketManager), abi.encodeWithSignature("marketFeeRateConfigs(address)", MARKET), 1);
        vm.expectCall(address(efc), abi.encodeWithSignature("referrerTokens(address)", ACCOUNT), 1);
        vm.expectCall(address(marketManager), abi.encodeWithSignature("marketBaseConfigs(address)", MARKET), 1);
        vm.expectEmit(true, true, false, true);
        emit IERC20.Transfer(address(liquidator), FEE_RECEIVER, 10);
        vm.expectEmit(true, true, false, true);
        emit IERC20.Transfer(address(liquidator), ACCOUNT, 90);
        vm.expectEmit(true, true, false, true);
        emit ILiquidator.PositionClosedByLiquidator(IMarketDescriptor(MARKET), ACCOUNT, SHORT, 10);
        liquidator.liquidatePosition(IMarketDescriptor(MARKET), ACCOUNT, SHORT, FEE_RECEIVER);
    }

    function test_liquidatePosition_ClosePositionByLiquidatorWhenMarginIsInsufficient() public {
        priceFeed.setMaxPriceX96(uint160(1 << 96));
        marketManager.setPosition(
            IMarketDescriptor(address(MARKET)),
            ACCOUNT,
            SHORT,
            IMarketPosition.Position(1, 1, (1 << 96) * 2, 1)
        );
        deal(address(usd), address(liquidator), 10); // balance: 10
        vm.mockCall(
            address(marketManager),
            abi.encodeWithSignature("marketBaseConfigs(address)", MARKET),
            abi.encode(IConfigurable.MarketBaseConfig(0, 0, 0, 0, 0, 0, 0, 0, 0, 20, 0, 0)) // liquidationExecutionFee: 20
        );
        vm.expectCall(address(priceFeed), abi.encodeWithSignature("getMaxPriceX96(address)", MARKET), 1);
        vm.expectCall(
            address(marketManager),
            abi.encodeWithSignature("positions(address,address,uint8)", MARKET, ACCOUNT, SHORT),
            1
        );
        vm.expectCall(address(router), abi.encodeWithSignature("pluginSampleAndAdjustFundingRate(address)", MARKET), 1);
        vm.expectCall(address(marketManager), abi.encodeWithSignature("marketFeeRateConfigs(address)", MARKET), 1);
        vm.expectCall(address(efc), abi.encodeWithSignature("referrerTokens(address)", ACCOUNT), 1);
        vm.expectCall(address(marketManager), abi.encodeWithSignature("marketBaseConfigs(address)", MARKET), 1);
        vm.expectEmit(true, true, false, true);
        emit IERC20.Transfer(address(liquidator), FEE_RECEIVER, 10);
        vm.expectEmit(true, true, false, true);
        emit ILiquidator.PositionClosedByLiquidator(IMarketDescriptor(MARKET), ACCOUNT, SHORT, 10);
        liquidator.liquidatePosition(IMarketDescriptor(MARKET), ACCOUNT, SHORT, FEE_RECEIVER);
    }

    function test_liquidatePosition_LiquidatePositionWhenPluginClosePositionByLiquidatorFailed() public {
        priceFeed.setMaxPriceX96(uint160(1 << 96));
        marketManager.setPosition(
            IMarketDescriptor(address(MARKET)),
            ACCOUNT,
            SHORT,
            IMarketPosition.Position(1, 1, (1 << 96) * 2, 1)
        );
        vm.mockCall(
            address(marketManager),
            abi.encodeWithSignature("marketBaseConfigs(address)", MARKET),
            abi.encode(IConfigurable.MarketBaseConfig(0, 0, 0, 0, 0, 0, 0, 0, 0, 20, 0, 0)) // liquidationExecutionFee: 20
        );
        vm.mockCallRevert(
            address(router),
            abi.encodeWithSignature(
                "pluginClosePositionByLiquidator(address,address,uint8,uint128,address)",
                MARKET,
                ACCOUNT,
                SHORT,
                1,
                address(liquidator)
            ),
            "reverted by mock call"
        );
        vm.expectCall(address(priceFeed), abi.encodeWithSignature("getMaxPriceX96(address)", MARKET), 1);
        vm.expectCall(
            address(marketManager),
            abi.encodeWithSignature("positions(address,address,uint8)", MARKET, ACCOUNT, SHORT),
            1
        );
        vm.expectCall(address(router), abi.encodeWithSignature("pluginSampleAndAdjustFundingRate(address)", MARKET), 1);
        vm.expectCall(address(marketManager), abi.encodeWithSignature("marketFeeRateConfigs(address)", MARKET), 1);
        vm.expectCall(address(efc), abi.encodeWithSignature("referrerTokens(address)", ACCOUNT), 1);
        vm.expectCall(address(marketManager), abi.encodeWithSignature("marketBaseConfigs(address)", MARKET), 1);
        vm.expectCall(
            address(router),
            abi.encodeWithSignature(
                "pluginLiquidatePosition(address,address,uint8,address)",
                MARKET,
                ACCOUNT,
                SHORT,
                FEE_RECEIVER
            ),
            1
        );
        liquidator.liquidatePosition(IMarketDescriptor(MARKET), ACCOUNT, SHORT, FEE_RECEIVER);
    }
}
