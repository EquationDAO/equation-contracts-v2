// SPDX-License-Identifier: UNLICENSED
pragma solidity =0.8.23;

import "forge-std/Test.sol";
import "../../contracts/test/MockPriceFeed.sol";
import "../../contracts/test/MarketUtilHarness.sol";

contract MarketUtilTest is Test {
    MarketUtilHarness util;
    MockPriceFeed priceFeed;

    function setUp() public {
        util = new MarketUtilHarness();
        priceFeed = new MockPriceFeed();
    }

    function testFuzz_increaseLiquidationFundPosition_SingleAccount(
        IMarketDescriptor _market,
        address _account,
        uint128 _liquidityDelta1,
        uint128 _liquidityDelta2
    ) public {
        vm.expectEmit(true, true, true, true, address(util));
        emit IMarketManager.LiquidationFundPositionIncreased(_market, _account, _liquidityDelta1);
        util.increaseLiquidationFundPosition(_market, _account, _liquidityDelta1);

        IMarketManager.GlobalLiquidationFund memory fund = util.globalLiquidationFund();
        assertEq(fund.liquidity, _liquidityDelta1);
        assertEq(fund.liquidationFund, int256(uint256(_liquidityDelta1)));

        assertEq(util.liquidationFundPositions(_account), _liquidityDelta1);

        vm.expectEmit(true, true, true, true, address(util));
        emit IMarketManager.LiquidationFundPositionIncreased(
            _market,
            _account,
            uint256(_liquidityDelta1) + _liquidityDelta2
        );
        util.increaseLiquidationFundPosition(_market, _account, _liquidityDelta2);

        fund = util.globalLiquidationFund();
        assertEq(fund.liquidity, uint256(_liquidityDelta1) + _liquidityDelta2);
        assertEq(fund.liquidationFund, int256(uint256(_liquidityDelta1) + _liquidityDelta2));

        assertEq(util.liquidationFundPositions(_account), uint256(_liquidityDelta1) + _liquidityDelta2);
    }

    function testFuzz_increaseLiquidationFundPosition_MultipleAccount(
        IMarketDescriptor _market,
        uint128 _liquidityDelta1,
        uint128 _liquidityDelta2
    ) public {
        address[] memory accounts = new address[](2);
        accounts[0] = address(1);
        accounts[1] = address(2);
        for (uint j; j < accounts.length; ++j) {
            address account = accounts[j];
            util.increaseLiquidationFundPosition(_market, account, _liquidityDelta1);
            util.increaseLiquidationFundPosition(_market, account, _liquidityDelta2);

            assertEq(util.liquidationFundPositions(account), uint256(_liquidityDelta1) + _liquidityDelta2);
        }
        IMarketManager.GlobalLiquidationFund memory fund = util.globalLiquidationFund();
        assertEq(fund.liquidity, (uint256(_liquidityDelta1) + _liquidityDelta2) * 2);
        assertEq(fund.liquidationFund, (int256(uint256(_liquidityDelta1) + _liquidityDelta2)) * 2);
    }

    function test_decreaseLiquidationFundPosition_RevertIf_FundIsExperiencingLosses(
        IMarketDescriptor _market,
        address _account
    ) public {
        util.setLiquidationFund(-1);
        util.increaseLiquidationFundPosition(_market, _account, 1);
        vm.expectRevert(IMarketErrors.LiquidationFundLoss.selector);
        util.decreaseLiquidationFundPosition(_market, _account, 1, address(0));
    }

    function testFuzz_decreaseLiquidationFundPosition(
        IMarketDescriptor _market,
        address _account,
        uint128 _increased,
        uint128 _decreased,
        address _receiver
    ) public {
        util.increaseLiquidationFundPosition(_market, _account, _increased);
        if (_decreased > _increased) {
            vm.expectRevert(
                abi.encodeWithSelector(IMarketErrors.InsufficientLiquidityToDecrease.selector, _increased, _decreased)
            );
            util.decreaseLiquidationFundPosition(_market, _account, _decreased, _receiver);
        } else {
            vm.expectEmit(true, true, true, true, address(util));
            emit IMarketManager.LiquidationFundPositionDecreased(_market, _account, _increased - _decreased, _receiver);
            util.decreaseLiquidationFundPosition(_market, _account, _decreased, _receiver);

            assertEq(util.liquidationFundPositions(_account), _increased - _decreased);

            IMarketManager.GlobalLiquidationFund memory fund = util.globalLiquidationFund();
            assertEq(fund.liquidity, _increased - _decreased);
            assertEq(fund.liquidationFund, int256(uint256(_increased) - _decreased));
        }
    }

    function test_govUseLiquidationFund_RevertIf_FundIsExperiencingLosses() public {
        util.increaseLiquidationFundPosition(IMarketDescriptor(address(1)), address(1), 100);
        util.setLiquidationFund(99);
        vm.expectRevert(abi.encodeWithSelector(IMarketErrors.InsufficientLiquidationFund.selector, 10));
        util.govUseLiquidationFund(IMarketDescriptor(address(1)), 10, address(1));
    }

    function test_govUseLiquidationFund_RevertIf_DeltaIsTooLarge() public {
        util.increaseLiquidationFundPosition(IMarketDescriptor(address(1)), address(1), 100);
        util.setLiquidationFund(200);
        vm.expectRevert(abi.encodeWithSelector(IMarketErrors.InsufficientLiquidationFund.selector, 101));
        util.govUseLiquidationFund(IMarketDescriptor(address(1)), 101, address(1));
    }

    function test_govUseLiquidationFund() public {
        util.increaseLiquidationFundPosition(IMarketDescriptor(address(1)), address(1), 100);
        util.setLiquidationFund(200);
        vm.expectEmit(true, true, true, true, address(util));
        emit IMarketManager.GlobalLiquidationFundGovUsed(IMarketDescriptor(address(1)), address(2), 50);
        util.govUseLiquidationFund(IMarketDescriptor(address(1)), 50, address(2));

        IMarketManager.GlobalLiquidationFund memory fund = util.globalLiquidationFund();
        assertEq(fund.liquidity, 100);
        assertEq(fund.liquidationFund, 150);
    }

    function test_initializePreviousSPPrice_NotChangeBecauseNetSizeGT0() public {
        util.setGlobalLiquidityPosition(
            IMarketLiquidityPosition.GlobalLiquidityPosition({
                netSize: 1,
                liquidationBufferNetSize: 0,
                previousSPPriceX96: 100,
                side: Side.wrap(1),
                liquidity: 0,
                unrealizedPnLGrowthX64: 0
            })
        );

        util.initializePreviousSPPrice(IMarketDescriptor(address(1)), 200);

        IMarketManager.GlobalLiquidityPosition memory position = util.globalLiquidityPosition();
        assertEq(position.previousSPPriceX96, 100);
    }

    function test_initializePreviousSPPrice_NotChangeBecauseLiquidationBufferNetSizeGT0() public {
        util.setGlobalLiquidityPosition(
            IMarketLiquidityPosition.GlobalLiquidityPosition({
                netSize: 0,
                liquidationBufferNetSize: 1,
                previousSPPriceX96: 100,
                side: Side.wrap(1),
                liquidity: 0,
                unrealizedPnLGrowthX64: 0
            })
        );

        util.initializePreviousSPPrice(IMarketDescriptor(address(1)), 200);

        IMarketManager.GlobalLiquidityPosition memory position = util.globalLiquidityPosition();
        assertEq(position.previousSPPriceX96, 100);
    }

    function test_initializePreviousSPPrice() public {
        util.setGlobalLiquidityPosition(
            IMarketLiquidityPosition.GlobalLiquidityPosition({
                netSize: 0,
                liquidationBufferNetSize: 0,
                previousSPPriceX96: 100,
                side: Side.wrap(1),
                liquidity: 0,
                unrealizedPnLGrowthX64: 0
            })
        );

        vm.expectEmit(true, true, true, true, address(util));
        emit IMarketLiquidityPosition.PreviousSPPriceInitialized(IMarketDescriptor(address(1)), 200);
        util.initializePreviousSPPrice(IMarketDescriptor(address(1)), 200);

        IMarketManager.GlobalLiquidityPosition memory position = util.globalLiquidityPosition();
        assertEq(position.previousSPPriceX96, 200);
    }

    function testFuzz_chooseIndexPriceX96(uint160 _indexPriceX96, bool longOrShort) public {
        Side side = longOrShort ? Side.wrap(1) : Side.wrap(2);
        (uint160 min, uint160 max) = _indexPriceX96 > 2 ? (_indexPriceX96 - 2, _indexPriceX96) : (1, 3);
        priceFeed.setMinPriceX96(min);
        priceFeed.setMaxPriceX96(max);

        assertEq(
            util.chooseIndexPriceX96(IPriceFeed(address(priceFeed)), IMarketDescriptor(address(1)), side),
            side.isLong() ? max : min
        );
    }

    function testFuzz_chooseDecreaseIndexPriceX96(uint160 _indexPriceX96, bool longOrShort) public {
        Side side = longOrShort ? Side.wrap(1) : Side.wrap(2);
        (uint160 min, uint160 max) = _indexPriceX96 > 2 ? (_indexPriceX96 - 2, _indexPriceX96) : (1, 3);
        priceFeed.setMinPriceX96(min);
        priceFeed.setMaxPriceX96(max);

        assertEq(
            util.chooseDecreaseIndexPriceX96(IPriceFeed(address(priceFeed)), IMarketDescriptor(address(1)), side),
            side.isLong() ? min : max
        );
    }

    function test_settleLiquidityUnrealizedPnL_TotalNetSizeIsZero() public {
        priceFeed.setMinPriceX96(1);
        priceFeed.setMaxPriceX96(2);
        util.settleLiquidityUnrealizedPnL(IPriceFeed(address(priceFeed)), IMarketDescriptor(address(1)));

        IMarketManager.GlobalLiquidityPosition memory position = util.globalLiquidityPosition();
        assertEq(position.unrealizedPnLGrowthX64, 0);
        assertEq(position.previousSPPriceX96, 0);
    }

    function test_settleLiquidityUnrealizedPnL_NotRevertIf_TotalNetSizeExceedsMaxUint128() public {
        util.setGlobalLiquidityPosition(
            IMarketLiquidityPosition.GlobalLiquidityPosition({
                netSize: type(uint128).max,
                liquidationBufferNetSize: 1,
                previousSPPriceX96: 1 << 96,
                side: Side.wrap(1),
                liquidity: 1000e6,
                unrealizedPnLGrowthX64: 0
            })
        );
        util.settleLiquidityUnrealizedPnL(IPriceFeed(address(priceFeed)), IMarketDescriptor(address(1)));
    }

    function test_settleLiquidityUnrealizedPnL_ForLongSide() public {
        util.setGlobalLiquidityPosition(
            IMarketLiquidityPosition.GlobalLiquidityPosition({
                netSize: 1e18,
                liquidationBufferNetSize: 9e18,
                previousSPPriceX96: 1 << 96,
                side: Side.wrap(1),
                liquidity: 1000e6,
                unrealizedPnLGrowthX64: 0
            })
        );

        // scenario: Long, price increase
        priceFeed.setMinPriceX96(1 << 97);
        uint256 deltaX64 = ((uint256(1 << 97) - uint256(1 << 96)) * (1e18 + 9e18)) / (Constants.Q32 * 1000e6);
        vm.expectEmit(true, true, true, true, address(util));
        emit IMarketLiquidityPosition.SettlementPointReached(IMarketDescriptor(address(1)), int256(deltaX64), 1 << 97);
        util.settleLiquidityUnrealizedPnL(IPriceFeed(address(priceFeed)), IMarketDescriptor(address(1)));

        IMarketManager.GlobalLiquidityPosition memory position = util.globalLiquidityPosition();
        assertEq(position.previousSPPriceX96, 1 << 97);
        assertEq(position.unrealizedPnLGrowthX64, int256(deltaX64));

        // scenario: Long, price decrease
        priceFeed.setMinPriceX96(1 << 96);
        deltaX64 = Math.mulDivUp((1 << 97) - (1 << 96), 1e18 + 9e18, Constants.Q32 * 1000e6);
        int256 afterX64 = position.unrealizedPnLGrowthX64 - int256(deltaX64);
        vm.expectEmit(true, true, true, true, address(util));
        emit IMarketLiquidityPosition.SettlementPointReached(IMarketDescriptor(address(1)), afterX64, 1 << 96);
        util.settleLiquidityUnrealizedPnL(IPriceFeed(address(priceFeed)), IMarketDescriptor(address(1)));

        position = util.globalLiquidityPosition();
        assertEq(position.previousSPPriceX96, 1 << 96);
        assertEq(position.unrealizedPnLGrowthX64, afterX64);

        // scenario: Long, price decrease 2
        priceFeed.setMinPriceX96(1 << 95);
        deltaX64 = Math.mulDivUp((1 << 96) - (1 << 95), 1e18 + 9e18, Constants.Q32 * 1000e6);
        afterX64 = position.unrealizedPnLGrowthX64 - int256(deltaX64);
        vm.expectEmit(true, true, true, true, address(util));
        emit IMarketLiquidityPosition.SettlementPointReached(IMarketDescriptor(address(1)), afterX64, 1 << 95);
        util.settleLiquidityUnrealizedPnL(IPriceFeed(address(priceFeed)), IMarketDescriptor(address(1)));

        position = util.globalLiquidityPosition();
        assertEq(position.previousSPPriceX96, 1 << 95);
        assertEq(position.unrealizedPnLGrowthX64, afterX64);
    }

    function test_settleLiquidityUnrealizedPnL_ForShortSide() public {
        util.setGlobalLiquidityPosition(
            IMarketLiquidityPosition.GlobalLiquidityPosition({
                netSize: 1e18,
                liquidationBufferNetSize: 9e18,
                previousSPPriceX96: 1 << 96,
                side: Side.wrap(2),
                liquidity: 1000e6,
                unrealizedPnLGrowthX64: 0
            })
        );

        // scenario: Short, price increase
        priceFeed.setMaxPriceX96(1 << 97);
        uint256 deltaX64 = Math.mulDivUp((1 << 97) - (1 << 96), 1e18 + 9e18, Constants.Q32 * 1000e6);
        vm.expectEmit(true, true, true, true, address(util));
        emit IMarketLiquidityPosition.SettlementPointReached(IMarketDescriptor(address(1)), -int256(deltaX64), 1 << 97);
        util.settleLiquidityUnrealizedPnL(IPriceFeed(address(priceFeed)), IMarketDescriptor(address(1)));

        IMarketManager.GlobalLiquidityPosition memory position = util.globalLiquidityPosition();
        assertEq(position.previousSPPriceX96, 1 << 97);
        assertEq(position.unrealizedPnLGrowthX64, -int256(deltaX64));

        // scenario: Short, price decrease
        priceFeed.setMaxPriceX96(1 << 96);
        deltaX64 = Math.mulDiv((1 << 97) - (1 << 96), 1e18 + 9e18, Constants.Q32 * 1000e6);
        int256 afterX64 = position.unrealizedPnLGrowthX64 + int256(deltaX64);
        vm.expectEmit(true, true, true, true, address(util));
        emit IMarketLiquidityPosition.SettlementPointReached(IMarketDescriptor(address(1)), afterX64, 1 << 96);
        util.settleLiquidityUnrealizedPnL(IPriceFeed(address(priceFeed)), IMarketDescriptor(address(1)));

        position = util.globalLiquidityPosition();
        assertEq(position.previousSPPriceX96, 1 << 96);
        assertEq(position.unrealizedPnLGrowthX64, afterX64);

        // scenario: Short, price decrease 2
        priceFeed.setMaxPriceX96(1 << 95);
        deltaX64 = Math.mulDiv((1 << 96) - (1 << 95), 1e18 + 9e18, Constants.Q32 * 1000e6);
        afterX64 = position.unrealizedPnLGrowthX64 + int256(deltaX64);
        vm.expectEmit(true, true, true, true, address(util));
        emit IMarketLiquidityPosition.SettlementPointReached(IMarketDescriptor(address(1)), afterX64, 1 << 95);
        util.settleLiquidityUnrealizedPnL(IPriceFeed(address(priceFeed)), IMarketDescriptor(address(1)));

        position = util.globalLiquidityPosition();
        assertEq(position.previousSPPriceX96, 1 << 95);
        assertEq(position.unrealizedPnLGrowthX64, afterX64);
    }

    function test_changePriceVertices() public {
        IConfigurable.MarketPriceConfig memory cfg = IConfigurable.MarketPriceConfig({
            maxPriceImpactLiquidity: 1000e6,
            liquidationVertexIndex: 0,
            vertices: [
                IConfigurable.VertexConfig({balanceRate: 0, premiumRate: 0}),
                IConfigurable.VertexConfig({balanceRate: 0.02 * 1e8, premiumRate: 0.0005 * 1e8}),
                IConfigurable.VertexConfig({balanceRate: 0.04 * 1e8, premiumRate: 0.0010 * 1e8}),
                IConfigurable.VertexConfig({balanceRate: 0.05 * 1e8, premiumRate: 0.0015 * 1e8}),
                IConfigurable.VertexConfig({balanceRate: 0.06 * 1e8, premiumRate: 0.0020 * 1e8}),
                IConfigurable.VertexConfig({balanceRate: 0.07 * 1e8, premiumRate: 0.0030 * 1e8}),
                IConfigurable.VertexConfig({balanceRate: 0.08 * 1e8, premiumRate: 0.0040 * 1e8}),
                IConfigurable.VertexConfig({balanceRate: 0.09 * 1e8, premiumRate: 0.0050 * 1e8}),
                IConfigurable.VertexConfig({balanceRate: 0.10 * 1e8, premiumRate: 0.0060 * 1e8}),
                IConfigurable.VertexConfig({balanceRate: 0.50 * 1e8, premiumRate: 0.1000 * 1e8})
            ]
        });
        util.setGlobalLiquidityPosition(
            IMarketLiquidityPosition.GlobalLiquidityPosition({
                netSize: 0,
                liquidationBufferNetSize: 0,
                previousSPPriceX96: 0,
                side: Side.wrap(1),
                liquidity: 2000e6,
                unrealizedPnLGrowthX64: 0
            })
        );

        uint160 indexPriceX96 = 146348677233098798; // 1.847179999999999985
        (uint128 size, uint128 premiumRateX96) = _calculatePriceVertex(
            IConfigurable.VertexConfig({balanceRate: 0.02 * 1e8, premiumRate: 0.0005 * 1e8}),
            1000e6,
            indexPriceX96
        );
        vm.expectEmit(true, true, true, true, address(util));
        emit IMarketManager.PriceVertexChanged(IMarketDescriptor(address(1)), 1, size, premiumRateX96);
        util.changePriceVertices(cfg, IMarketDescriptor(address(1)), indexPriceX96);
    }

    function _calculatePriceVertex(
        IConfigurable.VertexConfig memory _vertexCfg,
        uint128 _liquidity,
        uint160 _indexPriceX96
    ) private pure returns (uint128 size, uint128 premiumRateX96) {
        unchecked {
            uint256 balanceRateX96 = (Constants.Q96 * _vertexCfg.balanceRate) / Constants.BASIS_POINTS_DIVISOR;
            size = uint128(Math.mulDiv(balanceRateX96, _liquidity, _indexPriceX96));

            premiumRateX96 = uint128((Constants.Q96 * _vertexCfg.premiumRate) / Constants.BASIS_POINTS_DIVISOR);
        }
    }
}
