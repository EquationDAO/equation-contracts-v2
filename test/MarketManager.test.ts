import {ethers} from "hardhat";
import {ERC20Test} from "../typechain-types";
import {
    BASIS_POINTS_DIVISOR,
    DECIMALS_18,
    DECIMALS_6,
    LATEST_VERTEX,
    SIDE_LONG,
    SIDE_SHORT,
    toPriceX96,
    VERTEX_NUM,
} from "./shared/Constants";
import {MarketDescriptor} from "../typechain-types";
import {
    newMarketBaseConfig,
    newMarketConfig,
    newMarketFeeRateConfig,
    newMarketPriceConfig,
} from "./shared/MarketConfig";
import {loadFixture, time} from "@nomicfoundation/hardhat-network-helpers";
import {expect} from "chai";
import {BigNumberish, toBigInt} from "ethers";

describe("MarketManager", () => {
    async function deployFixture() {
        const [owner, account, other, other2] = await ethers.getSigners();
        const router = owner;
        const gov = owner;

        const USDT = (await ethers.deployContract("ERC20Test", [
            "USDC",
            "USDC",
            6,
            100_000_000n * 10n ** 18n,
        ])) as ERC20Test;
        await USDT.waitForDeployment();
        await USDT.mint(account.address, 100n * 10n ** 18n);

        const mockFeeDistributor = await ethers.deployContract("MockFeeDistributor");
        await mockFeeDistributor.waitForDeployment();

        const mockEFC = await ethers.deployContract("MockEFC");
        await mockEFC.waitForDeployment();

        const mockPriceFeed = await ethers.deployContract("MockPriceFeed");
        await mockPriceFeed.waitForDeployment();

        const MarketDescriptorDeployer = await ethers.deployContract("MarketDescriptorDeployer");
        await MarketDescriptorDeployer.waitForDeployment();
        await MarketDescriptorDeployer.deploy("ETH");
        const ETHMarketDescriptorAddr = await MarketDescriptorDeployer.descriptors("ETH");
        const MarketDescriptor = await ethers.getContractFactory("MarketDescriptor");
        const ETHMarketDescriptor = MarketDescriptor.attach(ETHMarketDescriptorAddr) as MarketDescriptor;
        await MarketDescriptorDeployer.deploy("EQU");
        const EQUMarketDescriptorAddr = await MarketDescriptorDeployer.descriptors("EQU");
        const EQUMarketDescriptor = MarketDescriptor.attach(EQUMarketDescriptorAddr) as MarketDescriptor;
        await mockPriceFeed.setMinPriceX96(toPriceX96("1808.234", DECIMALS_18, DECIMALS_6));
        await mockPriceFeed.setMaxPriceX96(toPriceX96("1808.235", DECIMALS_18, DECIMALS_6));

        const _marketUtil = await ethers.deployContract("MarketUtil");
        await _marketUtil.waitForDeployment();
        const _positionUtil = await ethers.deployContract("PositionUtil");
        await _positionUtil.waitForDeployment();
        const _liquidityPositionUtil = await ethers.deployContract("LiquidityPositionUtil");
        await _liquidityPositionUtil.waitForDeployment();
        const _configurableUtil = await ethers.deployContract("ConfigurableUtil");
        await _configurableUtil.waitForDeployment();
        const _fundingRateUtil = await ethers.deployContract("FundingRateUtil");
        await _fundingRateUtil.waitForDeployment();
        const _priceUtil = await ethers.deployContract("PriceUtil");
        await _priceUtil.waitForDeployment();

        const marketManager = await ethers.deployContract(
            "MarketManager",
            [USDT.target, router.address, mockFeeDistributor.target, mockEFC.target],
            {
                libraries: {
                    ConfigurableUtil: _configurableUtil.target,
                    FundingRateUtil: _fundingRateUtil.target,
                    LiquidityPositionUtil: _liquidityPositionUtil.target,
                    MarketUtil: _marketUtil.target,
                    PositionUtil: _positionUtil.target,
                },
            },
        );
        await marketManager.waitForDeployment();
        await marketManager.setPriceFeed(mockPriceFeed.target);
        const marketCfg = newMarketConfig();
        await marketManager.enableMarket(ETHMarketDescriptor.target, marketCfg);

        return {
            owner,
            gov,
            router,
            account,
            other,
            other2,
            USDT,
            mockFeeDistributor,
            mockEFC,
            mockPriceFeed,
            MarketDescriptorDeployer,
            ETHMarketDescriptor,
            EQUMarketDescriptor,
            marketManager,
            marketCfg,
            _marketUtil,
            _positionUtil,
            _liquidityPositionUtil,
            _configurableUtil,
            _fundingRateUtil,
        };
    }

    describe("Configurable", () => {
        describe("#USD", () => {
            it("should return right IERC20 of the USD", async () => {
                const {marketManager, USDT} = await loadFixture(deployFixture);
                expect(await marketManager.USD()).to.eq(USDT.target);
            });
        });

        describe("#marketBaseConfigs", () => {
            it("should return right base config if the market enabled", async () => {
                const {marketManager, ETHMarketDescriptor, marketCfg} = await loadFixture(deployFixture);
                const marketBaseCfg = await marketManager.marketBaseConfigs(ETHMarketDescriptor.target);
                expect(marketBaseCfg.minMarginPerLiquidityPosition).to.eq(
                    marketCfg.baseConfig.minMarginPerLiquidityPosition,
                );
                expect(marketBaseCfg.maxLeveragePerLiquidityPosition).to.eq(
                    marketCfg.baseConfig.maxLeveragePerLiquidityPosition,
                );
                expect(marketBaseCfg.liquidationFeeRatePerLiquidityPosition).to.eq(
                    marketCfg.baseConfig.liquidationFeeRatePerLiquidityPosition,
                );
                expect(marketBaseCfg.minMarginPerPosition).to.eq(marketCfg.baseConfig.minMarginPerPosition);
                expect(marketBaseCfg.maxLeveragePerPosition).to.eq(marketCfg.baseConfig.maxLeveragePerPosition);
                expect(marketBaseCfg.liquidationFeeRatePerPosition).to.eq(
                    marketCfg.baseConfig.liquidationFeeRatePerPosition,
                );
                expect(marketBaseCfg.maxPositionLiquidity).to.eq(marketCfg.baseConfig.maxPositionLiquidity);
                expect(marketBaseCfg.maxPositionValueRate).to.eq(marketCfg.baseConfig.maxPositionValueRate);
                expect(marketBaseCfg.maxSizeRatePerPosition).to.eq(marketCfg.baseConfig.maxSizeRatePerPosition);
                expect(marketBaseCfg.interestRate).to.eq(marketCfg.baseConfig.interestRate);
                expect(marketBaseCfg.maxFundingRate).to.eq(marketCfg.baseConfig.maxFundingRate);
                expect(marketBaseCfg.liquidationExecutionFee).to.eq(marketCfg.baseConfig.liquidationExecutionFee);
            });

            it("should return empty base config if the market does not enabled yet", async () => {
                const {marketManager, EQUMarketDescriptor} = await loadFixture(deployFixture);
                const marketBaseCfg = await marketManager.marketBaseConfigs(EQUMarketDescriptor.target);
                expect(marketBaseCfg.minMarginPerLiquidityPosition).to.eq(0n);
                expect(marketBaseCfg.maxLeveragePerLiquidityPosition).to.eq(0n);
                expect(marketBaseCfg.liquidationFeeRatePerLiquidityPosition).to.eq(0n);
                expect(marketBaseCfg.minMarginPerPosition).to.eq(0n);
                expect(marketBaseCfg.maxLeveragePerPosition).to.eq(0n);
                expect(marketBaseCfg.liquidationFeeRatePerPosition).to.eq(0n);
                expect(marketBaseCfg.maxPositionLiquidity).to.eq(0n);
                expect(marketBaseCfg.maxPositionValueRate).to.eq(0n);
                expect(marketBaseCfg.maxSizeRatePerPosition).to.eq(0n);
                expect(marketBaseCfg.interestRate).to.eq(0n);
                expect(marketBaseCfg.maxFundingRate).to.eq(0n);
                expect(marketBaseCfg.liquidationExecutionFee).to.eq(0n);
            });
        });

        describe("#marketFeeRateConfigs", () => {
            it("should return right fee rate config if the market enabled", async () => {
                const {marketManager, ETHMarketDescriptor, marketCfg} = await loadFixture(deployFixture);
                const marketFeeRateCfg = await marketManager.marketFeeRateConfigs(ETHMarketDescriptor.target);
                expect(marketFeeRateCfg.tradingFeeRate).to.eq(marketCfg.feeRateConfig.tradingFeeRate);
                expect(marketFeeRateCfg.protocolFeeRate).to.eq(marketCfg.feeRateConfig.protocolFeeRate);
                expect(marketFeeRateCfg.referralReturnFeeRate).to.eq(marketCfg.feeRateConfig.referralReturnFeeRate);
                expect(marketFeeRateCfg.referralParentReturnFeeRate).to.eq(
                    marketCfg.feeRateConfig.referralParentReturnFeeRate,
                );
                expect(marketFeeRateCfg.referralDiscountRate).to.eq(marketCfg.feeRateConfig.referralDiscountRate);
            });

            it("should return empty fee rate config if the market does not enabled yet", async () => {
                const {marketManager, EQUMarketDescriptor} = await loadFixture(deployFixture);
                const marketFeeRateCfg = await marketManager.marketFeeRateConfigs(EQUMarketDescriptor.target);
                expect(marketFeeRateCfg.tradingFeeRate).to.eq(0n);
                expect(marketFeeRateCfg.protocolFeeRate).to.eq(0n);
                expect(marketFeeRateCfg.referralReturnFeeRate).to.eq(0n);
                expect(marketFeeRateCfg.referralParentReturnFeeRate).to.eq(0n);
                expect(marketFeeRateCfg.referralDiscountRate).to.eq(0n);
            });
        });

        describe("#isEnabledMarket", () => {
            it("should return true if the market enabled", async () => {
                const {marketManager, ETHMarketDescriptor} = await loadFixture(deployFixture);
                expect(await marketManager.isEnabledMarket(ETHMarketDescriptor.target)).to.be.true;
            });

            it("should return false if the market does not enabled yet", async () => {
                const {marketManager, EQUMarketDescriptor} = await loadFixture(deployFixture);
                expect(await marketManager.isEnabledMarket(EQUMarketDescriptor.target)).to.be.false;
            });
        });

        describe("#marketPriceConfigs", () => {
            it("should return right price configs if the market enabled", async () => {
                const {marketManager, ETHMarketDescriptor, marketCfg} = await loadFixture(deployFixture);
                const marketPriceCfg = await marketManager.marketPriceConfigs(ETHMarketDescriptor.target);
                expect(marketPriceCfg.maxPriceImpactLiquidity).to.eq(marketCfg.priceConfig.maxPriceImpactLiquidity);
                expect(marketPriceCfg.liquidationVertexIndex).to.eq(marketCfg.priceConfig.liquidationVertexIndex);
                expect(marketPriceCfg.vertices.length).to.eq(10n);
                expect(marketPriceCfg.vertices[0].balanceRate).to.eq(marketCfg.priceConfig.vertices[0].balanceRate);
                expect(marketPriceCfg.vertices[0].premiumRate).to.eq(marketCfg.priceConfig.vertices[0].premiumRate);
                expect(marketPriceCfg.vertices[1].balanceRate).to.eq(marketCfg.priceConfig.vertices[1].balanceRate);
                expect(marketPriceCfg.vertices[1].premiumRate).to.eq(marketCfg.priceConfig.vertices[1].premiumRate);
                expect(marketPriceCfg.vertices[2].balanceRate).to.eq(marketCfg.priceConfig.vertices[2].balanceRate);
                expect(marketPriceCfg.vertices[2].premiumRate).to.eq(marketCfg.priceConfig.vertices[2].premiumRate);
                expect(marketPriceCfg.vertices[3].balanceRate).to.eq(marketCfg.priceConfig.vertices[3].balanceRate);
                expect(marketPriceCfg.vertices[3].premiumRate).to.eq(marketCfg.priceConfig.vertices[3].premiumRate);
                expect(marketPriceCfg.vertices[4].balanceRate).to.eq(marketCfg.priceConfig.vertices[4].balanceRate);
                expect(marketPriceCfg.vertices[4].premiumRate).to.eq(marketCfg.priceConfig.vertices[4].premiumRate);
                expect(marketPriceCfg.vertices[5].balanceRate).to.eq(marketCfg.priceConfig.vertices[5].balanceRate);
                expect(marketPriceCfg.vertices[5].premiumRate).to.eq(marketCfg.priceConfig.vertices[5].premiumRate);
                expect(marketPriceCfg.vertices[6].balanceRate).to.eq(marketCfg.priceConfig.vertices[6].balanceRate);
                expect(marketPriceCfg.vertices[6].premiumRate).to.eq(marketCfg.priceConfig.vertices[6].premiumRate);
                expect(marketPriceCfg.vertices[7].balanceRate).to.eq(marketCfg.priceConfig.vertices[7].balanceRate);
                expect(marketPriceCfg.vertices[7].premiumRate).to.eq(marketCfg.priceConfig.vertices[7].premiumRate);
                expect(marketPriceCfg.vertices[8].balanceRate).to.eq(marketCfg.priceConfig.vertices[8].balanceRate);
                expect(marketPriceCfg.vertices[8].premiumRate).to.eq(marketCfg.priceConfig.vertices[8].premiumRate);
                expect(marketPriceCfg.vertices[9].balanceRate).to.eq(marketCfg.priceConfig.vertices[9].balanceRate);
                expect(marketPriceCfg.vertices[9].premiumRate).to.eq(marketCfg.priceConfig.vertices[9].premiumRate);
            });

            it("should return empty price configs if the market does not enabled yet", async () => {
                const {marketManager, EQUMarketDescriptor} = await loadFixture(deployFixture);
                const marketPriceCfg = await marketManager.marketPriceConfigs(EQUMarketDescriptor.target);
                expect(marketPriceCfg.maxPriceImpactLiquidity).to.eq(0n);
                expect(marketPriceCfg.liquidationVertexIndex).to.eq(0n);
                expect(marketPriceCfg.vertices.length).to.eq(10n);
                expect(marketPriceCfg.vertices[0].balanceRate).to.eq(0n);
                expect(marketPriceCfg.vertices[0].premiumRate).to.eq(0n);
                expect(marketPriceCfg.vertices[1].balanceRate).to.eq(0n);
                expect(marketPriceCfg.vertices[1].premiumRate).to.eq(0n);
                expect(marketPriceCfg.vertices[2].balanceRate).to.eq(0n);
                expect(marketPriceCfg.vertices[2].premiumRate).to.eq(0n);
                expect(marketPriceCfg.vertices[3].balanceRate).to.eq(0n);
                expect(marketPriceCfg.vertices[3].premiumRate).to.eq(0n);
                expect(marketPriceCfg.vertices[4].balanceRate).to.eq(0n);
                expect(marketPriceCfg.vertices[4].premiumRate).to.eq(0n);
                expect(marketPriceCfg.vertices[5].balanceRate).to.eq(0n);
                expect(marketPriceCfg.vertices[5].premiumRate).to.eq(0n);
                expect(marketPriceCfg.vertices[6].balanceRate).to.eq(0n);
                expect(marketPriceCfg.vertices[6].premiumRate).to.eq(0n);
                expect(marketPriceCfg.vertices[7].balanceRate).to.eq(0n);
                expect(marketPriceCfg.vertices[7].premiumRate).to.eq(0n);
                expect(marketPriceCfg.vertices[8].balanceRate).to.eq(0n);
                expect(marketPriceCfg.vertices[8].premiumRate).to.eq(0n);
                expect(marketPriceCfg.vertices[9].balanceRate).to.eq(0n);
                expect(marketPriceCfg.vertices[9].premiumRate).to.eq(0n);
            });
        });

        describe("#marketPriceVertexConfigs", () => {
            it("should return right price vertex config if the market enabled", async () => {
                const {marketManager, ETHMarketDescriptor, marketCfg} = await loadFixture(deployFixture);
                const priceVertexCfg_0 = await marketManager.marketPriceVertexConfigs(ETHMarketDescriptor.target, 0);
                expect(priceVertexCfg_0.balanceRate).to.eq(marketCfg.priceConfig.vertices[0].balanceRate);
                expect(priceVertexCfg_0.premiumRate).to.eq(marketCfg.priceConfig.vertices[0].premiumRate);
                const priceVertexCfg_1 = await marketManager.marketPriceVertexConfigs(ETHMarketDescriptor.target, 1);
                expect(priceVertexCfg_1.balanceRate).to.eq(marketCfg.priceConfig.vertices[1].balanceRate);
                expect(priceVertexCfg_1.premiumRate).to.eq(marketCfg.priceConfig.vertices[1].premiumRate);
                const priceVertexCfg_2 = await marketManager.marketPriceVertexConfigs(ETHMarketDescriptor.target, 2);
                expect(priceVertexCfg_2.balanceRate).to.eq(marketCfg.priceConfig.vertices[2].balanceRate);
                expect(priceVertexCfg_2.premiumRate).to.eq(marketCfg.priceConfig.vertices[2].premiumRate);
                const priceVertexCfg_3 = await marketManager.marketPriceVertexConfigs(ETHMarketDescriptor.target, 3);
                expect(priceVertexCfg_3.balanceRate).to.eq(marketCfg.priceConfig.vertices[3].balanceRate);
                expect(priceVertexCfg_3.premiumRate).to.eq(marketCfg.priceConfig.vertices[3].premiumRate);
                const priceVertexCfg_4 = await marketManager.marketPriceVertexConfigs(ETHMarketDescriptor.target, 4);
                expect(priceVertexCfg_4.balanceRate).to.eq(marketCfg.priceConfig.vertices[4].balanceRate);
                expect(priceVertexCfg_4.premiumRate).to.eq(marketCfg.priceConfig.vertices[4].premiumRate);
                const priceVertexCfg_5 = await marketManager.marketPriceVertexConfigs(ETHMarketDescriptor.target, 5);
                expect(priceVertexCfg_5.balanceRate).to.eq(marketCfg.priceConfig.vertices[5].balanceRate);
                expect(priceVertexCfg_5.premiumRate).to.eq(marketCfg.priceConfig.vertices[5].premiumRate);
                const priceVertexCfg_6 = await marketManager.marketPriceVertexConfigs(ETHMarketDescriptor.target, 6);
                expect(priceVertexCfg_6.balanceRate).to.eq(marketCfg.priceConfig.vertices[6].balanceRate);
                expect(priceVertexCfg_6.premiumRate).to.eq(marketCfg.priceConfig.vertices[6].premiumRate);
                const priceVertexCfg_7 = await marketManager.marketPriceVertexConfigs(ETHMarketDescriptor.target, 7);
                expect(priceVertexCfg_7.balanceRate).to.eq(marketCfg.priceConfig.vertices[7].balanceRate);
                expect(priceVertexCfg_7.premiumRate).to.eq(marketCfg.priceConfig.vertices[7].premiumRate);
                const priceVertexCfg_8 = await marketManager.marketPriceVertexConfigs(ETHMarketDescriptor.target, 8);
                expect(priceVertexCfg_8.balanceRate).to.eq(marketCfg.priceConfig.vertices[8].balanceRate);
                expect(priceVertexCfg_8.premiumRate).to.eq(marketCfg.priceConfig.vertices[8].premiumRate);
                const priceVertexCfg_9 = await marketManager.marketPriceVertexConfigs(ETHMarketDescriptor.target, 9);
                expect(priceVertexCfg_9.balanceRate).to.eq(marketCfg.priceConfig.vertices[9].balanceRate);
                expect(priceVertexCfg_9.premiumRate).to.eq(marketCfg.priceConfig.vertices[9].premiumRate);
            });

            it("should return empty price vertex config if the market does not enabled yet", async () => {
                const {marketManager, EQUMarketDescriptor} = await loadFixture(deployFixture);
                const priceVertexCfg_0 = await marketManager.marketPriceVertexConfigs(EQUMarketDescriptor.target, 0);
                expect(priceVertexCfg_0.balanceRate).to.eq(0n);
                expect(priceVertexCfg_0.premiumRate).to.eq(0n);
                const priceVertexCfg_1 = await marketManager.marketPriceVertexConfigs(EQUMarketDescriptor.target, 1);
                expect(priceVertexCfg_1.balanceRate).to.eq(0n);
                expect(priceVertexCfg_1.premiumRate).to.eq(0n);
                const priceVertexCfg_2 = await marketManager.marketPriceVertexConfigs(EQUMarketDescriptor.target, 2);
                expect(priceVertexCfg_2.balanceRate).to.eq(0n);
                expect(priceVertexCfg_2.premiumRate).to.eq(0n);
                const priceVertexCfg_3 = await marketManager.marketPriceVertexConfigs(EQUMarketDescriptor.target, 3);
                expect(priceVertexCfg_3.balanceRate).to.eq(0n);
                expect(priceVertexCfg_3.premiumRate).to.eq(0n);
                const priceVertexCfg_4 = await marketManager.marketPriceVertexConfigs(EQUMarketDescriptor.target, 4);
                expect(priceVertexCfg_4.balanceRate).to.eq(0n);
                expect(priceVertexCfg_4.premiumRate).to.eq(0n);
                const priceVertexCfg_5 = await marketManager.marketPriceVertexConfigs(EQUMarketDescriptor.target, 5);
                expect(priceVertexCfg_5.balanceRate).to.eq(0n);
                expect(priceVertexCfg_5.premiumRate).to.eq(0n);
                const priceVertexCfg_6 = await marketManager.marketPriceVertexConfigs(EQUMarketDescriptor.target, 6);
                expect(priceVertexCfg_6.balanceRate).to.eq(0n);
                expect(priceVertexCfg_6.premiumRate).to.eq(0n);
                const priceVertexCfg_7 = await marketManager.marketPriceVertexConfigs(EQUMarketDescriptor.target, 7);
                expect(priceVertexCfg_7.balanceRate).to.eq(0n);
                expect(priceVertexCfg_7.premiumRate).to.eq(0n);
                const priceVertexCfg_8 = await marketManager.marketPriceVertexConfigs(EQUMarketDescriptor.target, 8);
                expect(priceVertexCfg_8.balanceRate).to.eq(0n);
                expect(priceVertexCfg_8.premiumRate).to.eq(0n);
                const priceVertexCfg_9 = await marketManager.marketPriceVertexConfigs(EQUMarketDescriptor.target, 9);
                expect(priceVertexCfg_9.balanceRate).to.eq(0n);
                expect(priceVertexCfg_9.premiumRate).to.eq(0n);
            });
        });

        describe("#enableMarket", () => {
            it("should revert if caller is not the gov", async () => {
                const {marketManager, EQUMarketDescriptor, marketCfg, other} = await loadFixture(deployFixture);
                await expect(
                    marketManager.connect(other).enableMarket(EQUMarketDescriptor.target, marketCfg),
                ).to.revertedWithCustomError(marketManager, "Forbidden");
            });

            it("should revert if the market has already enabled", async () => {
                const {marketManager, ETHMarketDescriptor, marketCfg} = await loadFixture(deployFixture);
                await expect(marketManager.enableMarket(ETHMarketDescriptor.target, marketCfg))
                    .to.revertedWithCustomError(marketManager, "MarketAlreadyEnabled")
                    .withArgs(ETHMarketDescriptor.target);
            });

            describe("validate base config", () => {
                it("should revert if max leverage per liquidity position is zero", async () => {
                    const {marketManager, EQUMarketDescriptor} = await loadFixture(deployFixture);
                    let marketCfg = newMarketConfig();
                    marketCfg.baseConfig.maxLeveragePerLiquidityPosition = 0n;
                    await expect(marketManager.enableMarket(EQUMarketDescriptor.target, marketCfg))
                        .to.revertedWithCustomError(marketManager, "InvalidMaxLeveragePerLiquidityPosition")
                        .withArgs(0n);
                });

                it("should revert if liquidation fee rate per liquidity position is greater than 100_000_000", async () => {
                    const {marketManager, EQUMarketDescriptor} = await loadFixture(deployFixture);
                    let marketCfg = newMarketConfig();
                    marketCfg.baseConfig.liquidationFeeRatePerLiquidityPosition = BASIS_POINTS_DIVISOR + 1n;
                    await expect(marketManager.enableMarket(EQUMarketDescriptor.target, marketCfg))
                        .to.revertedWithCustomError(marketManager, "InvalidLiquidationFeeRatePerLiquidityPosition")
                        .withArgs(BASIS_POINTS_DIVISOR + 1n);
                });

                it("should revert if max leverage per position is zero", async () => {
                    const {marketManager, EQUMarketDescriptor} = await loadFixture(deployFixture);
                    let marketCfg = newMarketConfig();
                    marketCfg.baseConfig.maxLeveragePerPosition = 0n;
                    await expect(marketManager.enableMarket(EQUMarketDescriptor.target, marketCfg))
                        .to.revertedWithCustomError(marketManager, "InvalidMaxLeveragePerPosition")
                        .withArgs(0n);
                });

                it("should revert if liquidation fee rate per position is greater than 100_000_000", async () => {
                    const {marketManager, EQUMarketDescriptor} = await loadFixture(deployFixture);
                    let marketCfg = newMarketConfig();
                    marketCfg.baseConfig.liquidationFeeRatePerPosition = BASIS_POINTS_DIVISOR + 1n;
                    await expect(marketManager.enableMarket(EQUMarketDescriptor.target, marketCfg))
                        .to.revertedWithCustomError(marketManager, "InvalidLiquidationFeeRatePerPosition")
                        .withArgs(BASIS_POINTS_DIVISOR + 1n);
                });

                it("should revert if max position liquidity is zero", async () => {
                    const {marketManager, EQUMarketDescriptor} = await loadFixture(deployFixture);
                    let marketCfg = newMarketConfig();
                    marketCfg.baseConfig.maxPositionLiquidity = 0n;
                    await expect(marketManager.enableMarket(EQUMarketDescriptor.target, marketCfg))
                        .to.revertedWithCustomError(marketManager, "InvalidMaxPositionLiquidity")
                        .withArgs(0n);
                });

                it("should revert if max position value rate is zero", async () => {
                    const {marketManager, EQUMarketDescriptor} = await loadFixture(deployFixture);
                    let marketCfg = newMarketConfig();
                    marketCfg.baseConfig.maxPositionValueRate = 0n;
                    await expect(marketManager.enableMarket(EQUMarketDescriptor.target, marketCfg))
                        .to.revertedWithCustomError(marketManager, "InvalidMaxPositionValueRate")
                        .withArgs(0n);
                });

                it("should revert if max size rate per position is greater than 100_000_000", async () => {
                    const {marketManager, EQUMarketDescriptor} = await loadFixture(deployFixture);
                    let marketCfg = newMarketConfig();
                    marketCfg.baseConfig.maxSizeRatePerPosition = BASIS_POINTS_DIVISOR + 1n;
                    await expect(marketManager.enableMarket(EQUMarketDescriptor.target, marketCfg))
                        .to.revertedWithCustomError(marketManager, "InvalidMaxSizeRatePerPosition")
                        .withArgs(BASIS_POINTS_DIVISOR + 1n);
                });

                it("should revert if interest rate is greater than 100_000_000", async () => {
                    const {marketManager, EQUMarketDescriptor} = await loadFixture(deployFixture);
                    let marketCfg = newMarketConfig();
                    marketCfg.baseConfig.interestRate = BASIS_POINTS_DIVISOR + 1n;
                    await expect(marketManager.enableMarket(EQUMarketDescriptor.target, marketCfg))
                        .to.revertedWithCustomError(marketManager, "InvalidInterestRate")
                        .withArgs(BASIS_POINTS_DIVISOR + 1n);
                });

                it("should revert if max funding rate is greater than 100_000_000", async () => {
                    const {marketManager, EQUMarketDescriptor} = await loadFixture(deployFixture);
                    let marketCfg = newMarketConfig();
                    marketCfg.baseConfig.maxFundingRate = BASIS_POINTS_DIVISOR + 1n;
                    await expect(marketManager.enableMarket(EQUMarketDescriptor.target, marketCfg))
                        .to.revertedWithCustomError(marketManager, "InvalidMaxFundingRate")
                        .withArgs(BASIS_POINTS_DIVISOR + 1n);
                });
            });

            describe("validate fee rate config", () => {
                it("should revert if trading fee rate is greater than 100_000_000", async () => {
                    const {marketManager, EQUMarketDescriptor} = await loadFixture(deployFixture);
                    let marketCfg = newMarketConfig();
                    marketCfg.feeRateConfig.tradingFeeRate = BASIS_POINTS_DIVISOR + 1n;
                    await expect(marketManager.enableMarket(EQUMarketDescriptor.target, marketCfg))
                        .to.revertedWithCustomError(marketManager, "InvalidTradingFeeRate")
                        .withArgs(BASIS_POINTS_DIVISOR + 1n);
                });

                it("should revert if protocol fee rate is greater than 100_000_000", async () => {
                    const {marketManager, EQUMarketDescriptor} = await loadFixture(deployFixture);
                    let marketCfg = newMarketConfig();
                    marketCfg.feeRateConfig.protocolFeeRate = BASIS_POINTS_DIVISOR + 1n;
                    await expect(marketManager.enableMarket(EQUMarketDescriptor.target, marketCfg))
                        .to.revertedWithCustomError(marketManager, "InvalidProtocolFeeRate")
                        .withArgs(BASIS_POINTS_DIVISOR + 1n);
                });

                it("should revert if referral return fee rate is greater than 100_000_000", async () => {
                    const {marketManager, EQUMarketDescriptor} = await loadFixture(deployFixture);
                    let marketCfg = newMarketConfig();
                    marketCfg.feeRateConfig.referralReturnFeeRate = BASIS_POINTS_DIVISOR + 1n;
                    await expect(marketManager.enableMarket(EQUMarketDescriptor.target, marketCfg))
                        .to.revertedWithCustomError(marketManager, "InvalidReferralReturnFeeRate")
                        .withArgs(BASIS_POINTS_DIVISOR + 1n);
                });

                it("should revert if referral parent return fee rate is greater than 100_000_000", async () => {
                    const {marketManager, EQUMarketDescriptor} = await loadFixture(deployFixture);
                    let marketCfg = newMarketConfig();
                    marketCfg.feeRateConfig.referralParentReturnFeeRate = BASIS_POINTS_DIVISOR + 1n;
                    await expect(marketManager.enableMarket(EQUMarketDescriptor.target, marketCfg))
                        .to.revertedWithCustomError(marketManager, "InvalidReferralParentReturnFeeRate")
                        .withArgs(BASIS_POINTS_DIVISOR + 1n);
                });

                it("should revert if referral discount fee rate is greater than 100_000_000", async () => {
                    const {marketManager, EQUMarketDescriptor} = await loadFixture(deployFixture);
                    let marketCfg = newMarketConfig();
                    marketCfg.feeRateConfig.referralDiscountRate = BASIS_POINTS_DIVISOR + 1n;
                    await expect(marketManager.enableMarket(EQUMarketDescriptor.target, marketCfg))
                        .to.revertedWithCustomError(marketManager, "InvalidReferralDiscountRate")
                        .withArgs(BASIS_POINTS_DIVISOR + 1n);
                });

                it("should revert if the sum of liquidity fee rate and protocol fee rate and referral return fee rate and referral parent return fee rate is greater than 100_000_000", async () => {
                    const {marketManager, EQUMarketDescriptor} = await loadFixture(deployFixture);
                    let marketCfg = newMarketConfig();
                    marketCfg.feeRateConfig.referralParentReturnFeeRate =
                        BASIS_POINTS_DIVISOR +
                        1n -
                        marketCfg.feeRateConfig.protocolFeeRate -
                        marketCfg.feeRateConfig.referralReturnFeeRate;
                    await expect(marketManager.enableMarket(EQUMarketDescriptor.target, marketCfg))
                        .to.revertedWithCustomError(marketManager, "InvalidFeeRate")
                        .withArgs(
                            marketCfg.feeRateConfig.protocolFeeRate,
                            marketCfg.feeRateConfig.referralReturnFeeRate,
                            marketCfg.feeRateConfig.referralParentReturnFeeRate,
                        );
                });
            });

            describe("validate price config", () => {
                it("should revert if max price impact liquidity is zero", async () => {
                    const {marketManager, EQUMarketDescriptor} = await loadFixture(deployFixture);
                    let marketCfg = newMarketConfig();
                    marketCfg.priceConfig.maxPriceImpactLiquidity = 0n;
                    await expect(marketManager.enableMarket(EQUMarketDescriptor.target, marketCfg))
                        .to.revertedWithCustomError(marketManager, "InvalidMaxPriceImpactLiquidity")
                        .withArgs(0n);
                });

                it("should revert if liquidation vertex index is not less than latest vertex", async () => {
                    const {marketManager, EQUMarketDescriptor} = await loadFixture(deployFixture);
                    let marketCfg = newMarketConfig();
                    marketCfg.priceConfig.liquidationVertexIndex = LATEST_VERTEX;
                    await expect(marketManager.enableMarket(EQUMarketDescriptor.target, marketCfg))
                        .to.revertedWithCustomError(marketManager, "InvalidLiquidationVertexIndex")
                        .withArgs(marketCfg.priceConfig.liquidationVertexIndex);

                    marketCfg.priceConfig.liquidationVertexIndex = LATEST_VERTEX + 1n;
                    await expect(marketManager.enableMarket(EQUMarketDescriptor.target, marketCfg))
                        .to.revertedWithCustomError(marketManager, "InvalidLiquidationVertexIndex")
                        .withArgs(marketCfg.priceConfig.liquidationVertexIndex);
                });

                it("should revert if the balance rate or the premium rate of the first vertex is not zero", async () => {
                    const {marketManager, EQUMarketDescriptor} = await loadFixture(deployFixture);
                    let marketCfg = newMarketConfig();
                    marketCfg.priceConfig.vertices[0].balanceRate = 1n;
                    await expect(marketManager.enableMarket(EQUMarketDescriptor.target, marketCfg))
                        .to.revertedWithCustomError(marketManager, "InvalidVertex")
                        .withArgs(0n);

                    marketCfg.priceConfig.vertices[0].premiumRate = 1n;
                    await expect(marketManager.enableMarket(EQUMarketDescriptor.target, marketCfg))
                        .to.revertedWithCustomError(marketManager, "InvalidVertex")
                        .withArgs(0n);

                    marketCfg.priceConfig.vertices[0].balanceRate = 0n;
                    await expect(marketManager.enableMarket(EQUMarketDescriptor.target, marketCfg))
                        .to.revertedWithCustomError(marketManager, "InvalidVertex")
                        .withArgs(0n);
                });

                it("should revert if the balance rate or the premium rate of the previous vertex is greater than it of current vertex", async () => {
                    const {marketManager, EQUMarketDescriptor} = await loadFixture(deployFixture);
                    for (let i = 2; i < VERTEX_NUM; i++) {
                        let marketCfg = newMarketConfig();
                        marketCfg.priceConfig.vertices[i - 1].balanceRate =
                            marketCfg.priceConfig.vertices[i].balanceRate + 1n;
                        await expect(marketManager.enableMarket(EQUMarketDescriptor.target, marketCfg))
                            .to.revertedWithCustomError(marketManager, "InvalidVertex")
                            .withArgs(i);
                    }

                    for (let i = 2; i < VERTEX_NUM; i++) {
                        let marketCfg = newMarketConfig();
                        marketCfg.priceConfig.vertices[i - 1].premiumRate =
                            marketCfg.priceConfig.vertices[i].premiumRate + 1n;
                        await expect(marketManager.enableMarket(EQUMarketDescriptor.target, marketCfg))
                            .to.revertedWithCustomError(marketManager, "InvalidVertex")
                            .withArgs(i);
                    }

                    for (let i = 2; i < VERTEX_NUM; i++) {
                        let marketCfg = newMarketConfig();
                        marketCfg.priceConfig.vertices[i - 1].balanceRate =
                            marketCfg.priceConfig.vertices[i].balanceRate + 1n;
                        marketCfg.priceConfig.vertices[i - 1].premiumRate =
                            marketCfg.priceConfig.vertices[i].premiumRate + 1n;
                        await expect(marketManager.enableMarket(EQUMarketDescriptor.target, marketCfg))
                            .to.revertedWithCustomError(marketManager, "InvalidVertex")
                            .withArgs(i);
                    }
                });

                it("should revert if the balance rate or the premium rate of the last vertex is greater than 100_000_000", async () => {
                    const {marketManager, EQUMarketDescriptor} = await loadFixture(deployFixture);
                    let marketCfg = newMarketConfig();
                    marketCfg.priceConfig.vertices[marketCfg.priceConfig.vertices.length - 1].balanceRate =
                        BASIS_POINTS_DIVISOR + 1n;
                    await expect(marketManager.enableMarket(EQUMarketDescriptor.target, marketCfg))
                        .to.revertedWithCustomError(marketManager, "InvalidVertex")
                        .withArgs(LATEST_VERTEX);

                    marketCfg = newMarketConfig();
                    marketCfg.priceConfig.vertices[marketCfg.priceConfig.vertices.length - 1].premiumRate =
                        BASIS_POINTS_DIVISOR + 1n;
                    await expect(marketManager.enableMarket(EQUMarketDescriptor.target, marketCfg))
                        .to.revertedWithCustomError(marketManager, "InvalidVertex")
                        .withArgs(LATEST_VERTEX);

                    marketCfg = newMarketConfig();
                    marketCfg.priceConfig.vertices[marketCfg.priceConfig.vertices.length - 1].premiumRate =
                        BASIS_POINTS_DIVISOR + 1n;
                    marketCfg.priceConfig.vertices[marketCfg.priceConfig.vertices.length - 1].balanceRate =
                        BASIS_POINTS_DIVISOR + 1n;
                    await expect(marketManager.enableMarket(EQUMarketDescriptor.target, marketCfg))
                        .to.revertedWithCustomError(marketManager, "InvalidVertex")
                        .withArgs(LATEST_VERTEX);
                });
            });

            it("should pass", async () => {
                const {marketManager, EQUMarketDescriptor, marketCfg} = await loadFixture(deployFixture);
                expect(
                    (await marketManager.globalFundingRateSamples(EQUMarketDescriptor.target))
                        .lastAdjustFundingRateTime,
                ).to.eq(0n);

                const lastTimestamp = (await time.latest()) + 5;
                await time.setNextBlockTimestamp(lastTimestamp);
                await expect(marketManager.enableMarket(EQUMarketDescriptor.target, marketCfg))
                    .to.emit(marketManager, "MarketConfigEnabled")
                    .withArgs(
                        EQUMarketDescriptor.target,
                        (v: any) => {
                            expect(v.minMarginPerLiquidityPosition).to.eq(
                                marketCfg.baseConfig.minMarginPerLiquidityPosition,
                            );
                            expect(v.maxLeveragePerLiquidityPosition).to.eq(
                                marketCfg.baseConfig.maxLeveragePerLiquidityPosition,
                            );
                            expect(v.liquidationFeeRatePerLiquidityPosition).to.eq(
                                marketCfg.baseConfig.liquidationFeeRatePerLiquidityPosition,
                            );

                            expect(v.minMarginPerPosition).to.eq(marketCfg.baseConfig.minMarginPerPosition);
                            expect(v.maxLeveragePerPosition).to.eq(marketCfg.baseConfig.maxLeveragePerPosition);
                            expect(v.liquidationFeeRatePerPosition).to.eq(
                                marketCfg.baseConfig.liquidationFeeRatePerPosition,
                            );
                            expect(v.maxPositionLiquidity).to.eq(marketCfg.baseConfig.maxPositionLiquidity);
                            expect(v.maxPositionValueRate).to.eq(marketCfg.baseConfig.maxPositionValueRate);
                            expect(v.maxSizeRatePerPosition).to.eq(marketCfg.baseConfig.maxSizeRatePerPosition);

                            expect(v.interestRate).to.eq(marketCfg.baseConfig.interestRate);
                            expect(v.maxFundingRate).to.eq(marketCfg.baseConfig.maxFundingRate);
                            expect(v.liquidationExecutionFee).to.eq(marketCfg.baseConfig.liquidationExecutionFee);
                            return true;
                        },
                        (v: any) => {
                            expect(v.tradingFeeRate).to.eq(marketCfg.feeRateConfig.tradingFeeRate);
                            expect(v.protocolFeeRate).to.eq(marketCfg.feeRateConfig.protocolFeeRate);
                            expect(v.referralReturnFeeRate).to.eq(marketCfg.feeRateConfig.referralReturnFeeRate);
                            expect(v.referralParentReturnFeeRate).to.eq(
                                marketCfg.feeRateConfig.referralParentReturnFeeRate,
                            );
                            expect(v.referralDiscountRate).to.eq(marketCfg.feeRateConfig.referralDiscountRate);
                            return true;
                        },
                        (v: any) => {
                            expect(v.maxPriceImpactLiquidity).to.eq(marketCfg.priceConfig.maxPriceImpactLiquidity);
                            expect(v.liquidationVertexIndex).to.eq(marketCfg.priceConfig.liquidationVertexIndex);
                            expect(v.vertices[0].balanceRate).to.eq(marketCfg.priceConfig.vertices[0].balanceRate);
                            expect(v.vertices[0].premiumRate).to.eq(marketCfg.priceConfig.vertices[0].premiumRate);
                            expect(v.vertices[1].balanceRate).to.eq(marketCfg.priceConfig.vertices[1].balanceRate);
                            expect(v.vertices[1].premiumRate).to.eq(marketCfg.priceConfig.vertices[1].premiumRate);
                            expect(v.vertices[2].balanceRate).to.eq(marketCfg.priceConfig.vertices[2].balanceRate);
                            expect(v.vertices[2].premiumRate).to.eq(marketCfg.priceConfig.vertices[2].premiumRate);
                            expect(v.vertices[3].balanceRate).to.eq(marketCfg.priceConfig.vertices[3].balanceRate);
                            expect(v.vertices[3].premiumRate).to.eq(marketCfg.priceConfig.vertices[3].premiumRate);
                            expect(v.vertices[4].balanceRate).to.eq(marketCfg.priceConfig.vertices[4].balanceRate);
                            expect(v.vertices[4].premiumRate).to.eq(marketCfg.priceConfig.vertices[4].premiumRate);
                            expect(v.vertices[5].balanceRate).to.eq(marketCfg.priceConfig.vertices[5].balanceRate);
                            expect(v.vertices[5].premiumRate).to.eq(marketCfg.priceConfig.vertices[5].premiumRate);
                            expect(v.vertices[6].balanceRate).to.eq(marketCfg.priceConfig.vertices[6].balanceRate);
                            expect(v.vertices[6].premiumRate).to.eq(marketCfg.priceConfig.vertices[6].premiumRate);
                            expect(v.vertices[7].balanceRate).to.eq(marketCfg.priceConfig.vertices[7].balanceRate);
                            expect(v.vertices[7].premiumRate).to.eq(marketCfg.priceConfig.vertices[7].premiumRate);
                            expect(v.vertices[8].balanceRate).to.eq(marketCfg.priceConfig.vertices[8].balanceRate);
                            expect(v.vertices[8].premiumRate).to.eq(marketCfg.priceConfig.vertices[8].premiumRate);
                            expect(v.vertices[9].balanceRate).to.eq(marketCfg.priceConfig.vertices[9].balanceRate);
                            expect(v.vertices[9].premiumRate).to.eq(marketCfg.priceConfig.vertices[9].premiumRate);
                            return true;
                        },
                    );
                const lastAdjustFundingRateTime = lastTimestamp - (lastTimestamp % 3600);

                expect(
                    (await marketManager.globalFundingRateSamples(EQUMarketDescriptor.target))
                        .lastAdjustFundingRateTime,
                ).to.eq(lastAdjustFundingRateTime);
            });
        });

        describe("#updateMarketBaseConfig", () => {
            it("should revert if caller is not the gov", async () => {
                const {marketManager, ETHMarketDescriptor, marketCfg, other} = await loadFixture(deployFixture);
                await expect(
                    marketManager
                        .connect(other)
                        .updateMarketBaseConfig(ETHMarketDescriptor.target, marketCfg.baseConfig),
                ).to.revertedWithCustomError(marketManager, "Forbidden");
            });

            it("should revert if the market has not enabled", async () => {
                const {marketManager, EQUMarketDescriptor, marketCfg} = await loadFixture(deployFixture);
                await expect(marketManager.updateMarketBaseConfig(EQUMarketDescriptor.target, marketCfg.baseConfig))
                    .to.revertedWithCustomError(marketManager, "MarketNotEnabled")
                    .withArgs(EQUMarketDescriptor.target);
            });

            it("should revert if max leverage per liquidity position is zero", async () => {
                const {marketManager, ETHMarketDescriptor} = await loadFixture(deployFixture);
                let baseConfig = newMarketBaseConfig();
                baseConfig.maxLeveragePerLiquidityPosition = 0n;
                await expect(marketManager.updateMarketBaseConfig(ETHMarketDescriptor.target, baseConfig))
                    .to.revertedWithCustomError(marketManager, "InvalidMaxLeveragePerLiquidityPosition")
                    .withArgs(0n);
            });

            it("should revert if liquidation fee rate per liquidity position is greater than 100_000_000", async () => {
                const {marketManager, ETHMarketDescriptor} = await loadFixture(deployFixture);
                let baseConfig = newMarketBaseConfig();
                baseConfig.liquidationFeeRatePerLiquidityPosition = BASIS_POINTS_DIVISOR + 1n;
                await expect(marketManager.updateMarketBaseConfig(ETHMarketDescriptor.target, baseConfig))
                    .to.revertedWithCustomError(marketManager, "InvalidLiquidationFeeRatePerLiquidityPosition")
                    .withArgs(BASIS_POINTS_DIVISOR + 1n);
            });

            it("should revert if max leverage per position is zero", async () => {
                const {marketManager, ETHMarketDescriptor} = await loadFixture(deployFixture);
                let baseConfig = newMarketBaseConfig();
                baseConfig.maxLeveragePerPosition = 0n;
                await expect(marketManager.updateMarketBaseConfig(ETHMarketDescriptor.target, baseConfig))
                    .to.revertedWithCustomError(marketManager, "InvalidMaxLeveragePerPosition")
                    .withArgs(0n);
            });

            it("should revert if liquidation fee rate per position is greater than 100_000_000", async () => {
                const {marketManager, ETHMarketDescriptor} = await loadFixture(deployFixture);
                let baseConfig = newMarketBaseConfig();
                baseConfig.liquidationFeeRatePerPosition = BASIS_POINTS_DIVISOR + 1n;
                await expect(marketManager.updateMarketBaseConfig(ETHMarketDescriptor.target, baseConfig))
                    .to.revertedWithCustomError(marketManager, "InvalidLiquidationFeeRatePerPosition")
                    .withArgs(BASIS_POINTS_DIVISOR + 1n);
            });

            it("should revert if max position liquidity is zero", async () => {
                const {marketManager, ETHMarketDescriptor} = await loadFixture(deployFixture);
                let baseConfig = newMarketBaseConfig();
                baseConfig.maxPositionLiquidity = 0n;
                await expect(marketManager.updateMarketBaseConfig(ETHMarketDescriptor.target, baseConfig))
                    .to.revertedWithCustomError(marketManager, "InvalidMaxPositionLiquidity")
                    .withArgs(0n);
            });

            it("should revert if max position value rate is zero", async () => {
                const {marketManager, ETHMarketDescriptor} = await loadFixture(deployFixture);
                let baseConfig = newMarketBaseConfig();
                baseConfig.maxPositionValueRate = 0n;
                await expect(marketManager.updateMarketBaseConfig(ETHMarketDescriptor.target, baseConfig))
                    .to.revertedWithCustomError(marketManager, "InvalidMaxPositionValueRate")
                    .withArgs(0n);
            });

            it("should revert if max size rate per position is greater than 100_000_000", async () => {
                const {marketManager, ETHMarketDescriptor} = await loadFixture(deployFixture);
                let baseConfig = newMarketBaseConfig();
                baseConfig.maxSizeRatePerPosition = BASIS_POINTS_DIVISOR + 1n;
                await expect(marketManager.updateMarketBaseConfig(ETHMarketDescriptor.target, baseConfig))
                    .to.revertedWithCustomError(marketManager, "InvalidMaxSizeRatePerPosition")
                    .withArgs(BASIS_POINTS_DIVISOR + 1n);
            });

            it("should revert if interest rate is greater than 100_000_000", async () => {
                const {marketManager, ETHMarketDescriptor} = await loadFixture(deployFixture);
                let baseConfig = newMarketBaseConfig();
                baseConfig.interestRate = BASIS_POINTS_DIVISOR + 1n;
                await expect(marketManager.updateMarketBaseConfig(ETHMarketDescriptor.target, baseConfig))
                    .to.revertedWithCustomError(marketManager, "InvalidInterestRate")
                    .withArgs(BASIS_POINTS_DIVISOR + 1n);
            });

            it("should revert if max funding rate is greater than 100_000_000", async () => {
                const {marketManager, ETHMarketDescriptor} = await loadFixture(deployFixture);
                let baseConfig = newMarketBaseConfig();
                baseConfig.maxFundingRate = BASIS_POINTS_DIVISOR + 1n;
                await expect(marketManager.updateMarketBaseConfig(ETHMarketDescriptor.target, baseConfig))
                    .to.revertedWithCustomError(marketManager, "InvalidMaxFundingRate")
                    .withArgs(BASIS_POINTS_DIVISOR + 1n);
            });

            it("should not invoke afterMarketBaseConfigChanged event if the max position liquidity and max position value rate and max size rate per position were not changed", async () => {
                const {marketManager, ETHMarketDescriptor} = await loadFixture(deployFixture);
                const baseConfig = newMarketBaseConfig();
                await expect(marketManager.updateMarketBaseConfig(ETHMarketDescriptor.target, baseConfig)).to.not.emit(
                    marketManager,
                    "GlobalPositionSizeChanged",
                );
            });

            it("should pass", async () => {
                for (let i = 0; i < 3; i++) {
                    const {marketManager, ETHMarketDescriptor} = await loadFixture(deployFixture);
                    let baseConfig = newMarketBaseConfig();
                    switch (i) {
                        case 0:
                            baseConfig.maxPositionLiquidity = baseConfig.maxPositionLiquidity + 1n;
                            break;
                        case 1:
                            baseConfig.maxPositionValueRate = baseConfig.maxPositionValueRate + 1n;
                            break;
                        case 2:
                            baseConfig.maxSizeRatePerPosition = baseConfig.maxSizeRatePerPosition + 1n;
                            break;
                    }
                    baseConfig.maxPositionLiquidity = baseConfig.maxPositionLiquidity + 1n;
                    const assertion = expect(
                        marketManager.updateMarketBaseConfig(ETHMarketDescriptor.target, baseConfig),
                    );
                    await assertion.to
                        .emit(marketManager, "MarketBaseConfigChanged")
                        .withArgs(ETHMarketDescriptor.target, (v: any) => {
                            expect(v.minMarginPerLiquidityPosition).to.eq(baseConfig.minMarginPerLiquidityPosition);
                            expect(v.maxLeveragePerLiquidityPosition).to.eq(baseConfig.maxLeveragePerLiquidityPosition);
                            expect(v.liquidationFeeRatePerLiquidityPosition).to.eq(
                                baseConfig.liquidationFeeRatePerLiquidityPosition,
                            );

                            expect(v.minMarginPerPosition).to.eq(baseConfig.minMarginPerPosition);
                            expect(v.maxLeveragePerPosition).to.eq(baseConfig.maxLeveragePerPosition);
                            expect(v.liquidationFeeRatePerPosition).to.eq(baseConfig.liquidationFeeRatePerPosition);
                            expect(v.maxPositionLiquidity).to.eq(baseConfig.maxPositionLiquidity);
                            expect(v.maxPositionValueRate).to.eq(baseConfig.maxPositionValueRate);
                            expect(v.maxSizeRatePerPosition).to.eq(baseConfig.maxSizeRatePerPosition);

                            expect(v.interestRate).to.eq(baseConfig.interestRate);
                            expect(v.maxFundingRate).to.eq(baseConfig.maxFundingRate);
                            expect(v.liquidationExecutionFee).to.eq(baseConfig.liquidationExecutionFee);
                            return true;
                        });
                    await assertion.to.emit(marketManager, "GlobalPositionSizeChanged");
                }
            });
        });

        describe("#updateMarketFeeRateConfig", () => {
            it("should revert if caller is not the gov", async () => {
                const {marketManager, ETHMarketDescriptor, marketCfg, other} = await loadFixture(deployFixture);
                await expect(
                    marketManager
                        .connect(other)
                        .updateMarketFeeRateConfig(ETHMarketDescriptor.target, marketCfg.feeRateConfig),
                ).to.revertedWithCustomError(marketManager, "Forbidden");
            });

            it("should revert if the market has not enabled", async () => {
                const {marketManager, EQUMarketDescriptor, marketCfg} = await loadFixture(deployFixture);
                await expect(
                    marketManager.updateMarketFeeRateConfig(EQUMarketDescriptor.target, marketCfg.feeRateConfig),
                )
                    .to.revertedWithCustomError(marketManager, "MarketNotEnabled")
                    .withArgs(EQUMarketDescriptor.target);
            });

            it("should revert if trading fee rate is greater than 100_000_000", async () => {
                const {marketManager, ETHMarketDescriptor} = await loadFixture(deployFixture);
                let feeRateConfig = newMarketFeeRateConfig();
                feeRateConfig.tradingFeeRate = BASIS_POINTS_DIVISOR + 1n;
                await expect(marketManager.updateMarketFeeRateConfig(ETHMarketDescriptor.target, feeRateConfig))
                    .to.revertedWithCustomError(marketManager, "InvalidTradingFeeRate")
                    .withArgs(BASIS_POINTS_DIVISOR + 1n);
            });

            it("should revert if protocol fee rate is greater than 100_000_000", async () => {
                const {marketManager, ETHMarketDescriptor} = await loadFixture(deployFixture);
                let feeRateConfig = newMarketFeeRateConfig();
                feeRateConfig.protocolFeeRate = BASIS_POINTS_DIVISOR + 1n;
                await expect(marketManager.updateMarketFeeRateConfig(ETHMarketDescriptor.target, feeRateConfig))
                    .to.revertedWithCustomError(marketManager, "InvalidProtocolFeeRate")
                    .withArgs(BASIS_POINTS_DIVISOR + 1n);
            });

            it("should revert if referral return fee rate is greater than 100_000_000", async () => {
                const {marketManager, ETHMarketDescriptor} = await loadFixture(deployFixture);
                let feeRateConfig = newMarketFeeRateConfig();
                feeRateConfig.referralReturnFeeRate = BASIS_POINTS_DIVISOR + 1n;
                await expect(marketManager.updateMarketFeeRateConfig(ETHMarketDescriptor.target, feeRateConfig))
                    .to.revertedWithCustomError(marketManager, "InvalidReferralReturnFeeRate")
                    .withArgs(BASIS_POINTS_DIVISOR + 1n);
            });

            it("should revert if referral parent return fee rate is greater than 100_000_000", async () => {
                const {marketManager, ETHMarketDescriptor} = await loadFixture(deployFixture);
                let feeRateConfig = newMarketFeeRateConfig();
                feeRateConfig.referralParentReturnFeeRate = BASIS_POINTS_DIVISOR + 1n;
                await expect(marketManager.updateMarketFeeRateConfig(ETHMarketDescriptor.target, feeRateConfig))
                    .to.revertedWithCustomError(marketManager, "InvalidReferralParentReturnFeeRate")
                    .withArgs(BASIS_POINTS_DIVISOR + 1n);
            });

            it("should revert if referral discount fee rate is greater than 100_000_000", async () => {
                const {marketManager, ETHMarketDescriptor} = await loadFixture(deployFixture);
                let feeRateConfig = newMarketFeeRateConfig();
                feeRateConfig.referralDiscountRate = BASIS_POINTS_DIVISOR + 1n;
                await expect(marketManager.updateMarketFeeRateConfig(ETHMarketDescriptor.target, feeRateConfig))
                    .to.revertedWithCustomError(marketManager, "InvalidReferralDiscountRate")
                    .withArgs(BASIS_POINTS_DIVISOR + 1n);
            });

            it("should revert if the sum of liquidity fee rate and protocol fee rate and referral return fee rate and referral parent return fee rate is greater than 100_000_000", async () => {
                const {marketManager, ETHMarketDescriptor} = await loadFixture(deployFixture);
                let feeRateConfig = newMarketFeeRateConfig();
                feeRateConfig.referralParentReturnFeeRate =
                    BASIS_POINTS_DIVISOR + 1n - feeRateConfig.protocolFeeRate - feeRateConfig.referralReturnFeeRate;
                await expect(marketManager.updateMarketFeeRateConfig(ETHMarketDescriptor.target, feeRateConfig))
                    .to.revertedWithCustomError(marketManager, "InvalidFeeRate")
                    .withArgs(
                        feeRateConfig.protocolFeeRate,
                        feeRateConfig.referralReturnFeeRate,
                        feeRateConfig.referralParentReturnFeeRate,
                    );
            });

            it("should pass", async () => {
                const {marketManager, ETHMarketDescriptor} = await loadFixture(deployFixture);
                let feeRateConfig = newMarketFeeRateConfig();
                await expect(marketManager.updateMarketFeeRateConfig(ETHMarketDescriptor.target, feeRateConfig))
                    .to.emit(marketManager, "MarketFeeRateConfigChanged")
                    .withArgs(ETHMarketDescriptor.target, (v: any) => {
                        expect(v.tradingFeeRate).to.eq(feeRateConfig.tradingFeeRate);
                        expect(v.protocolFeeRate).to.eq(feeRateConfig.protocolFeeRate);
                        expect(v.referralReturnFeeRate).to.eq(feeRateConfig.referralReturnFeeRate);
                        expect(v.referralParentReturnFeeRate).to.eq(feeRateConfig.referralParentReturnFeeRate);
                        expect(v.referralDiscountRate).to.eq(feeRateConfig.referralDiscountRate);
                        return true;
                    });
            });
        });

        describe("#updateMarketPriceConfig", () => {
            it("should revert if caller is not the gov", async () => {
                const {marketManager, ETHMarketDescriptor, marketCfg, other} = await loadFixture(deployFixture);
                await expect(
                    marketManager
                        .connect(other)
                        .updateMarketPriceConfig(ETHMarketDescriptor.target, marketCfg.priceConfig),
                ).to.revertedWithCustomError(marketManager, "Forbidden");
            });

            it("should revert if the market has not enabled", async () => {
                const {marketManager, EQUMarketDescriptor, marketCfg} = await loadFixture(deployFixture);
                await expect(marketManager.updateMarketPriceConfig(EQUMarketDescriptor.target, marketCfg.priceConfig))
                    .to.revertedWithCustomError(marketManager, "MarketNotEnabled")
                    .withArgs(EQUMarketDescriptor.target);
            });

            it("should revert if max price impact liquidity is zero", async () => {
                const {marketManager, ETHMarketDescriptor} = await loadFixture(deployFixture);
                let priceConfig = newMarketPriceConfig();
                priceConfig.maxPriceImpactLiquidity = 0n;
                await expect(marketManager.updateMarketPriceConfig(ETHMarketDescriptor.target, priceConfig))
                    .to.revertedWithCustomError(marketManager, "InvalidMaxPriceImpactLiquidity")
                    .withArgs(0n);
            });

            it("should revert if liquidation vertex index is not less than latest vertex", async () => {
                const {marketManager, ETHMarketDescriptor} = await loadFixture(deployFixture);
                let priceConfig = newMarketPriceConfig();
                priceConfig.liquidationVertexIndex = LATEST_VERTEX;
                await expect(marketManager.updateMarketPriceConfig(ETHMarketDescriptor.target, priceConfig))
                    .to.revertedWithCustomError(marketManager, "InvalidLiquidationVertexIndex")
                    .withArgs(priceConfig.liquidationVertexIndex);

                priceConfig.liquidationVertexIndex = LATEST_VERTEX + 1n;
                await expect(marketManager.updateMarketPriceConfig(ETHMarketDescriptor.target, priceConfig))
                    .to.revertedWithCustomError(marketManager, "InvalidLiquidationVertexIndex")
                    .withArgs(priceConfig.liquidationVertexIndex);
            });

            it("should revert if the balance rate or the premium rate of the first vertex is not zero", async () => {
                const {marketManager, ETHMarketDescriptor} = await loadFixture(deployFixture);
                let priceConfig = newMarketPriceConfig();
                priceConfig.vertices[0].balanceRate = 1n;
                await expect(marketManager.updateMarketPriceConfig(ETHMarketDescriptor.target, priceConfig))
                    .to.revertedWithCustomError(marketManager, "InvalidVertex")
                    .withArgs(0n);

                priceConfig.vertices[0].premiumRate = 1n;
                await expect(marketManager.updateMarketPriceConfig(ETHMarketDescriptor.target, priceConfig))
                    .to.revertedWithCustomError(marketManager, "InvalidVertex")
                    .withArgs(0n);

                priceConfig.vertices[0].balanceRate = 0n;
                await expect(marketManager.updateMarketPriceConfig(ETHMarketDescriptor.target, priceConfig))
                    .to.revertedWithCustomError(marketManager, "InvalidVertex")
                    .withArgs(0n);
            });

            it("should revert if the balance rate or the premium rate of the previous vertex is greater than it of current vertex", async () => {
                const {marketManager, ETHMarketDescriptor} = await loadFixture(deployFixture);
                for (let i = 2; i < VERTEX_NUM; i++) {
                    let priceConfig = newMarketPriceConfig();
                    priceConfig.vertices[i - 1].balanceRate = priceConfig.vertices[i].balanceRate + 1n;
                    await expect(marketManager.updateMarketPriceConfig(ETHMarketDescriptor.target, priceConfig))
                        .to.revertedWithCustomError(marketManager, "InvalidVertex")
                        .withArgs(i);
                }

                for (let i = 2; i < VERTEX_NUM; i++) {
                    let priceConfig = newMarketPriceConfig();
                    priceConfig.vertices[i - 1].premiumRate = priceConfig.vertices[i].premiumRate + 1n;
                    await expect(marketManager.updateMarketPriceConfig(ETHMarketDescriptor.target, priceConfig))
                        .to.revertedWithCustomError(marketManager, "InvalidVertex")
                        .withArgs(i);
                }

                for (let i = 2; i < VERTEX_NUM; i++) {
                    let priceConfig = newMarketPriceConfig();
                    priceConfig.vertices[i - 1].balanceRate = priceConfig.vertices[i].balanceRate + 1n;
                    priceConfig.vertices[i - 1].premiumRate = priceConfig.vertices[i].premiumRate + 1n;
                    await expect(marketManager.updateMarketPriceConfig(ETHMarketDescriptor.target, priceConfig))
                        .to.revertedWithCustomError(marketManager, "InvalidVertex")
                        .withArgs(i);
                }
            });

            it("should revert if the balance rate or the premium rate of the last vertex is greater than 100_000_000", async () => {
                const {marketManager, ETHMarketDescriptor} = await loadFixture(deployFixture);
                let priceConfig = newMarketPriceConfig();
                priceConfig.vertices[priceConfig.vertices.length - 1].balanceRate = BASIS_POINTS_DIVISOR + 1n;
                await expect(marketManager.updateMarketPriceConfig(ETHMarketDescriptor.target, priceConfig))
                    .to.revertedWithCustomError(marketManager, "InvalidVertex")
                    .withArgs(LATEST_VERTEX);

                priceConfig = newMarketPriceConfig();
                priceConfig.vertices[priceConfig.vertices.length - 1].premiumRate = BASIS_POINTS_DIVISOR + 1n;
                await expect(marketManager.updateMarketPriceConfig(ETHMarketDescriptor.target, priceConfig))
                    .to.revertedWithCustomError(marketManager, "InvalidVertex")
                    .withArgs(LATEST_VERTEX);

                priceConfig = newMarketPriceConfig();
                priceConfig.vertices[priceConfig.vertices.length - 1].premiumRate = BASIS_POINTS_DIVISOR + 1n;
                priceConfig.vertices[priceConfig.vertices.length - 1].balanceRate = BASIS_POINTS_DIVISOR + 1n;
                await expect(marketManager.updateMarketPriceConfig(ETHMarketDescriptor.target, priceConfig))
                    .to.revertedWithCustomError(marketManager, "InvalidVertex")
                    .withArgs(LATEST_VERTEX);
            });

            it("should pass", async () => {
                const {marketManager, ETHMarketDescriptor} = await loadFixture(deployFixture);
                let priceConfig = newMarketPriceConfig();
                const assertion = expect(
                    marketManager.updateMarketPriceConfig(ETHMarketDescriptor.target, priceConfig),
                );
                await assertion.to
                    .emit(marketManager, "MarketPriceConfigChanged")
                    .withArgs(ETHMarketDescriptor.target, (v: any) => {
                        expect(v.maxPriceImpactLiquidity).to.eq(priceConfig.maxPriceImpactLiquidity);
                        expect(v.liquidationVertexIndex).to.eq(priceConfig.liquidationVertexIndex);
                        expect(v.vertices[0].balanceRate).to.eq(priceConfig.vertices[0].balanceRate);
                        expect(v.vertices[0].premiumRate).to.eq(priceConfig.vertices[0].premiumRate);
                        expect(v.vertices[1].balanceRate).to.eq(priceConfig.vertices[1].balanceRate);
                        expect(v.vertices[1].premiumRate).to.eq(priceConfig.vertices[1].premiumRate);
                        expect(v.vertices[2].balanceRate).to.eq(priceConfig.vertices[2].balanceRate);
                        expect(v.vertices[2].premiumRate).to.eq(priceConfig.vertices[2].premiumRate);
                        expect(v.vertices[3].balanceRate).to.eq(priceConfig.vertices[3].balanceRate);
                        expect(v.vertices[3].premiumRate).to.eq(priceConfig.vertices[3].premiumRate);
                        expect(v.vertices[4].balanceRate).to.eq(priceConfig.vertices[4].balanceRate);
                        expect(v.vertices[4].premiumRate).to.eq(priceConfig.vertices[4].premiumRate);
                        expect(v.vertices[5].balanceRate).to.eq(priceConfig.vertices[5].balanceRate);
                        expect(v.vertices[5].premiumRate).to.eq(priceConfig.vertices[5].premiumRate);
                        expect(v.vertices[6].balanceRate).to.eq(priceConfig.vertices[6].balanceRate);
                        expect(v.vertices[6].premiumRate).to.eq(priceConfig.vertices[6].premiumRate);
                        expect(v.vertices[7].balanceRate).to.eq(priceConfig.vertices[7].balanceRate);
                        expect(v.vertices[7].premiumRate).to.eq(priceConfig.vertices[7].premiumRate);
                        expect(v.vertices[8].balanceRate).to.eq(priceConfig.vertices[8].balanceRate);
                        expect(v.vertices[8].premiumRate).to.eq(priceConfig.vertices[8].premiumRate);
                        expect(v.vertices[9].balanceRate).to.eq(priceConfig.vertices[9].balanceRate);
                        expect(v.vertices[9].premiumRate).to.eq(priceConfig.vertices[9].premiumRate);
                        return true;
                    });
                await assertion.to.emit(marketManager, "PriceVertexChanged");
            });
        });
    });

    describe("MarketManagerStates", () => {
        describe("#globalLiquidityPositions", () => {
            it("should return empty values in initial status", async () => {
                const {marketManager, ETHMarketDescriptor} = await loadFixture(deployFixture);
                const globalLiquidityPosition = await marketManager.globalLiquidityPositions(
                    ETHMarketDescriptor.target,
                );
                expect(globalLiquidityPosition.netSize).to.eq(0n);
                expect(globalLiquidityPosition.liquidationBufferNetSize).to.eq(0n);
                expect(globalLiquidityPosition.previousSPPriceX96).to.eq(0n);
                expect(globalLiquidityPosition.side).to.eq(0n);
                expect(globalLiquidityPosition.liquidity).to.eq(0n);
                expect(globalLiquidityPosition.unrealizedPnLGrowthX64).to.eq(0n);
            });

            it("should return empty values for the market has not enabled", async () => {
                const {marketManager, EQUMarketDescriptor} = await loadFixture(deployFixture);
                const globalLiquidityPosition = await marketManager.globalLiquidityPositions(
                    EQUMarketDescriptor.target,
                );
                expect(globalLiquidityPosition.netSize).to.eq(0n);
                expect(globalLiquidityPosition.liquidationBufferNetSize).to.eq(0n);
                expect(globalLiquidityPosition.previousSPPriceX96).to.eq(0n);
                expect(globalLiquidityPosition.side).to.eq(0n);
                expect(globalLiquidityPosition.liquidity).to.eq(0n);
                expect(globalLiquidityPosition.unrealizedPnLGrowthX64).to.eq(0n);
            });

            it("should return right values when someones have increased liquidity position and position", async () => {
                const {marketManager, ETHMarketDescriptor, USDT, account, marketCfg} = await loadFixture(deployFixture);
                await USDT.transfer(marketManager.target, marketCfg.baseConfig.minMarginPerLiquidityPosition);
                await marketManager.increaseLiquidityPosition(
                    ETHMarketDescriptor.target,
                    account.address,
                    marketCfg.baseConfig.minMarginPerLiquidityPosition,
                    marketCfg.baseConfig.minMarginPerLiquidityPosition,
                );

                await USDT.transfer(marketManager.target, marketCfg.baseConfig.minMarginPerPosition);
                await marketManager.increasePosition(
                    ETHMarketDescriptor.target,
                    account.address,
                    SIDE_LONG,
                    marketCfg.baseConfig.minMarginPerPosition,
                    marketCfg.baseConfig.minMarginPerPosition * 100n,
                );

                const globalLiquidityPosition = await marketManager.globalLiquidityPositions(
                    ETHMarketDescriptor.target,
                );
                expect(globalLiquidityPosition.netSize).to.eq(marketCfg.baseConfig.minMarginPerPosition * 100n);
                expect(globalLiquidityPosition.liquidationBufferNetSize).to.eq(0n);
                expect(globalLiquidityPosition.previousSPPriceX96).to.gt(0n);
                expect(globalLiquidityPosition.side).to.eq(SIDE_SHORT);
                expect(globalLiquidityPosition.liquidity).to.eq(marketCfg.baseConfig.minMarginPerLiquidityPosition);
                expect(globalLiquidityPosition.unrealizedPnLGrowthX64).to.eq(
                    (1n * (1n << 64n)) / marketCfg.baseConfig.minMarginPerLiquidityPosition,
                );
            });
        });

        describe("#liquidityPositions", () => {
            it("should return empty values for the market has not enabled", async () => {
                const {marketManager, EQUMarketDescriptor, account} = await loadFixture(deployFixture);
                const liquidityPosition = await marketManager.liquidityPositions(
                    EQUMarketDescriptor.target,
                    account.address,
                );
                expect(liquidityPosition.margin).to.eq(0n);
                expect(liquidityPosition.liquidity).to.eq(0n);
                expect(liquidityPosition.entryUnrealizedPnLGrowthX64).to.eq(0n);
            });

            it("should return empty values for the account which has not increased liquidity position yet", async () => {
                const {marketManager, ETHMarketDescriptor, account} = await loadFixture(deployFixture);
                const liquidityPosition = await marketManager.liquidityPositions(
                    ETHMarketDescriptor.target,
                    account.address,
                );
                expect(liquidityPosition.margin).to.eq(0n);
                expect(liquidityPosition.liquidity).to.eq(0n);
                expect(liquidityPosition.entryUnrealizedPnLGrowthX64).to.eq(0n);
            });

            it("should return right values for the account which has increased liquidity position", async () => {
                const {marketManager, ETHMarketDescriptor, USDT, account, marketCfg} = await loadFixture(deployFixture);
                await USDT.transfer(marketManager.target, marketCfg.baseConfig.minMarginPerLiquidityPosition);
                await marketManager.increaseLiquidityPosition(
                    ETHMarketDescriptor.target,
                    account.address,
                    marketCfg.baseConfig.minMarginPerLiquidityPosition,
                    marketCfg.baseConfig.minMarginPerLiquidityPosition * 2n,
                );

                const liquidityPosition = await marketManager.liquidityPositions(
                    ETHMarketDescriptor.target,
                    account.address,
                );
                expect(liquidityPosition.margin).to.eq(marketCfg.baseConfig.minMarginPerLiquidityPosition);
                expect(liquidityPosition.liquidity).to.eq(marketCfg.baseConfig.minMarginPerLiquidityPosition * 2n);
                expect(liquidityPosition.entryUnrealizedPnLGrowthX64).to.eq(0n);
            });
        });

        describe("#globalPositions", () => {
            it("should return empty values for the market has not enabled", async () => {
                const {marketManager, EQUMarketDescriptor} = await loadFixture(deployFixture);
                const globalPositions = await marketManager.globalPositions(EQUMarketDescriptor.target);
                expect(globalPositions.longSize).to.eq(0n);
                expect(globalPositions.shortSize).to.eq(0n);
                expect(globalPositions.maxSize).to.eq(0n);
                expect(globalPositions.maxSizePerPosition).to.eq(0n);
                expect(globalPositions.longFundingRateGrowthX96).to.eq(0n);
                expect(globalPositions.shortFundingRateGrowthX96).to.eq(0n);
            });

            it("should return empty values for the market which has no position yet", async () => {
                const {marketManager, ETHMarketDescriptor} = await loadFixture(deployFixture);
                const globalPositions = await marketManager.globalPositions(ETHMarketDescriptor.target);
                expect(globalPositions.longSize).to.eq(0n);
                expect(globalPositions.shortSize).to.eq(0n);
                expect(globalPositions.maxSize).to.eq(0n);
                expect(globalPositions.maxSizePerPosition).to.eq(0n);
                expect(globalPositions.longFundingRateGrowthX96).to.eq(0n);
                expect(globalPositions.shortFundingRateGrowthX96).to.eq(0n);
            });

            it("should return right values for the market which has positions", async () => {
                const {marketManager, ETHMarketDescriptor, USDT, account, other, marketCfg, mockPriceFeed} =
                    await loadFixture(deployFixture);
                const lastTimestamp = await time.latest();
                const nextHourBegin = lastTimestamp - (lastTimestamp % 3600) + 3600;
                await time.setNextBlockTimestamp(nextHourBegin);
                await USDT.transfer(marketManager.target, marketCfg.baseConfig.minMarginPerLiquidityPosition);
                await marketManager.increaseLiquidityPosition(
                    ETHMarketDescriptor.target,
                    account.address,
                    marketCfg.baseConfig.minMarginPerLiquidityPosition,
                    marketCfg.baseConfig.minMarginPerLiquidityPosition * 2n,
                );

                await USDT.transfer(marketManager.target, marketCfg.baseConfig.minMarginPerPosition);
                await marketManager.increasePosition(
                    ETHMarketDescriptor.target,
                    account.address,
                    SIDE_LONG,
                    marketCfg.baseConfig.minMarginPerPosition,
                    marketCfg.baseConfig.minMarginPerPosition * 100n,
                );

                await USDT.mint(other.address, marketCfg.baseConfig.minMarginPerPosition);
                await USDT.connect(other).transfer(marketManager.target, marketCfg.baseConfig.minMarginPerPosition);
                await marketManager.increasePosition(
                    ETHMarketDescriptor.target,
                    other.address,
                    SIDE_SHORT,
                    marketCfg.baseConfig.minMarginPerPosition,
                    marketCfg.baseConfig.minMarginPerPosition * 50n,
                );

                await mockPriceFeed.setMinPriceX96(toPriceX96("1408.234", DECIMALS_18, DECIMALS_6));
                await mockPriceFeed.setMaxPriceX96(toPriceX96("1408.235", DECIMALS_18, DECIMALS_6));
                await time.setNextBlockTimestamp(nextHourBegin + 3600 * 2);
                await USDT.mint(other.address, marketCfg.baseConfig.minMarginPerPosition);
                await USDT.connect(other).transfer(marketManager.target, marketCfg.baseConfig.minMarginPerPosition);
                await expect(
                    marketManager.increasePosition(
                        ETHMarketDescriptor.target,
                        other.address,
                        SIDE_SHORT,
                        marketCfg.baseConfig.minMarginPerPosition,
                        marketCfg.baseConfig.minMarginPerPosition * 50n,
                    ),
                ).to.emit(marketManager, "FundingRateGrowthAdjusted");

                const globalPositions = await marketManager.globalPositions(ETHMarketDescriptor.target);
                expect(globalPositions.longSize).to.eq(marketCfg.baseConfig.minMarginPerPosition * 100n);
                expect(globalPositions.shortSize).to.eq(marketCfg.baseConfig.minMarginPerPosition * 100n);
                expect(globalPositions.maxSize).to.gt(0n);
                expect(globalPositions.maxSizePerPosition).to.gt(0n);
                expect(globalPositions.longFundingRateGrowthX96).to.lt(0n);
                expect(globalPositions.shortFundingRateGrowthX96).to.gt(0n);
            });
        });

        describe("#previousGlobalFundingRates", () => {
            it("should return empty values for the market has not enabled", async () => {
                const {marketManager, EQUMarketDescriptor} = await loadFixture(deployFixture);
                const previousGlobalFundingRate = await marketManager.previousGlobalFundingRates(
                    EQUMarketDescriptor.target,
                );
                expect(previousGlobalFundingRate.longFundingRateGrowthX96).to.eq(0n);
                expect(previousGlobalFundingRate.shortFundingRateGrowthX96).to.eq(0n);
            });

            it("should return empty values for the market being in initial status", async () => {
                const {marketManager, ETHMarketDescriptor} = await loadFixture(deployFixture);
                const previousGlobalFundingRate = await marketManager.previousGlobalFundingRates(
                    ETHMarketDescriptor.target,
                );
                expect(previousGlobalFundingRate.longFundingRateGrowthX96).to.eq(0n);
                expect(previousGlobalFundingRate.shortFundingRateGrowthX96).to.eq(0n);
            });

            it("should return right values for the market which has adjusted funding rate", async () => {
                const {marketManager, ETHMarketDescriptor, USDT, account, other, mockPriceFeed, marketCfg} =
                    await loadFixture(deployFixture);
                const lastTimestamp = await time.latest();
                const nextHourBegin = lastTimestamp - (lastTimestamp % 3600) + 3600;
                await time.setNextBlockTimestamp(nextHourBegin);
                await USDT.transfer(marketManager.target, marketCfg.baseConfig.minMarginPerLiquidityPosition);
                await marketManager.increaseLiquidityPosition(
                    ETHMarketDescriptor.target,
                    account.address,
                    marketCfg.baseConfig.minMarginPerLiquidityPosition,
                    marketCfg.baseConfig.minMarginPerLiquidityPosition * 2n,
                );

                await time.setNextBlockTimestamp(nextHourBegin + 5);
                await USDT.transfer(marketManager.target, marketCfg.baseConfig.minMarginPerPosition);
                await marketManager.increasePosition(
                    ETHMarketDescriptor.target,
                    account.address,
                    SIDE_LONG,
                    marketCfg.baseConfig.minMarginPerPosition,
                    marketCfg.baseConfig.minMarginPerPosition * 100n,
                );

                await time.setNextBlockTimestamp(nextHourBegin + 10);
                await USDT.transfer(marketManager.target, marketCfg.baseConfig.minMarginPerPosition);
                await marketManager.increasePosition(
                    ETHMarketDescriptor.target,
                    account.address,
                    SIDE_SHORT,
                    marketCfg.baseConfig.minMarginPerPosition,
                    marketCfg.baseConfig.minMarginPerPosition * 100n,
                );

                await mockPriceFeed.setMinPriceX96(toPriceX96("1408.234", DECIMALS_18, DECIMALS_6));
                await mockPriceFeed.setMaxPriceX96(toPriceX96("1408.235", DECIMALS_18, DECIMALS_6));
                await time.setNextBlockTimestamp(nextHourBegin + 3600 * 2);
                await USDT.mint(other.address, marketCfg.baseConfig.minMarginPerPosition);
                await USDT.connect(other).transfer(marketManager.target, marketCfg.baseConfig.minMarginPerPosition);
                await expect(
                    marketManager.increasePosition(
                        ETHMarketDescriptor.target,
                        other.address,
                        SIDE_SHORT,
                        marketCfg.baseConfig.minMarginPerPosition,
                        marketCfg.baseConfig.minMarginPerPosition * 50n,
                    ),
                ).to.emit(marketManager, "FundingRateGrowthAdjusted");

                await mockPriceFeed.setMinPriceX96(toPriceX96("1008.234", DECIMALS_18, DECIMALS_6));
                await mockPriceFeed.setMaxPriceX96(toPriceX96("1008.235", DECIMALS_18, DECIMALS_6));
                await time.setNextBlockTimestamp(nextHourBegin + 3600 * 3);
                await USDT.mint(other.address, marketCfg.baseConfig.minMarginPerPosition);
                await USDT.connect(other).transfer(marketManager.target, marketCfg.baseConfig.minMarginPerPosition);
                await expect(
                    marketManager.increasePosition(
                        ETHMarketDescriptor.target,
                        other.address,
                        SIDE_LONG,
                        marketCfg.baseConfig.minMarginPerPosition,
                        marketCfg.baseConfig.minMarginPerPosition * 50n,
                    ),
                ).to.emit(marketManager, "FundingRateGrowthAdjusted");

                const previousGlobalFundingRate = await marketManager.previousGlobalFundingRates(
                    ETHMarketDescriptor.target,
                );
                expect(previousGlobalFundingRate.longFundingRateGrowthX96).to.lt(0n);
                expect(previousGlobalFundingRate.shortFundingRateGrowthX96).to.gt(0n);
            });
        });

        describe("#globalFundingRateSamples", () => {
            it("should return empty values for the market has not enabled", async () => {
                const {marketManager, EQUMarketDescriptor} = await loadFixture(deployFixture);
                const globalFundingRateSample = await marketManager.globalFundingRateSamples(
                    EQUMarketDescriptor.target,
                );
                expect(globalFundingRateSample.lastAdjustFundingRateTime).to.eq(0n);
                expect(globalFundingRateSample.sampleCount).to.eq(0n);
                expect(globalFundingRateSample.cumulativePremiumRateX96).to.eq(0n);
            });

            it("should return right last adjust funding rate time for the market being in initial status", async () => {
                const {marketManager, ETHMarketDescriptor} = await loadFixture(deployFixture);
                const globalFundingRateSample = await marketManager.globalFundingRateSamples(
                    ETHMarketDescriptor.target,
                );
                expect(globalFundingRateSample.lastAdjustFundingRateTime).to.gt(0n);
                expect(globalFundingRateSample.sampleCount).to.eq(0n);
                expect(globalFundingRateSample.cumulativePremiumRateX96).to.eq(0n);
            });

            it("should return right values for the market which has sampled funding rate", async () => {
                const {marketManager, ETHMarketDescriptor, USDT, account, marketCfg} = await loadFixture(deployFixture);
                const lastTimestamp = await time.latest();
                const nextHourBegin = lastTimestamp - (lastTimestamp % 3600) + 3600;
                await time.setNextBlockTimestamp(nextHourBegin);
                await USDT.transfer(marketManager.target, marketCfg.baseConfig.minMarginPerLiquidityPosition);
                await marketManager.increaseLiquidityPosition(
                    ETHMarketDescriptor.target,
                    account.address,
                    marketCfg.baseConfig.minMarginPerLiquidityPosition,
                    marketCfg.baseConfig.minMarginPerLiquidityPosition * 2n,
                );

                await time.setNextBlockTimestamp(nextHourBegin + 5);
                await USDT.transfer(marketManager.target, marketCfg.baseConfig.minMarginPerPosition);
                await expect(
                    marketManager.increasePosition(
                        ETHMarketDescriptor.target,
                        account.address,
                        SIDE_LONG,
                        marketCfg.baseConfig.minMarginPerPosition,
                        marketCfg.baseConfig.minMarginPerPosition * 100n,
                    ),
                ).to.emit(marketManager, "GlobalFundingRateSampleAdjusted");

                const globalFundingRateSample = await marketManager.globalFundingRateSamples(
                    ETHMarketDescriptor.target,
                );
                expect(globalFundingRateSample.lastAdjustFundingRateTime).to.gt(0n);
                expect(globalFundingRateSample.sampleCount).to.gt(0n);
                expect(globalFundingRateSample.cumulativePremiumRateX96).to.eq(0n);
            });
        });

        describe("#positions", () => {
            it("should return empty values for the market has not enabled", async () => {
                const {marketManager, EQUMarketDescriptor, account} = await loadFixture(deployFixture);
                const longPosition = await marketManager.positions(
                    EQUMarketDescriptor.target,
                    account.address,
                    SIDE_LONG,
                );
                expect(longPosition.margin).to.eq(0n);
                expect(longPosition.size).to.eq(0n);
                expect(longPosition.entryPriceX96).to.eq(0n);
                expect(longPosition.entryFundingRateGrowthX96).to.eq(0n);

                const shortPosition = await marketManager.positions(
                    EQUMarketDescriptor.target,
                    account.address,
                    SIDE_SHORT,
                );
                expect(shortPosition.margin).to.eq(0n);
                expect(shortPosition.size).to.eq(0n);
                expect(shortPosition.entryPriceX96).to.eq(0n);
                expect(shortPosition.entryFundingRateGrowthX96).to.eq(0n);
            });

            it("should return empty values for the account which has no position", async () => {
                const {marketManager, ETHMarketDescriptor, account} = await loadFixture(deployFixture);
                const longPosition = await marketManager.positions(
                    ETHMarketDescriptor.target,
                    account.address,
                    SIDE_LONG,
                );
                expect(longPosition.margin).to.eq(0n);
                expect(longPosition.size).to.eq(0n);
                expect(longPosition.entryPriceX96).to.eq(0n);
                expect(longPosition.entryFundingRateGrowthX96).to.eq(0n);

                const shortPosition = await marketManager.positions(
                    ETHMarketDescriptor.target,
                    account.address,
                    SIDE_SHORT,
                );
                expect(shortPosition.margin).to.eq(0n);
                expect(shortPosition.size).to.eq(0n);
                expect(shortPosition.entryPriceX96).to.eq(0n);
                expect(shortPosition.entryFundingRateGrowthX96).to.eq(0n);
            });

            it("should return right values for the account which has positions", async () => {
                const {marketManager, ETHMarketDescriptor, USDT, account, marketCfg} = await loadFixture(deployFixture);

                await USDT.transfer(marketManager.target, marketCfg.baseConfig.minMarginPerLiquidityPosition);
                await marketManager.increaseLiquidityPosition(
                    ETHMarketDescriptor.target,
                    account.address,
                    marketCfg.baseConfig.minMarginPerLiquidityPosition,
                    marketCfg.baseConfig.minMarginPerLiquidityPosition,
                );

                await USDT.transfer(marketManager.target, marketCfg.baseConfig.minMarginPerPosition);
                await marketManager.increasePosition(
                    ETHMarketDescriptor.target,
                    account.address,
                    SIDE_LONG,
                    marketCfg.baseConfig.minMarginPerPosition,
                    marketCfg.baseConfig.minMarginPerPosition * 101n,
                );

                await USDT.transfer(marketManager.target, marketCfg.baseConfig.minMarginPerPosition);
                await marketManager.increasePosition(
                    ETHMarketDescriptor.target,
                    account.address,
                    SIDE_SHORT,
                    marketCfg.baseConfig.minMarginPerPosition,
                    marketCfg.baseConfig.minMarginPerPosition * 102n,
                );

                const longPosition = await marketManager.positions(
                    ETHMarketDescriptor.target,
                    account.address,
                    SIDE_LONG,
                );
                expect(longPosition.margin).to.lt(marketCfg.baseConfig.minMarginPerPosition);
                expect(longPosition.size).to.eq(marketCfg.baseConfig.minMarginPerPosition * 101n);
                expect(longPosition.entryPriceX96).to.gt(0n);
                expect(longPosition.entryFundingRateGrowthX96).to.eq(0n);

                const shortPosition = await marketManager.positions(
                    ETHMarketDescriptor.target,
                    account.address,
                    SIDE_SHORT,
                );
                expect(shortPosition.margin).to.lt(marketCfg.baseConfig.minMarginPerPosition);
                expect(shortPosition.size).to.eq(marketCfg.baseConfig.minMarginPerPosition * 102n);
                expect(shortPosition.entryPriceX96).to.gt(0n);
                expect(shortPosition.entryFundingRateGrowthX96).to.eq(0n);
            });
        });

        describe("#priceStates", () => {
            it("should return empty values for the market has not enabled", async () => {
                const {marketManager, EQUMarketDescriptor} = await loadFixture(deployFixture);
                const priceStates = await marketManager.priceStates(EQUMarketDescriptor.target);
                expect(priceStates.premiumRateX96).to.eq(0n);
                expect(priceStates.pendingVertexIndex).to.eq(0n);
                expect(priceStates.currentVertexIndex).to.eq(0n);
                expect(priceStates.basisIndexPriceX96).to.eq(0n);
                priceStates.priceVertices.forEach((v) => {
                    expect(v.size).to.eq(0n);
                    expect(v.premiumRateX96).to.eq(0n);
                });
                priceStates.liquidationBufferNetSizes.forEach((v) => {
                    expect(v).to.eq(0n);
                });
            });

            it("should return empty values for the market which has no position", async () => {
                const {marketManager, ETHMarketDescriptor} = await loadFixture(deployFixture);
                const priceStates = await marketManager.priceStates(ETHMarketDescriptor.target);
                expect(priceStates.premiumRateX96).to.eq(0n);
                expect(priceStates.pendingVertexIndex).to.eq(0n);
                expect(priceStates.currentVertexIndex).to.eq(0n);
                expect(priceStates.basisIndexPriceX96).to.eq(0n);
                priceStates.priceVertices.forEach((v) => {
                    expect(v.size).to.eq(0n);
                    expect(v.premiumRateX96).to.eq(0n);
                });
                priceStates.liquidationBufferNetSizes.forEach((v) => {
                    expect(v).to.eq(0n);
                });
            });

            it("should return right values for the market which has positions", async () => {
                const {marketManager, ETHMarketDescriptor, USDT, account, marketCfg} = await loadFixture(deployFixture);
                await USDT.transfer(marketManager.target, marketCfg.baseConfig.minMarginPerLiquidityPosition);
                await marketManager.increaseLiquidityPosition(
                    ETHMarketDescriptor.target,
                    account.address,
                    marketCfg.baseConfig.minMarginPerLiquidityPosition,
                    marketCfg.baseConfig.minMarginPerLiquidityPosition,
                );

                await USDT.transfer(marketManager.target, marketCfg.baseConfig.minMarginPerPosition);
                await marketManager.increasePosition(
                    ETHMarketDescriptor.target,
                    account.address,
                    SIDE_LONG,
                    marketCfg.baseConfig.minMarginPerPosition,
                    marketCfg.baseConfig.minMarginPerPosition * 100n,
                );

                const priceStates = await marketManager.priceStates(ETHMarketDescriptor.target);
                expect(priceStates.premiumRateX96).to.gt(0n);
                expect(priceStates.pendingVertexIndex).to.eq(0n);
                expect(priceStates.currentVertexIndex).to.eq(1n);
                expect(priceStates.basisIndexPriceX96).to.gt(0n);
                priceStates.priceVertices.forEach((v, i) => {
                    if (i == 0) {
                        expect(v.size).to.eq(0n);
                        expect(v.premiumRateX96).to.eq(0n);
                    } else {
                        expect(v.size).to.gt(0n);
                        expect(v.premiumRateX96).to.gt(0n);
                    }
                });
                priceStates.liquidationBufferNetSizes.forEach((v) => {
                    expect(v).to.eq(0n);
                });
            });
        });

        describe("#protocolFees", () => {
            it("should return zero for the market has not enabled", async () => {
                const {marketManager, EQUMarketDescriptor} = await loadFixture(deployFixture);
                const protocolFees = await marketManager.protocolFees(EQUMarketDescriptor.target);
                expect(protocolFees).to.eq(0n);
            });

            it("should return zero for the market which has no position", async () => {
                const {marketManager, ETHMarketDescriptor} = await loadFixture(deployFixture);
                const protocolFees = await marketManager.protocolFees(ETHMarketDescriptor.target);
                expect(protocolFees).to.eq(0n);
            });

            it("should return positive value for the account which has no position", async () => {
                const {marketManager, ETHMarketDescriptor, USDT, account, marketCfg} = await loadFixture(deployFixture);

                await USDT.transfer(
                    marketManager.target,
                    marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000000000n,
                );
                await marketManager.increaseLiquidityPosition(
                    ETHMarketDescriptor.target,
                    account.address,
                    marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000000000n,
                    marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000000000n,
                );

                await USDT.transfer(marketManager.target, marketCfg.baseConfig.minMarginPerPosition * 100000000n);
                await expect(
                    marketManager.increasePosition(
                        ETHMarketDescriptor.target,
                        account.address,
                        SIDE_SHORT,
                        marketCfg.baseConfig.minMarginPerPosition * 100000000n,
                        marketCfg.baseConfig.minMarginPerPosition * 100000000n,
                    ),
                )
                    .to.emit(marketManager, "ProtocolFeeIncreased")
                    .withArgs(
                        () => true,
                        (v: any) => {
                            expect(v).to.gt(0n);
                            return true;
                        },
                    );

                const protocolFees = await marketManager.protocolFees(ETHMarketDescriptor.target);
                expect(protocolFees).to.gt(0n);
            });
        });

        describe("#referralFees", () => {
            it("should return zero for the market has not enabled", async () => {
                const {marketManager, EQUMarketDescriptor, account, mockEFC} = await loadFixture(deployFixture);
                await mockEFC.setReferrerToken(account.address, 100001n, 10001n);
                const referralFees = await marketManager.referralFees(EQUMarketDescriptor.target, 1000001n);
                expect(referralFees).to.eq(0n);
            });

            it("should return zero for the market which has no position", async () => {
                const {marketManager, ETHMarketDescriptor, account, mockEFC} = await loadFixture(deployFixture);
                await mockEFC.setReferrerToken(account.address, 100001n, 10001n);
                const referralFees = await marketManager.referralFees(ETHMarketDescriptor.target, 100001n);
                expect(referralFees).to.eq(0n);
            });

            it("should return zero for the token which has no fees", async () => {
                const {marketManager, ETHMarketDescriptor, USDT, account, marketCfg, mockEFC} =
                    await loadFixture(deployFixture);
                await mockEFC.setReferrerToken(account.address, 100001n, 10001n);

                await USDT.transfer(
                    marketManager.target,
                    marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000000000n,
                );
                await marketManager.increaseLiquidityPosition(
                    ETHMarketDescriptor.target,
                    account.address,
                    marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000000000n,
                    marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000000000n,
                );

                await USDT.transfer(marketManager.target, marketCfg.baseConfig.minMarginPerPosition * 100000000n);
                await expect(
                    marketManager.increasePosition(
                        ETHMarketDescriptor.target,
                        account.address,
                        SIDE_SHORT,
                        marketCfg.baseConfig.minMarginPerPosition * 100000000n,
                        marketCfg.baseConfig.minMarginPerPosition * 100000000n,
                    ),
                )
                    .to.emit(marketManager, "ReferralFeeIncreased")
                    .withArgs(
                        () => true,
                        () => true,
                        (v: any) => {
                            expect(v).to.eq(100001n);
                            return true;
                        },
                        (v: any) => {
                            expect(v).to.gt(0n);
                            return true;
                        },
                        () => true,
                        () => true,
                    );
                const referralFees = await marketManager.referralFees(ETHMarketDescriptor.target, 100002n);
                expect(referralFees).to.eq(0n);
            });

            it("should return positive value for the token which has fees", async () => {
                const {marketManager, ETHMarketDescriptor, USDT, account, marketCfg, mockEFC} =
                    await loadFixture(deployFixture);
                await mockEFC.setReferrerToken(account.address, 100001n, 10001n);

                await USDT.transfer(
                    marketManager.target,
                    marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000000000n,
                );
                await marketManager.increaseLiquidityPosition(
                    ETHMarketDescriptor.target,
                    account.address,
                    marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000000000n,
                    marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000000000n,
                );

                await USDT.transfer(marketManager.target, marketCfg.baseConfig.minMarginPerPosition * 100000000n);
                await expect(
                    marketManager.increasePosition(
                        ETHMarketDescriptor.target,
                        account.address,
                        SIDE_SHORT,
                        marketCfg.baseConfig.minMarginPerPosition * 100000000n,
                        marketCfg.baseConfig.minMarginPerPosition * 100000000n,
                    ),
                )
                    .to.emit(marketManager, "ReferralFeeIncreased")
                    .withArgs(
                        () => true,
                        () => true,
                        (v: any) => {
                            expect(v).to.eq(100001n);
                            return true;
                        },
                        (v: any) => {
                            expect(v).to.gt(0n);
                            return true;
                        },
                        (v: any) => {
                            expect(v).to.eq(10001n);
                            return true;
                        },
                        (v: any) => {
                            expect(v).to.gt(0n);
                            return true;
                        },
                    );

                const referralFees = await marketManager.referralFees(ETHMarketDescriptor.target, 100001n);
                expect(referralFees).to.gt(0n);
                const referralParentFees = await marketManager.referralFees(ETHMarketDescriptor.target, 10001n);
                expect(referralParentFees).to.gt(0n);
            });
        });

        describe("#marketPriceX96s", () => {
            it("should return the price x96 got from price feed for the market has not enabled", async () => {
                const {marketManager, EQUMarketDescriptor, mockPriceFeed} = await loadFixture(deployFixture);
                const marketLongPriceX96 = await marketManager.marketPriceX96s(EQUMarketDescriptor.target, SIDE_LONG);
                expect(marketLongPriceX96).to.eq(await mockPriceFeed.getMaxPriceX96(EQUMarketDescriptor.target));
                const marketShortPriceX96 = await marketManager.marketPriceX96s(EQUMarketDescriptor.target, SIDE_SHORT);
                expect(marketShortPriceX96).to.eq(await mockPriceFeed.getMinPriceX96(EQUMarketDescriptor.target));
            });

            it("should return the price x96 got from price feed for the market which has no position", async () => {
                const {marketManager, ETHMarketDescriptor, mockPriceFeed} = await loadFixture(deployFixture);
                const marketLongPriceX96 = await marketManager.marketPriceX96s(ETHMarketDescriptor.target, SIDE_LONG);
                expect(marketLongPriceX96).to.eq(await mockPriceFeed.getMaxPriceX96(ETHMarketDescriptor.target));
                const marketShortPriceX96 = await marketManager.marketPriceX96s(ETHMarketDescriptor.target, SIDE_SHORT);
                expect(marketShortPriceX96).to.eq(await mockPriceFeed.getMinPriceX96(ETHMarketDescriptor.target));
            });
        });

        describe("#globalLiquidationFunds", () => {
            it("should return empty values for the market has not enabled", async () => {
                const {marketManager, EQUMarketDescriptor} = await loadFixture(deployFixture);
                const globalLiquidationFund = await marketManager.globalLiquidationFunds(EQUMarketDescriptor.target);
                expect(globalLiquidationFund.liquidationFund).to.eq(0n);
                expect(globalLiquidationFund.liquidity).to.eq(0n);
            });

            it("should return empty values for the market which has no position", async () => {
                const {marketManager, ETHMarketDescriptor} = await loadFixture(deployFixture);
                const globalLiquidationFund = await marketManager.globalLiquidationFunds(ETHMarketDescriptor.target);
                expect(globalLiquidationFund.liquidationFund).to.eq(0n);
                expect(globalLiquidationFund.liquidity).to.eq(0n);
            });

            it("should return right values for the market which has liquidation fund positions", async () => {
                const {marketManager, ETHMarketDescriptor, USDT, account, marketCfg} = await loadFixture(deployFixture);
                await USDT.transfer(marketManager.target, marketCfg.baseConfig.minMarginPerPosition);
                await marketManager.increaseLiquidationFundPosition(
                    ETHMarketDescriptor.target,
                    account.address,
                    marketCfg.baseConfig.minMarginPerPosition,
                );

                const globalLiquidationFund = await marketManager.globalLiquidationFunds(ETHMarketDescriptor.target);
                expect(globalLiquidationFund.liquidationFund).to.eq(marketCfg.baseConfig.minMarginPerPosition);
                expect(globalLiquidationFund.liquidity).to.eq(marketCfg.baseConfig.minMarginPerPosition);
            });
        });

        describe("#liquidationFundPositions", () => {
            it("should return zero for the market has not enabled", async () => {
                const {marketManager, EQUMarketDescriptor, account} = await loadFixture(deployFixture);
                const liquidationFundPosition = await marketManager.liquidationFundPositions(
                    EQUMarketDescriptor.target,
                    account.address,
                );
                expect(liquidationFundPosition).to.eq(0n);
            });

            it("should return zero for the market which has no position", async () => {
                const {marketManager, ETHMarketDescriptor, account} = await loadFixture(deployFixture);
                const liquidationFundPosition = await marketManager.liquidationFundPositions(
                    ETHMarketDescriptor.target,
                    account.address,
                );
                expect(liquidationFundPosition).to.eq(0n);
            });

            it("should return right values for the market which has liquidation fund positions", async () => {
                const {marketManager, ETHMarketDescriptor, USDT, account, marketCfg} = await loadFixture(deployFixture);
                await USDT.transfer(marketManager.target, marketCfg.baseConfig.minMarginPerPosition);
                await marketManager.increaseLiquidationFundPosition(
                    ETHMarketDescriptor.target,
                    account.address,
                    marketCfg.baseConfig.minMarginPerPosition,
                );

                const liquidationFundPosition = await marketManager.liquidationFundPositions(
                    ETHMarketDescriptor.target,
                    account.address,
                );
                expect(liquidationFundPosition).to.eq(marketCfg.baseConfig.minMarginPerPosition);
            });
        });
    });

    describe("#increaseLiquidityPosition", () => {
        it("should revert if caller is not the router", async () => {
            const {marketManager, ETHMarketDescriptor, marketCfg, USDT, account, other, router} =
                await loadFixture(deployFixture);
            await USDT.transfer(marketManager.target, marketCfg.baseConfig.minMarginPerLiquidityPosition);
            await expect(
                marketManager
                    .connect(other)
                    .increaseLiquidityPosition(
                        ETHMarketDescriptor.target,
                        account.address,
                        marketCfg.baseConfig.minMarginPerLiquidityPosition,
                        marketCfg.baseConfig.minMarginPerLiquidityPosition,
                    ),
            )
                .to.revertedWithCustomError(marketManager, "InvalidCaller")
                .withArgs(router.address);
        });

        it("should revert if the balance that transfer in is not enough", async () => {
            const {marketManager, ETHMarketDescriptor, marketCfg, USDT, account} = await loadFixture(deployFixture);
            await USDT.transfer(marketManager.target, marketCfg.baseConfig.minMarginPerLiquidityPosition - 1n);
            await expect(
                marketManager.increaseLiquidityPosition(
                    ETHMarketDescriptor.target,
                    account.address,
                    marketCfg.baseConfig.minMarginPerLiquidityPosition,
                    marketCfg.baseConfig.minMarginPerLiquidityPosition,
                ),
            )
                .to.revertedWithCustomError(marketManager, "InsufficientBalance")
                .withArgs(0, marketCfg.baseConfig.minMarginPerLiquidityPosition);
        });

        it("should sample funding rate if time delta is greater than 5 seconds", async () => {
            const {marketManager, ETHMarketDescriptor, marketCfg, USDT, account} = await loadFixture(deployFixture);
            const lastTimestamp = await time.latest();
            const nextHourBegin = lastTimestamp - (lastTimestamp % 3600) + 3600;
            await time.setNextBlockTimestamp(nextHourBegin);
            await marketManager.sampleAndAdjustFundingRate(ETHMarketDescriptor.target);
            await time.setNextBlockTimestamp(nextHourBegin + 6);
            await USDT.transfer(marketManager.target, marketCfg.baseConfig.minMarginPerLiquidityPosition);
            await expect(
                marketManager.increaseLiquidityPosition(
                    ETHMarketDescriptor.target,
                    account.address,
                    marketCfg.baseConfig.minMarginPerLiquidityPosition,
                    marketCfg.baseConfig.minMarginPerLiquidityPosition,
                ),
            ).to.emit(marketManager, "GlobalFundingRateSampleAdjusted");
        });

        it("should adjust funding rate if time delta is greater than 3600 seconds", async () => {
            const {marketManager, ETHMarketDescriptor, marketCfg, USDT, account} = await loadFixture(deployFixture);
            const lastTimestamp = await time.latest();
            const nextHourBegin = lastTimestamp - (lastTimestamp % 3600) + 3600;
            await time.setNextBlockTimestamp(nextHourBegin);
            await marketManager.sampleAndAdjustFundingRate(ETHMarketDescriptor.target);
            await time.setNextBlockTimestamp(nextHourBegin + 3606);
            await USDT.transfer(marketManager.target, marketCfg.baseConfig.minMarginPerLiquidityPosition);
            await expect(
                marketManager.increaseLiquidityPosition(
                    ETHMarketDescriptor.target,
                    account.address,
                    marketCfg.baseConfig.minMarginPerLiquidityPosition,
                    marketCfg.baseConfig.minMarginPerLiquidityPosition,
                ),
            ).to.emit(marketManager, "FundingRateGrowthAdjusted");
        });

        it("should update usd balance if margin delta is positive", async () => {
            const {marketManager, ETHMarketDescriptor, marketCfg, USDT, account} = await loadFixture(deployFixture);
            expect(await marketManager.usdBalance()).to.eq(0n);
            await USDT.transfer(marketManager.target, marketCfg.baseConfig.minMarginPerLiquidityPosition);
            await marketManager.increaseLiquidityPosition(
                ETHMarketDescriptor.target,
                account.address,
                marketCfg.baseConfig.minMarginPerLiquidityPosition,
                marketCfg.baseConfig.minMarginPerLiquidityPosition,
            );
            expect(await marketManager.usdBalance()).to.eq(marketCfg.baseConfig.minMarginPerLiquidityPosition);
        });

        it("should increase liquidity position", async () => {
            const {marketManager, ETHMarketDescriptor, marketCfg, USDT, account} = await loadFixture(deployFixture);
            expect(await marketManager.usdBalance()).to.eq(0n);
            await USDT.transfer(marketManager.target, marketCfg.baseConfig.minMarginPerLiquidityPosition);
            await expect(
                marketManager.increaseLiquidityPosition(
                    ETHMarketDescriptor.target,
                    account.address,
                    marketCfg.baseConfig.minMarginPerLiquidityPosition,
                    marketCfg.baseConfig.minMarginPerLiquidityPosition,
                ),
            ).to.emit(marketManager, "LiquidityPositionIncreased");
        });

        it("should change price vertices if liquidity delta is positive", async () => {
            const {marketManager, ETHMarketDescriptor, marketCfg, USDT, account} = await loadFixture(deployFixture);
            expect(await marketManager.usdBalance()).to.eq(0n);
            await USDT.transfer(marketManager.target, marketCfg.baseConfig.minMarginPerLiquidityPosition);
            await expect(
                marketManager.increaseLiquidityPosition(
                    ETHMarketDescriptor.target,
                    account.address,
                    marketCfg.baseConfig.minMarginPerLiquidityPosition,
                    marketCfg.baseConfig.minMarginPerLiquidityPosition,
                ),
            ).to.emit(marketManager, "PriceVertexChanged");
        });

        it("should change max size if liquidity delta is positive", async () => {
            const {marketManager, ETHMarketDescriptor, marketCfg, USDT, account} = await loadFixture(deployFixture);
            expect(await marketManager.usdBalance()).to.eq(0n);
            await USDT.transfer(marketManager.target, marketCfg.baseConfig.minMarginPerLiquidityPosition);
            await expect(
                marketManager.increaseLiquidityPosition(
                    ETHMarketDescriptor.target,
                    account.address,
                    marketCfg.baseConfig.minMarginPerLiquidityPosition,
                    marketCfg.baseConfig.minMarginPerLiquidityPosition,
                ),
            ).to.emit(marketManager, "GlobalPositionSizeChanged");
        });
    });

    describe("#decreaseLiquidityPosition", () => {
        it("should revert if caller is not the router", async () => {
            const {marketManager, ETHMarketDescriptor, marketCfg, USDT, account, other, router} =
                await loadFixture(deployFixture);

            await USDT.connect(account).transfer(
                marketManager.target,
                marketCfg.baseConfig.minMarginPerLiquidityPosition,
            );
            await marketManager.increaseLiquidityPosition(
                ETHMarketDescriptor.target,
                account.address,
                marketCfg.baseConfig.minMarginPerLiquidityPosition,
                marketCfg.baseConfig.minMarginPerLiquidityPosition,
            );

            await expect(
                marketManager
                    .connect(other)
                    .decreaseLiquidityPosition(
                        ETHMarketDescriptor.target,
                        account.address,
                        0n,
                        marketCfg.baseConfig.minMarginPerLiquidityPosition,
                        account.address,
                    ),
            )
                .to.revertedWithCustomError(marketManager, "InvalidCaller")
                .withArgs(router.address);
        });

        it("should sample funding rate if time delta is greater than 5 seconds", async () => {
            const {marketManager, ETHMarketDescriptor, marketCfg, USDT, account} = await loadFixture(deployFixture);
            const lastTimestamp = await time.latest();
            const nextHourBegin = lastTimestamp - (lastTimestamp % 3600) + 3600;
            await time.setNextBlockTimestamp(nextHourBegin);
            await USDT.connect(account).transfer(
                marketManager.target,
                marketCfg.baseConfig.minMarginPerLiquidityPosition,
            );
            await marketManager.increaseLiquidityPosition(
                ETHMarketDescriptor.target,
                account.address,
                marketCfg.baseConfig.minMarginPerLiquidityPosition,
                marketCfg.baseConfig.minMarginPerLiquidityPosition,
            );

            await time.setNextBlockTimestamp(nextHourBegin + 6);
            await expect(
                marketManager.decreaseLiquidityPosition(
                    ETHMarketDescriptor.target,
                    account.address,
                    0n,
                    marketCfg.baseConfig.minMarginPerLiquidityPosition,
                    account.address,
                ),
            ).to.emit(marketManager, "GlobalFundingRateSampleAdjusted");
        });

        it("should adjust funding rate if time delta is greater than 3600 seconds", async () => {
            const {marketManager, ETHMarketDescriptor, marketCfg, USDT, account} = await loadFixture(deployFixture);
            const lastTimestamp = await time.latest();
            const nextHourBegin = lastTimestamp - (lastTimestamp % 3600) + 3600;
            await time.setNextBlockTimestamp(nextHourBegin);
            await USDT.connect(account).transfer(
                marketManager.target,
                marketCfg.baseConfig.minMarginPerLiquidityPosition,
            );
            await marketManager.increaseLiquidityPosition(
                ETHMarketDescriptor.target,
                account.address,
                marketCfg.baseConfig.minMarginPerLiquidityPosition,
                marketCfg.baseConfig.minMarginPerLiquidityPosition,
            );

            await time.setNextBlockTimestamp(nextHourBegin + 3606);
            await expect(
                marketManager.decreaseLiquidityPosition(
                    ETHMarketDescriptor.target,
                    account.address,
                    0n,
                    marketCfg.baseConfig.minMarginPerLiquidityPosition,
                    account.address,
                ),
            ).to.emit(marketManager, "FundingRateGrowthAdjusted");
        });

        it("should decrease liquidity position", async () => {
            const {marketManager, ETHMarketDescriptor, marketCfg, USDT, account, other} =
                await loadFixture(deployFixture);
            await USDT.connect(account).transfer(
                marketManager.target,
                marketCfg.baseConfig.minMarginPerLiquidityPosition,
            );
            await marketManager.increaseLiquidityPosition(
                ETHMarketDescriptor.target,
                account.address,
                marketCfg.baseConfig.minMarginPerLiquidityPosition,
                marketCfg.baseConfig.minMarginPerLiquidityPosition,
            );

            await expect(
                marketManager.decreaseLiquidityPosition(
                    ETHMarketDescriptor.target,
                    account.address,
                    0n,
                    marketCfg.baseConfig.minMarginPerLiquidityPosition,
                    other.address,
                ),
            ).to.emit(marketManager, "LiquidityPositionDecreased");
        });

        it("should transfer final margin delta to receiver if it is positive", async () => {
            const {marketManager, ETHMarketDescriptor, marketCfg, USDT, account, other} =
                await loadFixture(deployFixture);
            await USDT.connect(account).transfer(
                marketManager.target,
                marketCfg.baseConfig.minMarginPerLiquidityPosition,
            );
            await marketManager.increaseLiquidityPosition(
                ETHMarketDescriptor.target,
                account.address,
                marketCfg.baseConfig.minMarginPerLiquidityPosition,
                marketCfg.baseConfig.minMarginPerLiquidityPosition,
            );

            expect(await USDT.balanceOf(other.address)).to.eq(0n);
            let marginDelta = 0n;
            await expect(
                marketManager.decreaseLiquidityPosition(
                    ETHMarketDescriptor.target,
                    account.address,
                    0n,
                    marketCfg.baseConfig.minMarginPerLiquidityPosition,
                    other.address,
                ),
            )
                .to.emit(marketManager, "LiquidityPositionDecreased")
                .withArgs(
                    () => true,
                    () => true,
                    (v: BigNumberish) => {
                        expect(v).to.gt(0n);
                        marginDelta += toBigInt(v);
                        return true;
                    },
                    () => true,
                    () => true,
                    () => true,
                    () => true,
                );
            expect(await USDT.balanceOf(other.address)).to.eq(marginDelta);
        });

        it("should change price vertices if liquidity delta is positive", async () => {
            const {marketManager, ETHMarketDescriptor, marketCfg, USDT, account, other} =
                await loadFixture(deployFixture);
            await USDT.connect(account).transfer(
                marketManager.target,
                marketCfg.baseConfig.minMarginPerLiquidityPosition,
            );
            await marketManager.increaseLiquidityPosition(
                ETHMarketDescriptor.target,
                account.address,
                marketCfg.baseConfig.minMarginPerLiquidityPosition,
                marketCfg.baseConfig.minMarginPerLiquidityPosition,
            );

            await expect(
                marketManager.decreaseLiquidityPosition(
                    ETHMarketDescriptor.target,
                    account.address,
                    0n,
                    marketCfg.baseConfig.minMarginPerLiquidityPosition,
                    other.address,
                ),
            ).to.emit(marketManager, "PriceVertexChanged");
        });

        it("should change max size if liquidity delta is positive", async () => {
            const {marketManager, ETHMarketDescriptor, marketCfg, USDT, account, other} =
                await loadFixture(deployFixture);
            await USDT.connect(account).transfer(
                marketManager.target,
                marketCfg.baseConfig.minMarginPerLiquidityPosition,
            );
            await marketManager.increaseLiquidityPosition(
                ETHMarketDescriptor.target,
                account.address,
                marketCfg.baseConfig.minMarginPerLiquidityPosition,
                marketCfg.baseConfig.minMarginPerLiquidityPosition,
            );

            await expect(
                marketManager.decreaseLiquidityPosition(
                    ETHMarketDescriptor.target,
                    account.address,
                    0n,
                    marketCfg.baseConfig.minMarginPerLiquidityPosition,
                    other.address,
                ),
            ).to.emit(marketManager, "GlobalPositionSizeChanged");
        });
    });

    describe("#liquidateLiquidityPosition", () => {
        it("should revert if caller is not the router", async () => {
            const {marketManager, ETHMarketDescriptor, marketCfg, USDT, account, other, router} =
                await loadFixture(deployFixture);

            await USDT.connect(account).transfer(
                marketManager.target,
                marketCfg.baseConfig.minMarginPerLiquidityPosition,
            );
            await marketManager.increaseLiquidityPosition(
                ETHMarketDescriptor.target,
                account.address,
                marketCfg.baseConfig.minMarginPerLiquidityPosition,
                marketCfg.baseConfig.minMarginPerLiquidityPosition,
            );

            await expect(
                marketManager
                    .connect(other)
                    .liquidateLiquidityPosition(ETHMarketDescriptor.target, account.address, account.address),
            )
                .to.revertedWithCustomError(marketManager, "InvalidCaller")
                .withArgs(router.address);
        });

        it("should sample funding rate if time delta is greater than 5 seconds", async () => {
            const {marketManager, ETHMarketDescriptor, marketCfg, USDT, account, other, other2, mockPriceFeed} =
                await loadFixture(deployFixture);
            await mockPriceFeed.setMinPriceX96(toPriceX96("1", DECIMALS_18, DECIMALS_6));
            await mockPriceFeed.setMaxPriceX96(toPriceX96("1", DECIMALS_18, DECIMALS_6) + 1n);
            await USDT.connect(account).transfer(
                marketManager.target,
                marketCfg.baseConfig.minMarginPerLiquidityPosition * 100n,
            );
            await marketManager.increaseLiquidityPosition(
                ETHMarketDescriptor.target,
                account.address,
                marketCfg.baseConfig.minMarginPerLiquidityPosition * 100n,
                marketCfg.baseConfig.minMarginPerLiquidityPosition * 20000n,
            );
            await USDT.mint(other.address, marketCfg.baseConfig.minMarginPerLiquidityPosition);
            await USDT.connect(other).transfer(
                marketManager.target,
                marketCfg.baseConfig.minMarginPerLiquidityPosition,
            );
            await marketManager.increaseLiquidityPosition(
                ETHMarketDescriptor.target,
                other.address,
                marketCfg.baseConfig.minMarginPerLiquidityPosition,
                marketCfg.baseConfig.minMarginPerLiquidityPosition,
            );
            const lastTimestamp = await time.latest();
            const nextHourBegin = lastTimestamp - (lastTimestamp % 3600) + 3600;
            await time.setNextBlockTimestamp(nextHourBegin);
            await USDT.mint(other2.address, marketCfg.baseConfig.minMarginPerPosition * 100n);
            await USDT.connect(other2).transfer(marketManager.target, marketCfg.baseConfig.minMarginPerPosition * 100n);
            await marketManager.increasePosition(
                ETHMarketDescriptor.target,
                other2.address,
                SIDE_LONG,
                marketCfg.baseConfig.minMarginPerPosition * 100n,
                toPriceX96("1", DECIMALS_18, DECIMALS_6) * 1600n,
            );

            await mockPriceFeed.setMinPriceX96(toPriceX96("1", DECIMALS_18, DECIMALS_6) * 12n);
            await mockPriceFeed.setMaxPriceX96((toPriceX96("1", DECIMALS_18, DECIMALS_6) + 1n) * 12n);
            await time.setNextBlockTimestamp(nextHourBegin + 6);
            await expect(
                marketManager.liquidateLiquidityPosition(ETHMarketDescriptor.target, account.address, other.address),
            ).to.emit(marketManager, "GlobalFundingRateSampleAdjusted");
        });

        it("should adjust funding rate if time delta is greater than 3600 seconds", async () => {
            const {marketManager, ETHMarketDescriptor, marketCfg, USDT, account, other, other2, mockPriceFeed} =
                await loadFixture(deployFixture);
            await mockPriceFeed.setMinPriceX96(toPriceX96("1", DECIMALS_18, DECIMALS_6));
            await mockPriceFeed.setMaxPriceX96(toPriceX96("1", DECIMALS_18, DECIMALS_6) + 1n);
            await USDT.connect(account).transfer(
                marketManager.target,
                marketCfg.baseConfig.minMarginPerLiquidityPosition * 100n,
            );
            await marketManager.increaseLiquidityPosition(
                ETHMarketDescriptor.target,
                account.address,
                marketCfg.baseConfig.minMarginPerLiquidityPosition * 100n,
                marketCfg.baseConfig.minMarginPerLiquidityPosition * 20000n,
            );
            await USDT.mint(other.address, marketCfg.baseConfig.minMarginPerLiquidityPosition);
            await USDT.connect(other).transfer(
                marketManager.target,
                marketCfg.baseConfig.minMarginPerLiquidityPosition,
            );
            await marketManager.increaseLiquidityPosition(
                ETHMarketDescriptor.target,
                other.address,
                marketCfg.baseConfig.minMarginPerLiquidityPosition,
                marketCfg.baseConfig.minMarginPerLiquidityPosition,
            );
            const lastTimestamp = await time.latest();
            const nextHourBegin = lastTimestamp - (lastTimestamp % 3600) + 3600;
            await time.setNextBlockTimestamp(nextHourBegin);
            await USDT.mint(other2.address, marketCfg.baseConfig.minMarginPerPosition * 100n);
            await USDT.connect(other2).transfer(marketManager.target, marketCfg.baseConfig.minMarginPerPosition * 100n);
            await marketManager.increasePosition(
                ETHMarketDescriptor.target,
                other2.address,
                SIDE_LONG,
                marketCfg.baseConfig.minMarginPerPosition * 100n,
                toPriceX96("1", DECIMALS_18, DECIMALS_6) * 1600n,
            );

            await mockPriceFeed.setMinPriceX96(toPriceX96("1", DECIMALS_18, DECIMALS_6) * 12n);
            await mockPriceFeed.setMaxPriceX96((toPriceX96("1", DECIMALS_18, DECIMALS_6) + 1n) * 12n);
            await time.setNextBlockTimestamp(nextHourBegin + 3606);
            await expect(
                marketManager.liquidateLiquidityPosition(ETHMarketDescriptor.target, account.address, other.address),
            ).to.emit(marketManager, "FundingRateGrowthAdjusted");
        });

        it("should pass", async () => {
            const {marketManager, ETHMarketDescriptor, marketCfg, USDT, account, other, other2, mockPriceFeed} =
                await loadFixture(deployFixture);
            await mockPriceFeed.setMinPriceX96(toPriceX96("1", DECIMALS_18, DECIMALS_6));
            await mockPriceFeed.setMaxPriceX96(toPriceX96("1", DECIMALS_18, DECIMALS_6) + 1n);
            await USDT.connect(account).transfer(
                marketManager.target,
                marketCfg.baseConfig.minMarginPerLiquidityPosition * 100n,
            );
            await marketManager.increaseLiquidityPosition(
                ETHMarketDescriptor.target,
                account.address,
                marketCfg.baseConfig.minMarginPerLiquidityPosition * 100n,
                marketCfg.baseConfig.minMarginPerLiquidityPosition * 20000n,
            );
            await USDT.mint(other.address, marketCfg.baseConfig.minMarginPerLiquidityPosition);
            await USDT.connect(other).transfer(
                marketManager.target,
                marketCfg.baseConfig.minMarginPerLiquidityPosition,
            );
            await marketManager.increaseLiquidityPosition(
                ETHMarketDescriptor.target,
                other.address,
                marketCfg.baseConfig.minMarginPerLiquidityPosition,
                marketCfg.baseConfig.minMarginPerLiquidityPosition,
            );

            await USDT.mint(other2.address, marketCfg.baseConfig.minMarginPerPosition * 100n);
            await USDT.connect(other2).transfer(marketManager.target, marketCfg.baseConfig.minMarginPerPosition * 100n);
            await marketManager.increasePosition(
                ETHMarketDescriptor.target,
                other2.address,
                SIDE_LONG,
                marketCfg.baseConfig.minMarginPerPosition * 100n,
                toPriceX96("1", DECIMALS_18, DECIMALS_6) * 1600n,
            );

            await mockPriceFeed.setMinPriceX96(toPriceX96("1", DECIMALS_18, DECIMALS_6) * 6n);
            await mockPriceFeed.setMaxPriceX96((toPriceX96("1", DECIMALS_18, DECIMALS_6) + 1n) * 6n);

            expect(await USDT.balanceOf(other.address)).to.eq(0n);
            const assertion = expect(
                marketManager.liquidateLiquidityPosition(ETHMarketDescriptor.target, account.address, other.address),
            );
            await assertion.to.emit(marketManager, "LiquidityPositionLiquidated");
            await assertion.to.emit(marketManager, "PriceVertexChanged");
            await assertion.to.emit(marketManager, "GlobalPositionSizeChanged");
            expect(await USDT.balanceOf(other.address)).to.eq(marketCfg.baseConfig.liquidationExecutionFee);
        });
    });

    describe("#govUseLiquidationFund", () => {
        it("should revert if caller is not the gov", async () => {
            const {marketManager, ETHMarketDescriptor, account, other, gov} = await loadFixture(deployFixture);

            await expect(
                marketManager.connect(other).govUseLiquidationFund(ETHMarketDescriptor.target, account.address, 1n),
            ).to.revertedWithCustomError(marketManager, "Forbidden");
        });

        it("should update global liquidation fund and transfer liquidation fund used by gov out to receiver", async () => {
            const {marketManager, ETHMarketDescriptor, USDT, marketCfg, account, other, other2, mockPriceFeed} =
                await loadFixture(deployFixture);

            await USDT.transfer(marketManager.target, 10000000n);
            await marketManager.increaseLiquidationFundPosition(ETHMarketDescriptor.target, account.address, 10000000n);

            {
                // try to increase some global liquidation fund

                await mockPriceFeed.setMinPriceX96(toPriceX96("1", DECIMALS_18, DECIMALS_6));
                await mockPriceFeed.setMaxPriceX96(toPriceX96("1", DECIMALS_18, DECIMALS_6) + 1n);
                await USDT.connect(account).transfer(
                    marketManager.target,
                    marketCfg.baseConfig.minMarginPerLiquidityPosition * 100n,
                );
                await marketManager.increaseLiquidityPosition(
                    ETHMarketDescriptor.target,
                    account.address,
                    marketCfg.baseConfig.minMarginPerLiquidityPosition * 100n,
                    marketCfg.baseConfig.minMarginPerLiquidityPosition * 20000n,
                );
                await USDT.mint(other.address, marketCfg.baseConfig.minMarginPerLiquidityPosition);
                await USDT.connect(other).transfer(
                    marketManager.target,
                    marketCfg.baseConfig.minMarginPerLiquidityPosition,
                );
                await marketManager.increaseLiquidityPosition(
                    ETHMarketDescriptor.target,
                    other.address,
                    marketCfg.baseConfig.minMarginPerLiquidityPosition,
                    marketCfg.baseConfig.minMarginPerLiquidityPosition,
                );

                await USDT.mint(other2.address, marketCfg.baseConfig.minMarginPerPosition * 100n);
                await USDT.connect(other2).transfer(
                    marketManager.target,
                    marketCfg.baseConfig.minMarginPerPosition * 100n,
                );
                await marketManager.increasePosition(
                    ETHMarketDescriptor.target,
                    other2.address,
                    SIDE_LONG,
                    marketCfg.baseConfig.minMarginPerPosition * 100n,
                    toPriceX96("1", DECIMALS_18, DECIMALS_6) * 1600n,
                );

                await mockPriceFeed.setMinPriceX96(toPriceX96("1", DECIMALS_18, DECIMALS_6) * 6n);
                await mockPriceFeed.setMaxPriceX96((toPriceX96("1", DECIMALS_18, DECIMALS_6) + 1n) * 6n);

                await expect(
                    marketManager.liquidateLiquidityPosition(
                        ETHMarketDescriptor.target,
                        account.address,
                        other2.address,
                    ),
                )
                    .to.emit(marketManager, "LiquidityPositionLiquidated")
                    .withArgs(
                        () => true,
                        () => true,
                        () => true,
                        (v: BigNumberish) => {
                            expect(v).to.gt(0);
                            return true;
                        },
                        () => true,
                        () => true,
                    );
                expect((await marketManager.globalLiquidationFunds(ETHMarketDescriptor.target)).liquidationFund).to.gt(
                    10000000n,
                );
            }

            expect(await USDT.balanceOf(other.address)).to.eq(0n);
            await expect(
                marketManager.govUseLiquidationFund(ETHMarketDescriptor.target, other.address, 10000n),
            ).to.emit(marketManager, "GlobalLiquidationFundGovUsed");
            expect(await USDT.balanceOf(other.address)).to.eq(10000n);
        });
    });

    describe("#increaseLiquidationFundPosition", () => {
        it("should revert if caller is not the router", async () => {
            const {marketManager, ETHMarketDescriptor, USDT, account, other, router} = await loadFixture(deployFixture);

            await USDT.connect(account).transfer(marketManager.target, 100n);
            await expect(
                marketManager
                    .connect(other)
                    .increaseLiquidationFundPosition(ETHMarketDescriptor.target, account.address, 100n),
            )
                .to.revertedWithCustomError(marketManager, "InvalidCaller")
                .withArgs(router.address);
        });

        it("should revert if the balance than transfer in is not enough", async () => {
            const {marketManager, ETHMarketDescriptor, USDT, account} = await loadFixture(deployFixture);

            await USDT.connect(account).transfer(marketManager.target, 100n);
            await expect(
                marketManager.increaseLiquidationFundPosition(ETHMarketDescriptor.target, account.address, 101n),
            )
                .to.revertedWithCustomError(marketManager, "InsufficientBalance")
                .withArgs(0n, 101n);
        });

        it("should pass", async () => {
            const {marketManager, ETHMarketDescriptor, USDT, account} = await loadFixture(deployFixture);

            {
                expect(await marketManager.usdBalance()).to.eq(0n);
                const globalLiquidationFund = await marketManager.globalLiquidationFunds(ETHMarketDescriptor.target);
                expect(globalLiquidationFund.liquidationFund).to.eq(0n);
                expect(globalLiquidationFund.liquidity).to.eq(0n);
            }
            await USDT.connect(account).transfer(marketManager.target, 100n);
            await expect(
                marketManager.increaseLiquidationFundPosition(ETHMarketDescriptor.target, account.address, 100n),
            ).to.emit(marketManager, "LiquidationFundPositionIncreased");
            {
                expect(await marketManager.usdBalance()).to.eq(100n);
                const globalLiquidationFundAfter = await marketManager.globalLiquidationFunds(
                    ETHMarketDescriptor.target,
                );
                expect(globalLiquidationFundAfter.liquidationFund).to.eq(100n);
                expect(globalLiquidationFundAfter.liquidity).to.eq(100n);
            }
        });
    });

    describe("#decreaseLiquidationFundPosition", () => {
        it("should revert if caller is not the router", async () => {
            const {marketManager, ETHMarketDescriptor, USDT, account, other, router} = await loadFixture(deployFixture);

            await USDT.connect(account).transfer(marketManager.target, 100n);
            await marketManager.increaseLiquidationFundPosition(ETHMarketDescriptor.target, account.address, 100n);
            await expect(
                marketManager
                    .connect(other)
                    .decreaseLiquidationFundPosition(
                        ETHMarketDescriptor.target,
                        account.address,
                        100n,
                        account.address,
                    ),
            )
                .to.revertedWithCustomError(marketManager, "InvalidCaller")
                .withArgs(router.address);
        });

        it("should revert if the liquidity delta is greater than the liquidity of the liquidation fund position", async () => {
            const {marketManager, ETHMarketDescriptor, USDT, account} = await loadFixture(deployFixture);

            await USDT.connect(account).transfer(marketManager.target, 100n);
            await marketManager.increaseLiquidationFundPosition(ETHMarketDescriptor.target, account.address, 100n);
            await expect(
                marketManager.decreaseLiquidationFundPosition(
                    ETHMarketDescriptor.target,
                    account.address,
                    101n,
                    account.address,
                ),
            )
                .to.revertedWithCustomError(marketManager, "InsufficientLiquidityToDecrease")
                .withArgs(100n, 101n);
        });

        it("should revert if the global liquidation fund is less than the liquidity of the global liquidation fund", async () => {
            const {marketManager, ETHMarketDescriptor, marketCfg, USDT, account, other, mockPriceFeed} =
                await loadFixture(deployFixture);

            await USDT.connect(account).transfer(marketManager.target, 100n * 10n ** 8n);
            await marketManager.increaseLiquidationFundPosition(
                ETHMarketDescriptor.target,
                account.address,
                100n * 10n ** 8n,
            );

            {
                // try to use some liquidation fund for paying part of the loss for position liquidating
                await mockPriceFeed.setMinPriceX96(toPriceX96("1", DECIMALS_18, DECIMALS_6));
                await mockPriceFeed.setMaxPriceX96(toPriceX96("1", DECIMALS_18, DECIMALS_6) + 1n);

                await USDT.transfer(marketManager.target, marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n);
                await marketManager.increaseLiquidityPosition(
                    ETHMarketDescriptor.target,
                    account.address,
                    marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
                    marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
                );

                await USDT.transfer(marketManager.target, marketCfg.baseConfig.minMarginPerPosition);
                await marketManager.increasePosition(
                    ETHMarketDescriptor.target,
                    account.address,
                    SIDE_SHORT,
                    marketCfg.baseConfig.minMarginPerPosition,
                    toPriceX96("1", DECIMALS_18, DECIMALS_6) * 600n,
                );

                await mockPriceFeed.setMinPriceX96(toPriceX96("1", DECIMALS_18, DECIMALS_6) * 2n);
                await mockPriceFeed.setMaxPriceX96((toPriceX96("1", DECIMALS_18, DECIMALS_6) + 1n) * 2n);
                await USDT.transfer(marketManager.target, marketCfg.baseConfig.minMarginPerPosition);
                await marketManager.liquidatePosition(
                    ETHMarketDescriptor.target,
                    account.address,
                    SIDE_SHORT,
                    other.address,
                );
                expect((await marketManager.globalLiquidationFunds(ETHMarketDescriptor.target)).liquidationFund).to.lt(
                    100n * 10n ** 8n,
                );
            }

            await expect(
                marketManager.decreaseLiquidationFundPosition(
                    ETHMarketDescriptor.target,
                    account.address,
                    10n * 10n ** 8n,
                    account.address,
                ),
            ).to.revertedWithCustomError(marketManager, "LiquidationFundLoss");
        });

        it("should pass", async () => {
            const {marketManager, ETHMarketDescriptor, USDT, account, other} = await loadFixture(deployFixture);

            await USDT.connect(account).transfer(marketManager.target, 100n);
            await marketManager.increaseLiquidationFundPosition(ETHMarketDescriptor.target, account.address, 100n);

            {
                expect(await USDT.balanceOf(other.address)).to.eq(0n);
                expect(await marketManager.liquidationFundPositions(ETHMarketDescriptor.target, account.address)).to.eq(
                    100n,
                );
                const globalLiquidationFund = await marketManager.globalLiquidationFunds(ETHMarketDescriptor.target);
                expect(globalLiquidationFund.liquidity).to.eq(100n);
                expect(globalLiquidationFund.liquidationFund).to.eq(100n);
            }
            await expect(
                marketManager.decreaseLiquidationFundPosition(
                    ETHMarketDescriptor.target,
                    account.address,
                    50n,
                    other.address,
                ),
            ).to.emit(marketManager, "LiquidationFundPositionDecreased");
            {
                expect(await USDT.balanceOf(other.address)).to.eq(50n);
                expect(await marketManager.liquidationFundPositions(ETHMarketDescriptor.target, account.address)).to.eq(
                    50n,
                );
                const globalLiquidationFund = await marketManager.globalLiquidationFunds(ETHMarketDescriptor.target);
                expect(globalLiquidationFund.liquidity).to.eq(50n);
                expect(globalLiquidationFund.liquidationFund).to.eq(50n);
            }
            await expect(
                marketManager.decreaseLiquidationFundPosition(
                    ETHMarketDescriptor.target,
                    account.address,
                    50n,
                    other.address,
                ),
            ).to.emit(marketManager, "LiquidationFundPositionDecreased");
            {
                expect(await USDT.balanceOf(other.address)).to.eq(100n);
                expect(await marketManager.liquidationFundPositions(ETHMarketDescriptor.target, account.address)).to.eq(
                    0n,
                );
                const globalLiquidationFund = await marketManager.globalLiquidationFunds(ETHMarketDescriptor.target);
                expect(globalLiquidationFund.liquidity).to.eq(0n);
                expect(globalLiquidationFund.liquidationFund).to.eq(0n);
            }
        });
    });

    describe("#increasePosition", () => {
        it("should revert if caller is not the router", async () => {
            const {marketManager, ETHMarketDescriptor, marketCfg, USDT, account, other, router} =
                await loadFixture(deployFixture);

            await USDT.connect(account).transfer(
                marketManager.target,
                marketCfg.baseConfig.minMarginPerLiquidityPosition,
            );
            await marketManager.increaseLiquidityPosition(
                ETHMarketDescriptor.target,
                account.address,
                marketCfg.baseConfig.minMarginPerLiquidityPosition,
                marketCfg.baseConfig.minMarginPerLiquidityPosition,
            );

            await USDT.connect(account).transfer(marketManager.target, marketCfg.baseConfig.minMarginPerPosition);
            await expect(
                marketManager
                    .connect(other)
                    .increasePosition(
                        ETHMarketDescriptor.target,
                        account.address,
                        SIDE_LONG,
                        marketCfg.baseConfig.minMarginPerPosition,
                        marketCfg.baseConfig.minMarginPerPosition * 200n,
                    ),
            )
                .to.revertedWithCustomError(marketManager, "InvalidCaller")
                .withArgs(router.address);
        });

        it("should sample funding rate if time delta is greater than 5 seconds", async () => {
            const {marketManager, ETHMarketDescriptor, marketCfg, USDT, account} = await loadFixture(deployFixture);

            const lastTimestamp = await time.latest();
            const nextHourBegin = lastTimestamp - (lastTimestamp % 3600) + 3600;
            await time.setNextBlockTimestamp(nextHourBegin);
            await USDT.transfer(marketManager.target, marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n);
            await marketManager.increaseLiquidityPosition(
                ETHMarketDescriptor.target,
                account.address,
                marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
                marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
            );

            await time.setNextBlockTimestamp(nextHourBegin + 6);
            await USDT.transfer(marketManager.target, marketCfg.baseConfig.minMarginPerPosition);
            await expect(
                marketManager.increasePosition(
                    ETHMarketDescriptor.target,
                    account.address,
                    SIDE_LONG,
                    marketCfg.baseConfig.minMarginPerPosition,
                    marketCfg.baseConfig.minMarginPerPosition,
                ),
            ).to.emit(marketManager, "GlobalFundingRateSampleAdjusted");
        });

        it("should adjust funding rate if time delta is greater than 3600 seconds", async () => {
            const {marketManager, ETHMarketDescriptor, marketCfg, USDT, account} = await loadFixture(deployFixture);

            const lastTimestamp = await time.latest();
            const nextHourBegin = lastTimestamp - (lastTimestamp % 3600) + 3600;
            await time.setNextBlockTimestamp(nextHourBegin);
            await USDT.transfer(marketManager.target, marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n);
            await marketManager.increaseLiquidityPosition(
                ETHMarketDescriptor.target,
                account.address,
                marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
                marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
            );

            await time.setNextBlockTimestamp(nextHourBegin + 3606);
            await USDT.transfer(marketManager.target, marketCfg.baseConfig.minMarginPerPosition);
            await expect(
                marketManager.increasePosition(
                    ETHMarketDescriptor.target,
                    account.address,
                    SIDE_LONG,
                    marketCfg.baseConfig.minMarginPerPosition,
                    marketCfg.baseConfig.minMarginPerPosition,
                ),
            ).to.emit(marketManager, "FundingRateGrowthAdjusted");
        });

        it("should pass", async () => {
            const {marketManager, ETHMarketDescriptor, marketCfg, USDT, account} = await loadFixture(deployFixture);
            await USDT.transfer(marketManager.target, marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n);
            await marketManager.increaseLiquidityPosition(
                ETHMarketDescriptor.target,
                account.address,
                marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
                marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
            );

            const lastTimestamp = await time.latest();
            const nextHourBegin = lastTimestamp - (lastTimestamp % 3600) + 3600;
            await time.setNextBlockTimestamp(nextHourBegin + 3606);
            expect(await marketManager.usdBalance()).to.eq(marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n);
            await USDT.transfer(marketManager.target, marketCfg.baseConfig.minMarginPerPosition);
            await expect(
                marketManager.increasePosition(
                    ETHMarketDescriptor.target,
                    account.address,
                    SIDE_LONG,
                    marketCfg.baseConfig.minMarginPerPosition,
                    marketCfg.baseConfig.minMarginPerPosition,
                ),
            ).to.emit(marketManager, "PositionIncreased");

            expect(await marketManager.usdBalance()).to.eq(
                marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n + marketCfg.baseConfig.minMarginPerPosition,
            );
        });
    });

    describe("#decreasePosition", () => {
        it("should revert if caller is not the router", async () => {
            const {marketManager, ETHMarketDescriptor, marketCfg, USDT, account, other, router} =
                await loadFixture(deployFixture);

            await USDT.connect(account).transfer(
                marketManager.target,
                marketCfg.baseConfig.minMarginPerLiquidityPosition,
            );
            await marketManager.increaseLiquidityPosition(
                ETHMarketDescriptor.target,
                account.address,
                marketCfg.baseConfig.minMarginPerLiquidityPosition,
                marketCfg.baseConfig.minMarginPerLiquidityPosition,
            );

            await USDT.connect(account).transfer(marketManager.target, marketCfg.baseConfig.minMarginPerPosition);
            await marketManager.increasePosition(
                ETHMarketDescriptor.target,
                account.address,
                SIDE_LONG,
                marketCfg.baseConfig.minMarginPerPosition,
                marketCfg.baseConfig.minMarginPerPosition * 200n,
            );

            await expect(
                marketManager
                    .connect(other)
                    .decreasePosition(
                        ETHMarketDescriptor.target,
                        account.address,
                        SIDE_LONG,
                        0n,
                        marketCfg.baseConfig.minMarginPerPosition * 200n,
                        account.address,
                    ),
            )
                .to.revertedWithCustomError(marketManager, "InvalidCaller")
                .withArgs(router.address);
        });

        it("should sample funding rate if time delta is greater than 5 seconds", async () => {
            const {marketManager, ETHMarketDescriptor, marketCfg, USDT, account} = await loadFixture(deployFixture);
            await USDT.transfer(marketManager.target, marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n);
            await marketManager.increaseLiquidityPosition(
                ETHMarketDescriptor.target,
                account.address,
                marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
                marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
            );

            const lastTimestamp = await time.latest();
            const nextHourBegin = lastTimestamp - (lastTimestamp % 3600) + 3600;
            await time.setNextBlockTimestamp(nextHourBegin);
            await USDT.transfer(marketManager.target, marketCfg.baseConfig.minMarginPerPosition * 100n);
            await marketManager.increasePosition(
                ETHMarketDescriptor.target,
                account.address,
                SIDE_LONG,
                marketCfg.baseConfig.minMarginPerPosition * 100n,
                marketCfg.baseConfig.minMarginPerPosition * 300n,
            );

            await time.setNextBlockTimestamp(nextHourBegin + 6);
            await USDT.transfer(marketManager.target, marketCfg.baseConfig.minMarginPerPosition);
            await expect(
                marketManager.decreasePosition(
                    ETHMarketDescriptor.target,
                    account.address,
                    SIDE_LONG,
                    0n,
                    marketCfg.baseConfig.minMarginPerPosition * 300n,
                    account.address,
                ),
            ).to.emit(marketManager, "GlobalFundingRateSampleAdjusted");
        });

        it("should adjust funding rate if time delta is greater than 3600 seconds", async () => {
            const {marketManager, ETHMarketDescriptor, marketCfg, USDT, account} = await loadFixture(deployFixture);
            await USDT.transfer(marketManager.target, marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n);
            await marketManager.increaseLiquidityPosition(
                ETHMarketDescriptor.target,
                account.address,
                marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
                marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
            );

            const lastTimestamp = await time.latest();
            const nextHourBegin = lastTimestamp - (lastTimestamp % 3600) + 3600;
            await time.setNextBlockTimestamp(nextHourBegin);
            await USDT.transfer(marketManager.target, marketCfg.baseConfig.minMarginPerPosition * 100n);
            await marketManager.increasePosition(
                ETHMarketDescriptor.target,
                account.address,
                SIDE_LONG,
                marketCfg.baseConfig.minMarginPerPosition * 100n,
                marketCfg.baseConfig.minMarginPerPosition * 300n,
            );

            await time.setNextBlockTimestamp(nextHourBegin + 3606);
            await USDT.transfer(marketManager.target, marketCfg.baseConfig.minMarginPerPosition);
            await expect(
                marketManager.decreasePosition(
                    ETHMarketDescriptor.target,
                    account.address,
                    SIDE_LONG,
                    0n,
                    marketCfg.baseConfig.minMarginPerPosition * 300n,
                    account.address,
                ),
            ).to.emit(marketManager, "FundingRateGrowthAdjusted");
        });

        it("should pass", async () => {
            const {marketManager, ETHMarketDescriptor, marketCfg, USDT, account, other} =
                await loadFixture(deployFixture);
            await USDT.transfer(marketManager.target, marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n);
            await marketManager.increaseLiquidityPosition(
                ETHMarketDescriptor.target,
                account.address,
                marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
                marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
            );

            await USDT.transfer(marketManager.target, marketCfg.baseConfig.minMarginPerPosition * 100n);
            await marketManager.increasePosition(
                ETHMarketDescriptor.target,
                account.address,
                SIDE_LONG,
                marketCfg.baseConfig.minMarginPerPosition * 100n,
                marketCfg.baseConfig.minMarginPerPosition * 300n,
            );

            expect(await marketManager.usdBalance()).to.eq(
                marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n +
                    marketCfg.baseConfig.minMarginPerPosition * 100n,
            );
            expect(await USDT.balanceOf(other.address)).to.eq(0n);
            await expect(
                marketManager.decreasePosition(
                    ETHMarketDescriptor.target,
                    account.address,
                    SIDE_LONG,
                    0n,
                    marketCfg.baseConfig.minMarginPerPosition * 300n,
                    other.address,
                ),
            ).to.emit(marketManager, "PositionDecreased");
            const balanceOfOther = await USDT.balanceOf(other.address);
            expect(balanceOfOther).to.gt(0n);
            expect(await marketManager.usdBalance()).to.eq(
                marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n +
                    marketCfg.baseConfig.minMarginPerPosition * 100n -
                    balanceOfOther,
            );
        });
    });

    describe("#liquidatePosition", () => {
        it("should revert if caller is not the router", async () => {
            const {marketManager, ETHMarketDescriptor, marketCfg, USDT, account, other, router} =
                await loadFixture(deployFixture);

            await USDT.connect(account).transfer(
                marketManager.target,
                marketCfg.baseConfig.minMarginPerLiquidityPosition,
            );
            await marketManager.increaseLiquidityPosition(
                ETHMarketDescriptor.target,
                account.address,
                marketCfg.baseConfig.minMarginPerLiquidityPosition,
                marketCfg.baseConfig.minMarginPerLiquidityPosition,
            );

            await USDT.connect(account).transfer(marketManager.target, marketCfg.baseConfig.minMarginPerPosition);
            await marketManager.increasePosition(
                ETHMarketDescriptor.target,
                account.address,
                SIDE_LONG,
                marketCfg.baseConfig.minMarginPerPosition,
                marketCfg.baseConfig.minMarginPerPosition * 200n,
            );

            await expect(
                marketManager
                    .connect(other)
                    .liquidatePosition(ETHMarketDescriptor.target, account.address, SIDE_LONG, account.address),
            )
                .to.revertedWithCustomError(marketManager, "InvalidCaller")
                .withArgs(router.address);
        });

        it("should sample funding rate if time delta is greater than 5 seconds", async () => {
            const {marketManager, ETHMarketDescriptor, marketCfg, USDT, account, mockPriceFeed} =
                await loadFixture(deployFixture);
            await mockPriceFeed.setMinPriceX96(toPriceX96("1", DECIMALS_18, DECIMALS_6));
            await mockPriceFeed.setMaxPriceX96(toPriceX96("1", DECIMALS_18, DECIMALS_6) + 1n);

            await USDT.transfer(marketManager.target, marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n);
            await marketManager.increaseLiquidityPosition(
                ETHMarketDescriptor.target,
                account.address,
                marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
                marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
            );

            const lastTimestamp = await time.latest();
            const nextHourBegin = lastTimestamp - (lastTimestamp % 3600) + 3600;
            await time.setNextBlockTimestamp(nextHourBegin);
            await USDT.transfer(marketManager.target, marketCfg.baseConfig.minMarginPerPosition);
            await marketManager.increasePosition(
                ETHMarketDescriptor.target,
                account.address,
                SIDE_SHORT,
                marketCfg.baseConfig.minMarginPerPosition,
                toPriceX96("1", DECIMALS_18, DECIMALS_6) * 600n,
            );

            await mockPriceFeed.setMinPriceX96(toPriceX96("1", DECIMALS_18, DECIMALS_6) * 2n);
            await mockPriceFeed.setMaxPriceX96((toPriceX96("1", DECIMALS_18, DECIMALS_6) + 1n) * 2n);
            await time.setNextBlockTimestamp(nextHourBegin + 6);
            await USDT.transfer(marketManager.target, marketCfg.baseConfig.minMarginPerPosition);
            await expect(
                marketManager.liquidatePosition(
                    ETHMarketDescriptor.target,
                    account.address,
                    SIDE_SHORT,
                    account.address,
                ),
            ).to.emit(marketManager, "GlobalFundingRateSampleAdjusted");
        });

        it("should adjust funding rate if time delta is greater than 3600 seconds", async () => {
            const {marketManager, ETHMarketDescriptor, marketCfg, USDT, account, mockPriceFeed} =
                await loadFixture(deployFixture);
            await mockPriceFeed.setMinPriceX96(toPriceX96("1", DECIMALS_18, DECIMALS_6));
            await mockPriceFeed.setMaxPriceX96(toPriceX96("1", DECIMALS_18, DECIMALS_6) + 1n);

            await USDT.transfer(marketManager.target, marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n);
            await marketManager.increaseLiquidityPosition(
                ETHMarketDescriptor.target,
                account.address,
                marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
                marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
            );

            const lastTimestamp = await time.latest();
            const nextHourBegin = lastTimestamp - (lastTimestamp % 3600) + 3600;
            await time.setNextBlockTimestamp(nextHourBegin);
            await USDT.transfer(marketManager.target, marketCfg.baseConfig.minMarginPerPosition);
            await marketManager.increasePosition(
                ETHMarketDescriptor.target,
                account.address,
                SIDE_SHORT,
                marketCfg.baseConfig.minMarginPerPosition,
                toPriceX96("1", DECIMALS_18, DECIMALS_6) * 600n,
            );

            await mockPriceFeed.setMinPriceX96(toPriceX96("1", DECIMALS_18, DECIMALS_6) * 2n);
            await mockPriceFeed.setMaxPriceX96((toPriceX96("1", DECIMALS_18, DECIMALS_6) + 1n) * 2n);
            await time.setNextBlockTimestamp(nextHourBegin + 3606);
            await USDT.transfer(marketManager.target, marketCfg.baseConfig.minMarginPerPosition);
            await expect(
                marketManager.liquidatePosition(
                    ETHMarketDescriptor.target,
                    account.address,
                    SIDE_SHORT,
                    account.address,
                ),
            ).to.emit(marketManager, "FundingRateGrowthAdjusted");
        });

        it("should pass", async () => {
            const {marketManager, ETHMarketDescriptor, marketCfg, USDT, account, other, mockPriceFeed} =
                await loadFixture(deployFixture);
            await mockPriceFeed.setMinPriceX96(toPriceX96("1", DECIMALS_18, DECIMALS_6));
            await mockPriceFeed.setMaxPriceX96(toPriceX96("1", DECIMALS_18, DECIMALS_6) + 1n);

            await USDT.transfer(marketManager.target, marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n);
            await marketManager.increaseLiquidityPosition(
                ETHMarketDescriptor.target,
                account.address,
                marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
                marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
            );

            await USDT.transfer(marketManager.target, marketCfg.baseConfig.minMarginPerPosition);
            await marketManager.increasePosition(
                ETHMarketDescriptor.target,
                account.address,
                SIDE_SHORT,
                marketCfg.baseConfig.minMarginPerPosition,
                toPriceX96("1", DECIMALS_18, DECIMALS_6) * 600n,
            );

            await mockPriceFeed.setMinPriceX96(toPriceX96("1", DECIMALS_18, DECIMALS_6) * 2n);
            await mockPriceFeed.setMaxPriceX96((toPriceX96("1", DECIMALS_18, DECIMALS_6) + 1n) * 2n);
            expect(await USDT.balanceOf(other.address)).to.eq(0n);
            expect(await marketManager.usdBalance()).to.eq(
                marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n + marketCfg.baseConfig.minMarginPerPosition,
            );
            await USDT.transfer(marketManager.target, marketCfg.baseConfig.minMarginPerPosition);
            await expect(
                marketManager.liquidatePosition(ETHMarketDescriptor.target, account.address, SIDE_SHORT, other.address),
            ).to.emit(marketManager, "PositionLiquidated");
            expect(await USDT.balanceOf(other.address)).to.eq(marketCfg.baseConfig.liquidationExecutionFee);
            expect(await marketManager.usdBalance()).to.eq(
                marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n +
                    marketCfg.baseConfig.minMarginPerPosition -
                    marketCfg.baseConfig.liquidationExecutionFee,
            );
        });

        describe("extreme situation", () => {
            it("should pass if realizedPnL is positive but margin is not enough to pay funding fee", async () => {
                const {marketManager, ETHMarketDescriptor, marketCfg, USDT, account, other, mockPriceFeed} =
                    await loadFixture(deployFixture);
                await mockPriceFeed.setMinPriceX96(toPriceX96("1", DECIMALS_18, DECIMALS_6));
                await mockPriceFeed.setMaxPriceX96(toPriceX96("1", DECIMALS_18, DECIMALS_6) + 1n);

                {
                    // Try to make the market state reach our desired scene state

                    const lastTimestamp = await time.latest();
                    let nextHourBegin = lastTimestamp - (lastTimestamp % 3600) + 3600;
                    await time.setNextBlockTimestamp(nextHourBegin);
                    await USDT.transfer(
                        marketManager.target,
                        marketCfg.baseConfig.minMarginPerLiquidityPosition * 100n,
                    );
                    await marketManager.increaseLiquidityPosition(
                        ETHMarketDescriptor.target,
                        account.address,
                        marketCfg.baseConfig.minMarginPerLiquidityPosition * 100n,
                        marketCfg.baseConfig.minMarginPerLiquidityPosition * 100n,
                    );

                    await time.setNextBlockTimestamp(nextHourBegin + 5);
                    await USDT.mint(other.address, marketCfg.baseConfig.minMarginPerPosition);
                    await USDT.connect(other).transfer(marketManager.target, marketCfg.baseConfig.minMarginPerPosition);
                    await marketManager.increasePosition(
                        ETHMarketDescriptor.target,
                        other.address,
                        SIDE_SHORT,
                        marketCfg.baseConfig.minMarginPerPosition,
                        marketCfg.baseConfig.minMarginPerPosition * 9900000000000n,
                    );

                    await time.setNextBlockTimestamp(nextHourBegin + 10);
                    await USDT.transfer(marketManager.target, marketCfg.baseConfig.minMarginPerPosition);
                    await marketManager.increasePosition(
                        ETHMarketDescriptor.target,
                        account.address,
                        SIDE_LONG,
                        marketCfg.baseConfig.minMarginPerPosition,
                        marketCfg.baseConfig.minMarginPerPosition,
                    );

                    await time.setNextBlockTimestamp(nextHourBegin + 15);
                    await marketManager.decreasePosition(
                        ETHMarketDescriptor.target,
                        account.address,
                        SIDE_LONG,
                        0,
                        marketCfg.baseConfig.minMarginPerPosition - 1n,
                        account.address,
                    );

                    await mockPriceFeed.setMinPriceX96(toPriceX96("0.997", DECIMALS_18, DECIMALS_6));
                    await mockPriceFeed.setMaxPriceX96(toPriceX96("0.997", DECIMALS_18, DECIMALS_6) + 1n);

                    for (let i = 1; i < 100; i++) {
                        await time.setNextBlockTimestamp(nextHourBegin + 3600 * i);
                        await expect(marketManager.sampleAndAdjustFundingRate(ETHMarketDescriptor.target)).to.emit(
                            marketManager,
                            "FundingRateGrowthAdjusted",
                        );
                    }
                }

                {
                    // currently, when the position is liquidating:
                    //      required funding fee is -11395501,
                    //      position margin is 9950640,
                    //      realizedPnL is 16899
                }

                await marketManager.liquidatePosition(
                    ETHMarketDescriptor.target,
                    other.address,
                    SIDE_SHORT,
                    other.address,
                );
            });
        });
    });

    describe("#sampleAndAdjustFundingRate", () => {
        it("should revert if caller is not the router", async () => {
            const {marketManager, ETHMarketDescriptor, other, router} = await loadFixture(deployFixture);

            await expect(marketManager.connect(other).sampleAndAdjustFundingRate(ETHMarketDescriptor.target))
                .to.revertedWithCustomError(marketManager, "InvalidCaller")
                .withArgs(router.address);
        });

        it("should do nothing if time delta is less than 5 seconds", async () => {
            const {marketManager, ETHMarketDescriptor} = await loadFixture(deployFixture);

            const lastTimestamp = await time.latest();
            const nextHourBegin = lastTimestamp - (lastTimestamp % 3600) + 3600;
            await time.setNextBlockTimestamp(nextHourBegin);
            await marketManager.sampleAndAdjustFundingRate(ETHMarketDescriptor.target);
            await time.setNextBlockTimestamp(nextHourBegin + 4);
            const assertion = expect(marketManager.sampleAndAdjustFundingRate(ETHMarketDescriptor.target));
            await assertion.to.not.emit(marketManager, "GlobalFundingRateSampleAdjusted");
            await assertion.to.not.emit(marketManager, "FundingRateGrowthAdjusted");
        });

        it("should sample funding rate if time delta is greater than 5 seconds", async () => {
            const {marketManager, ETHMarketDescriptor} = await loadFixture(deployFixture);

            const lastTimestamp = await time.latest();
            const nextHourBegin = lastTimestamp - (lastTimestamp % 3600) + 3600;
            await time.setNextBlockTimestamp(nextHourBegin + 6);
            await expect(marketManager.sampleAndAdjustFundingRate(ETHMarketDescriptor.target)).to.emit(
                marketManager,
                "GlobalFundingRateSampleAdjusted",
            );
        });

        it("should adjust funding rate if time delta is greater than 3600 seconds", async () => {
            const {marketManager, ETHMarketDescriptor} = await loadFixture(deployFixture);

            const lastTimestamp = await time.latest();
            const nextHourBegin = lastTimestamp - (lastTimestamp % 3600) + 3600;
            await time.setNextBlockTimestamp(nextHourBegin + 3606);
            await expect(marketManager.sampleAndAdjustFundingRate(ETHMarketDescriptor.target)).to.emit(
                marketManager,
                "FundingRateGrowthAdjusted",
            );
        });
    });

    describe("#setPriceFeed", () => {
        it("should revert if caller is not the gov", async () => {
            const {marketManager, other, mockPriceFeed} = await loadFixture(deployFixture);

            await expect(marketManager.connect(other).setPriceFeed(mockPriceFeed.target)).to.revertedWithCustomError(
                marketManager,
                "Forbidden",
            );
        });

        it("should pass", async () => {
            const {marketManager, mockPriceFeed} = await loadFixture(deployFixture);

            await expect(marketManager.setPriceFeed(mockPriceFeed.target))
                .to.emit(marketManager, "PriceFeedChanged")
                .withArgs(mockPriceFeed.target, mockPriceFeed.target);
        });
    });

    describe("#changePriceVertex", () => {
        it("should revert if caller is not its self", async () => {
            const {marketManager, ETHMarketDescriptor, other} = await loadFixture(deployFixture);

            await expect(marketManager.connect(other).changePriceVertex(ETHMarketDescriptor.target, 1, 2))
                .to.revertedWithCustomError(marketManager, "InvalidCaller")
                .withArgs(marketManager.target);
        });
    });

    describe("#collectProtocolFee", () => {
        it("should pass", async () => {
            const {marketManager, ETHMarketDescriptor, marketCfg, USDT, account, mockFeeDistributor} =
                await loadFixture(deployFixture);
            {
                // try to make protocol fee to have some value
                await USDT.transfer(
                    marketManager.target,
                    marketCfg.baseConfig.minMarginPerLiquidityPosition * 10000000n,
                );
                await marketManager.increaseLiquidityPosition(
                    ETHMarketDescriptor.target,
                    account.address,
                    marketCfg.baseConfig.minMarginPerLiquidityPosition * 10000000n,
                    marketCfg.baseConfig.minMarginPerLiquidityPosition * 10000000n,
                );

                const lastTimestamp = await time.latest();
                const nextHourBegin = lastTimestamp - (lastTimestamp % 3600) + 3600;
                await time.setNextBlockTimestamp(nextHourBegin + 3606);
                await USDT.transfer(marketManager.target, marketCfg.baseConfig.minMarginPerPosition * 10000000n);
                await marketManager.increasePosition(
                    ETHMarketDescriptor.target,
                    account.address,
                    SIDE_LONG,
                    marketCfg.baseConfig.minMarginPerPosition * 10000000n,
                    marketCfg.baseConfig.minMarginPerPosition * 10000000n,
                );
                expect(await marketManager.protocolFees(ETHMarketDescriptor.target)).to.gt(0n);
            }

            {
                expect(await USDT.balanceOf(mockFeeDistributor.target)).to.eq(0n);
                expect(await marketManager.usdBalance()).to.eq(
                    marketCfg.baseConfig.minMarginPerLiquidityPosition * 10000000n +
                        marketCfg.baseConfig.minMarginPerPosition * 10000000n,
                );
            }
            const protocolFee = await marketManager.protocolFees(ETHMarketDescriptor.target);
            await expect(marketManager.collectProtocolFee(ETHMarketDescriptor.target))
                .to.emit(marketManager, "ProtocolFeeCollected")
                .withArgs(ETHMarketDescriptor.target, protocolFee);
            {
                expect(await USDT.balanceOf(mockFeeDistributor.target)).to.eq(protocolFee);
                expect(await marketManager.usdBalance()).to.eq(
                    marketCfg.baseConfig.minMarginPerLiquidityPosition * 10000000n +
                        marketCfg.baseConfig.minMarginPerPosition * 10000000n -
                        protocolFee,
                );
                expect(await marketManager.protocolFees(ETHMarketDescriptor.target)).to.eq(0n);
            }
        });
    });

    describe("#collectReferralFee", () => {
        it("should revert if caller is not its self", async () => {
            const {marketManager, ETHMarketDescriptor, other, gov} = await loadFixture(deployFixture);

            await expect(
                marketManager.connect(other).collectReferralFee(ETHMarketDescriptor.target, 10001n, other.address),
            )
                .to.revertedWithCustomError(marketManager, "InvalidCaller")
                .withArgs(gov.address);
        });

        it("should pass", async () => {
            const {marketManager, ETHMarketDescriptor, marketCfg, USDT, account, other, mockEFC} =
                await loadFixture(deployFixture);
            {
                // try to make referral fee to have some value
                await mockEFC.setReferrerToken(account.address, 100001n, 10001n);
                await USDT.transfer(
                    marketManager.target,
                    marketCfg.baseConfig.minMarginPerLiquidityPosition * 10000000n,
                );
                await marketManager.increaseLiquidityPosition(
                    ETHMarketDescriptor.target,
                    account.address,
                    marketCfg.baseConfig.minMarginPerLiquidityPosition * 10000000n,
                    marketCfg.baseConfig.minMarginPerLiquidityPosition * 10000000n,
                );

                const lastTimestamp = await time.latest();
                const nextHourBegin = lastTimestamp - (lastTimestamp % 3600) + 3600;
                await time.setNextBlockTimestamp(nextHourBegin + 3606);
                await USDT.transfer(marketManager.target, marketCfg.baseConfig.minMarginPerPosition * 10000000n);
                await marketManager.increasePosition(
                    ETHMarketDescriptor.target,
                    account.address,
                    SIDE_LONG,
                    marketCfg.baseConfig.minMarginPerPosition * 10000000n,
                    marketCfg.baseConfig.minMarginPerPosition * 10000000n,
                );
                expect(await marketManager.referralFees(ETHMarketDescriptor.target, 100001n)).to.gt(0n);
            }

            {
                expect(await USDT.balanceOf(other.address)).to.eq(0n);
                expect(await marketManager.usdBalance()).to.eq(
                    marketCfg.baseConfig.minMarginPerLiquidityPosition * 10000000n +
                        marketCfg.baseConfig.minMarginPerPosition * 10000000n,
                );
            }
            const referralFee = await marketManager.referralFees(ETHMarketDescriptor.target, 100001n);
            await expect(marketManager.collectReferralFee(ETHMarketDescriptor.target, 100001n, other.address))
                .to.emit(marketManager, "ReferralFeeCollected")
                .withArgs(ETHMarketDescriptor.target, 100001n, other.address, referralFee);
            {
                expect(await USDT.balanceOf(other.address)).to.eq(referralFee);
                expect(await marketManager.usdBalance()).to.eq(
                    marketCfg.baseConfig.minMarginPerLiquidityPosition * 10000000n +
                        marketCfg.baseConfig.minMarginPerPosition * 10000000n -
                        referralFee,
                );
                expect(await marketManager.protocolFees(other.address)).to.eq(0n);
            }
        });
    });
});
