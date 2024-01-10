// SPDX-License-Identifier: UNLICENSED
pragma solidity =0.8.23;

import "forge-std/Test.sol";
import "../../contracts/plugins/Router.sol";
import "../../contracts/misc/MixedExecutor.sol";
import "../../contracts/test/MockMarketManager.sol";

contract MixedExecutorTest is Test {
    MixedExecutor public executor;

    event IncreaseOrderExecuteFailed(uint256 indexed orderIndex);
    event DecreaseOrderExecuteFailed(uint256 indexed orderIndex);

    function setUp() public {
        MockMarketManager marketManager = new MockMarketManager();
        MarketIndexer marketIndexer = new MarketIndexer(IMarketManager(address(marketManager)));
        vm.mockCall(address(marketManager), abi.encodePacked(IConfigurable.isEnabledMarket.selector), abi.encode(true));
        IMarketDescriptor market1 = IMarketDescriptor(address(0x101));
        IMarketDescriptor market2 = IMarketDescriptor(address(0x102));
        marketIndexer.assignMarketIndex(market1);
        marketIndexer.assignMarketIndex(market2);
        executor = new MixedExecutor(
            Router(address(0)),
            marketIndexer,
            ILiquidator(address(0)),
            IPositionRouter(address(0)),
            IPriceFeed(address(0)),
            IOrderBook(address(new OrderBook_Thrown_InvalidMarketTriggerPrice())),
            IMarketManager(address(marketManager))
        );
        executor.setExecutor(address(this), true);
    }

    function test_executeIncreaseOrder_RevertIf_RequireSuccessIsTrue() public {
        PackedValue packed = PackedValue.wrap(0);
        packed = packed.packUint248(1111, 0);
        packed = packed.packBool(true, 248);
        vm.expectRevert(
            abi.encodeWithSelector(
                MixedExecutor.ExecutionFailed.selector,
                abi.encodeWithSelector(IOrderBook.InvalidMarketPriceToTrigger.selector, 111, 222)
            )
        );
        executor.executeIncreaseOrder(packed);
    }

    function test_executeIncreaseOrder_DoNotCancelOrderDueToInvalidMarketTriggerPrice() public {
        PackedValue packed = PackedValue.wrap(0);
        packed = packed.packUint248(1111, 0);
        packed = packed.packBool(false, 248);
        vm.expectEmit(true, false, false, false);
        emit IncreaseOrderExecuteFailed(1111);
        executor.executeIncreaseOrder(packed);
    }

    function test_executeDecreaseOrder_RevertIf_RequireSucessIsTrue() public {
        PackedValue packed = PackedValue.wrap(0);
        packed = packed.packUint248(2222, 0);
        packed = packed.packBool(true, 248);
        vm.expectRevert(
            abi.encodeWithSelector(
                MixedExecutor.ExecutionFailed.selector,
                abi.encodeWithSelector(IOrderBook.InvalidMarketPriceToTrigger.selector, 222, 333)
            )
        );
        executor.executeDecreaseOrder(packed);
    }

    function test_executeDecreaseOrder_DoNotCancelOrderDueToInvalidMarketTriggerPrice() public {
        PackedValue packed = PackedValue.wrap(0);
        packed = packed.packUint248(2222, 0);
        packed = packed.packBool(false, 248);
        vm.expectEmit(true, false, false, false);
        emit DecreaseOrderExecuteFailed(2222);
        executor.executeDecreaseOrder(packed);
    }
}

contract OrderBook_Thrown_InvalidMarketTriggerPrice {
    function executeIncreaseOrder(uint256, address) external pure {
        revert IOrderBook.InvalidMarketPriceToTrigger(111, 222);
    }

    function executeDecreaseOrder(uint256, address) external pure {
        revert IOrderBook.InvalidMarketPriceToTrigger(222, 333);
    }
}
