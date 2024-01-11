// SPDX-License-Identifier: UNLICENSED
pragma solidity =0.8.23;

import "forge-std/Test.sol";
import "forge-std/mocks/MockERC20.sol";
import "../../contracts/test/MockConfigurable.sol";

contract ConfigurableTest is Test {
    MockConfigurable public configurable;

    function setUp() public {
        MockERC20 usd = StdUtils.deployMockERC20("USD", "USD", 6);
        configurable = new MockConfigurable(IERC20(address(usd)));
    }

    function test_enableMarket() public {
        configurable.enableMarket(IMarketDescriptor(address(1)), _buildDefaultMarketConfig());
        assertEq(configurable.afterMarketEnabledCalled(), true);
        assertEq(configurable.isEnabledMarket(IMarketDescriptor(address(1))), true);
    }

    function test_enableMarket_RevertIf_MarketAlreadyEnabled() public {
        configurable.enableMarket(IMarketDescriptor(address(1)), _buildDefaultMarketConfig());
        vm.expectRevert(abi.encodeWithSelector(IConfigurable.MarketAlreadyEnabled.selector, address(1)));
        configurable.enableMarket(IMarketDescriptor(address(1)), _buildDefaultMarketConfig());
    }

    function testFuzz_enableMarket_RevertIf_CallerNotGov(
        address caller,
        IConfigurable.MarketConfig calldata cfg
    ) public {
        vm.assume(caller != configurable.gov());
        vm.prank(caller);
        vm.expectRevert(Governable.Forbidden.selector);
        configurable.enableMarket(IMarketDescriptor(address(1)), cfg);
    }

    function test_updateMarketBaseConfig_RevertIf_MarketNotEnabled() public {
        vm.expectRevert(abi.encodeWithSelector(IConfigurable.MarketNotEnabled.selector, address(1)));
        configurable.updateMarketBaseConfig(IMarketDescriptor(address(1)), _buildDefaultMarketConfig().baseConfig);
    }

    function test_updateMarketBaseConfig() public {
        IConfigurable.MarketConfig memory cfg = _buildDefaultMarketConfig();
        configurable.enableMarket(IMarketDescriptor(address(1)), cfg);
        cfg.baseConfig.maxPositionLiquidity = 1e11 * 1e18;
        configurable.updateMarketBaseConfig(IMarketDescriptor(address(1)), cfg.baseConfig);
        assertEq(configurable.afterMarketBaseConfigChangedCalled(), true);
    }

    function test_updateMarketBaseConfig_NotCallbackIf_NoChange() public {
        IConfigurable.MarketConfig memory cfg = _buildDefaultMarketConfig();
        configurable.enableMarket(IMarketDescriptor(address(1)), cfg);
        configurable.updateMarketBaseConfig(IMarketDescriptor(address(1)), cfg.baseConfig);
        assertEq(configurable.afterMarketBaseConfigChangedCalled(), false);
    }

    function testFuzz_updateMarketBaseConfig_RevertIf_CallerNotGov(
        address caller,
        IConfigurable.MarketBaseConfig calldata cfg
    ) public {
        vm.assume(caller != configurable.gov());
        vm.prank(caller);
        vm.expectRevert(Governable.Forbidden.selector);
        configurable.updateMarketBaseConfig(IMarketDescriptor(address(1)), cfg);
    }

    function test_updateMarketFeeRateConfig_RevertIf_MarketNotEnabled() public {
        vm.expectRevert(abi.encodeWithSelector(IConfigurable.MarketNotEnabled.selector, address(1)));
        configurable.updateMarketFeeRateConfig(
            IMarketDescriptor(address(1)),
            _buildDefaultMarketConfig().feeRateConfig
        );
    }

    function testFuzz_updateMarketFeeRateConfig_RevertIf_CallerNotGov(
        address caller,
        IConfigurable.MarketFeeRateConfig calldata cfg
    ) public {
        vm.assume(caller != configurable.gov());
        vm.prank(caller);
        vm.expectRevert(Governable.Forbidden.selector);
        configurable.updateMarketFeeRateConfig(IMarketDescriptor(address(1)), cfg);
    }

    function test_updateMarketPriceConfig_RevertIf_MarketNotEnabled() public {
        vm.expectRevert(abi.encodeWithSelector(IConfigurable.MarketNotEnabled.selector, address(1)));
        configurable.updateMarketPriceConfig(IMarketDescriptor(address(1)), _buildDefaultMarketConfig().priceConfig);
    }

    function test_updateMarketPriceConfig() public {
        IConfigurable.MarketConfig memory cfg = _buildDefaultMarketConfig();
        configurable.enableMarket(IMarketDescriptor(address(1)), cfg);
        cfg.priceConfig.maxPriceImpactLiquidity = 1e11 * 1e18;
        configurable.updateMarketPriceConfig(IMarketDescriptor(address(1)), cfg.priceConfig);
        assertEq(configurable.afterMarketPriceConfigChangedCalled(), true);
    }

    function testFuzz_updateMarketPriceConfig_RevertIf_CallerNotGov(
        address caller,
        IConfigurable.MarketPriceConfig calldata cfg
    ) public {
        vm.assume(caller != configurable.gov());
        vm.prank(caller);
        vm.expectRevert(Governable.Forbidden.selector);
        configurable.updateMarketPriceConfig(IMarketDescriptor(address(1)), cfg);
    }

    function _buildDefaultMarketConfig() private pure returns (IConfigurable.MarketConfig memory) {
        return
            IConfigurable.MarketConfig({
                baseConfig: IConfigurable.MarketBaseConfig({
                    minMarginPerLiquidityPosition: 10 * 1e6,
                    maxLeveragePerLiquidityPosition: 200,
                    liquidationFeeRatePerLiquidityPosition: 0.99 * 1e8,
                    minMarginPerPosition: 10 * 1e6,
                    maxLeveragePerPosition: 200,
                    liquidationFeeRatePerPosition: 0.98 * 1e8,
                    maxPositionLiquidity: 1e10 * 1e18,
                    maxPositionValueRate: 1.0 * 1e8,
                    maxSizeRatePerPosition: 0.5 * 1e8,
                    liquidationExecutionFee: 0.5 * 1e6,
                    interestRate: 0.00125 * 1e8,
                    maxFundingRate: 0.05 * 1e8
                }),
                feeRateConfig: IConfigurable.MarketFeeRateConfig({
                    tradingFeeRate: 0.0005 * 1e8,
                    protocolFeeRate: 0.4 * 1e8,
                    referralReturnFeeRate: 0.1 * 1e8,
                    referralParentReturnFeeRate: 0.01 * 1e8,
                    referralDiscountRate: 0.9 * 1e8
                }),
                priceConfig: IConfigurable.MarketPriceConfig({
                    maxPriceImpactLiquidity: 1e10 * 1e18,
                    liquidationVertexIndex: 7,
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
                })
            });
    }
}
