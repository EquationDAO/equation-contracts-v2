import {ethers} from "hardhat";
import {loadFixture, time} from "@nomicfoundation/hardhat-network-helpers";
import {expect} from "chai";
import {
    BASIS_POINTS_DIVISOR,
    DECIMALS_18,
    DECIMALS_6,
    isLongSide,
    isShortSide,
    mulDiv,
    Q64,
    Q96,
    Rounding,
    Side,
    SIDE_LONG,
    SIDE_SHORT,
    toPriceX96,
} from "../shared/Constants";
import {newMarketConfig} from "../shared/MarketConfig";
import {MarketDescriptor} from "../../typechain-types";
import Decimal from "decimal.js";

describe("PositionUtil", () => {
    async function deployFixture() {
        const [account, other] = await ethers.getSigners();

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

        const positionUtil = await ethers.deployContract("PositionUtilTest", {
            libraries: {
                PositionUtil: _positionUtil.target,
                LiquidityPositionUtil: _liquidityPositionUtil.target,
                ConfigurableUtil: _configurableUtil.target,
                FundingRateUtil: _fundingRateUtil.target,
            },
        });
        await positionUtil.waitForDeployment();
        await positionUtil.setPriceFeed(mockPriceFeed.target);
        const marketCfg = newMarketConfig();
        await positionUtil.enableMarket(ETHMarketDescriptor.target, marketCfg);
        await positionUtil.setGlobalPosition({
            longSize: 1,
            shortSize: 2,
            maxSize: 3,
            maxSizePerPosition: 4,
            longFundingRateGrowthX96: 5,
            shortFundingRateGrowthX96: 6,
        });

        return {
            account,
            other,
            ETHMarketDescriptor,
            marketCfg,
            positionUtil,
            _positionUtil,
            _marketUtil,
            mockEFC,
            mockPriceFeed,
        };
    }

    describe("#distributeFee", () => {
        it("should return zero if trading fee is zero and liquidation fee is zero", async () => {
            const {positionUtil, ETHMarketDescriptor, account} = await loadFixture(deployFixture);
            await positionUtil.distributeFee({
                market: ETHMarketDescriptor.target,
                account: account.address,
                sizeDelta: 0n,
                tradePriceX96: toPriceX96("1808.235", DECIMALS_18, DECIMALS_6),
                tradingFeeState: {
                    tradingFeeRate: 50_000n,
                    referralReturnFeeRate: 10_000_000n,
                    referralParentReturnFeeRate: 1_000_000n,
                    referralToken: 0n,
                    referralParentToken: 0n,
                },
                liquidationFee: 0n,
            });
            expect(await positionUtil.tradingFee()).to.eq(0);
        });

        it("should emit ProtocolFeeIncreased event if trading fee is positive", async () => {
            const {positionUtil, _positionUtil, ETHMarketDescriptor, account, marketCfg, mockPriceFeed} =
                await loadFixture(deployFixture);

            await positionUtil.increaseLiquidityPosition({
                market: ETHMarketDescriptor.target,
                account: account,
                marginDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
                liquidityDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
                priceFeed: mockPriceFeed,
            });

            const tradingFee = await positionUtil.calculateTradingFee(
                10n ** 18n,
                toPriceX96("1808.235", DECIMALS_18, DECIMALS_6),
                50_000n,
            );
            const protocolFee = (tradingFee * 30_000_000n) / BASIS_POINTS_DIVISOR;

            await expect(
                positionUtil.distributeFee({
                    market: ETHMarketDescriptor.target,
                    account: account.address,
                    sizeDelta: 10n ** 18n,
                    tradePriceX96: toPriceX96("1808.235", DECIMALS_18, DECIMALS_6),
                    tradingFeeState: {
                        tradingFeeRate: 50_000n,
                        referralReturnFeeRate: 10_000_000n,
                        referralParentReturnFeeRate: 1_000_000n,
                        referralToken: 0n,
                        referralParentToken: 0n,
                    },
                    liquidationFee: 600_000n,
                }),
            )
                .to.emit(_positionUtil.attach(positionUtil.target), "ProtocolFeeIncreased")
                .withArgs(ETHMarketDescriptor.target, protocolFee);

            expect(await positionUtil.tradingFee()).to.gt(0n);
            expect((await positionUtil.state()).protocolFee).to.eq(protocolFee);
        });

        it("should increase referral fees and emit ReferralFeeIncreased event when referral token is positive", async () => {
            const {positionUtil, _positionUtil, ETHMarketDescriptor, account, marketCfg, mockPriceFeed} =
                await loadFixture(deployFixture);

            await positionUtil.increaseLiquidityPosition({
                market: ETHMarketDescriptor.target,
                account: account,
                marginDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
                liquidityDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
                priceFeed: mockPriceFeed,
            });

            const tradingFee = await positionUtil.calculateTradingFee(
                10n ** 18n,
                toPriceX96("1808.235", DECIMALS_18, DECIMALS_6),
                50_000n,
            );
            const referralFee = (tradingFee * 10_000_000n) / BASIS_POINTS_DIVISOR;
            const referralParentFee = (tradingFee * 1_000_000n) / BASIS_POINTS_DIVISOR;

            await expect(
                positionUtil.distributeFee({
                    market: ETHMarketDescriptor.target,
                    account: account.address,
                    sizeDelta: 10n ** 18n,
                    tradePriceX96: toPriceX96("1808.235", DECIMALS_18, DECIMALS_6),
                    tradingFeeState: {
                        tradingFeeRate: 50_000n,
                        referralReturnFeeRate: 10_000_000n,
                        referralParentReturnFeeRate: 1_000_000n,
                        referralToken: 10001n,
                        referralParentToken: 1001n,
                    },
                    liquidationFee: 600_000n,
                }),
            )
                .to.emit(_positionUtil.attach(positionUtil.target), "ReferralFeeIncreased")
                .withArgs(ETHMarketDescriptor.target, account.address, 10001n, referralFee, 1001n, referralParentFee);
        });

        it("should increase liquidation fund and emit GlobalLiquidationFundIncreasedByLiquidation event when trading fee and liquidation fee is positive", async () => {
            const {positionUtil, _positionUtil, ETHMarketDescriptor, account, marketCfg, mockPriceFeed} =
                await loadFixture(deployFixture);

            await positionUtil.increaseLiquidityPosition({
                market: ETHMarketDescriptor.target,
                account: account,
                marginDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
                liquidityDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
                priceFeed: mockPriceFeed,
            });

            await expect(
                positionUtil.distributeFee({
                    market: ETHMarketDescriptor.target,
                    account: account.address,
                    sizeDelta: 10n ** 18n,
                    tradePriceX96: toPriceX96("1808.235", DECIMALS_18, DECIMALS_6),
                    tradingFeeState: {
                        tradingFeeRate: 50_000n,
                        referralReturnFeeRate: 10_000_000n,
                        referralParentReturnFeeRate: 1_000_000n,
                        referralToken: 0n,
                        referralParentToken: 0n,
                    },
                    liquidationFee: 600_000n,
                }),
            )
                .to.emit(_positionUtil.attach(positionUtil.target), "GlobalLiquidationFundIncreasedByLiquidation")
                .withArgs(ETHMarketDescriptor.target, 600_000n, 600_000n);
        });

        it("should increase global liquidity position PnL growth and emit GlobalLiquidityPositionPnLGrowthIncreasedByTradingFee event when trading fee and liquidation fee is positive", async () => {
            const {positionUtil, _positionUtil, ETHMarketDescriptor, account, marketCfg, mockPriceFeed} =
                await loadFixture(deployFixture);

            await positionUtil.increaseLiquidityPosition({
                market: ETHMarketDescriptor.target,
                account: account,
                marginDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
                liquidityDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
                priceFeed: mockPriceFeed,
            });

            const tradingFee = await positionUtil.calculateTradingFee(
                10n ** 18n,
                toPriceX96("1808.235", DECIMALS_18, DECIMALS_6),
                50_000n,
            );
            const protocolFee = (tradingFee * 30_000_000n) / BASIS_POINTS_DIVISOR;
            const referralFee = (tradingFee * 10_000_000n) / BASIS_POINTS_DIVISOR;
            const referralParentFee = (tradingFee * 1_000_000n) / BASIS_POINTS_DIVISOR;
            const liquidityFee = tradingFee - protocolFee - referralFee - referralParentFee;

            const globalLiquidityPosition = (await positionUtil.state()).globalLiquidityPosition;
            const unrealizedPnLGrowthAfterX64 =
                globalLiquidityPosition.unrealizedPnLGrowthX64 +
                (liquidityFee * Q64) / globalLiquidityPosition.liquidity;

            await expect(
                positionUtil.distributeFee({
                    market: ETHMarketDescriptor.target,
                    account: account.address,
                    sizeDelta: 10n ** 18n,
                    tradePriceX96: toPriceX96("1808.235", DECIMALS_18, DECIMALS_6),
                    tradingFeeState: {
                        tradingFeeRate: 50_000n,
                        referralReturnFeeRate: 10_000_000n,
                        referralParentReturnFeeRate: 1_000_000n,
                        referralToken: 1n,
                        referralParentToken: 2n,
                    },
                    liquidationFee: 600_000n,
                }),
            )
                .to.emit(
                    _positionUtil.attach(positionUtil.target),
                    "GlobalLiquidityPositionPnLGrowthIncreasedByTradingFee",
                )
                .withArgs(ETHMarketDescriptor.target, liquidityFee, unrealizedPnLGrowthAfterX64);
        });
    });

    describe("#calculateNextEntryPriceX96", () => {
        const entryPriceX96 = toPriceX96("1", DECIMALS_18, DECIMALS_6);
        const tradePriceX96 = toPriceX96("1.1", DECIMALS_18, DECIMALS_6);
        it("should return zero when size before and size delta is zero", async () => {
            const {positionUtil} = await loadFixture(deployFixture);
            expect(await positionUtil.calculateNextEntryPriceX96(SIDE_LONG, 0, entryPriceX96, 0, tradePriceX96)).to.eq(
                0,
            );
            expect(await positionUtil.calculateNextEntryPriceX96(SIDE_SHORT, 0, entryPriceX96, 0, tradePriceX96)).to.eq(
                0,
            );
        });

        it("should return trade price x96 when size before is zero and size delta is positive", async () => {
            const {positionUtil} = await loadFixture(deployFixture);
            expect(await positionUtil.calculateNextEntryPriceX96(SIDE_LONG, 0, entryPriceX96, 1, tradePriceX96)).to.eq(
                tradePriceX96,
            );
            expect(await positionUtil.calculateNextEntryPriceX96(SIDE_SHORT, 0, entryPriceX96, 1, tradePriceX96)).to.eq(
                tradePriceX96,
            );
        });

        it("should return entry price before x96 when size before is positive and size delta is zero", async () => {
            const {positionUtil} = await loadFixture(deployFixture);
            expect(await positionUtil.calculateNextEntryPriceX96(SIDE_LONG, 1, entryPriceX96, 0, tradePriceX96)).to.eq(
                entryPriceX96,
            );
            expect(await positionUtil.calculateNextEntryPriceX96(SIDE_SHORT, 1, entryPriceX96, 0, tradePriceX96)).to.eq(
                entryPriceX96,
            );
        });

        it("should pass when size before and size delta is all positive", async () => {
            const sizeDelta = 10n;
            const sizeBefore = 10n;
            it("should round up if side is long", async () => {
                const {positionUtil} = await loadFixture(deployFixture);
                const nextEntryPriceX96 = mulDiv(
                    sizeBefore * entryPriceX96 + sizeDelta * tradePriceX96,
                    1,
                    sizeBefore + sizeDelta,
                    Rounding.Up,
                );
                expect(nextEntryPriceX96).to.not.eq(
                    (sizeBefore * entryPriceX96 + sizeDelta * tradePriceX96) / (sizeBefore + sizeDelta),
                );
                expect(
                    await positionUtil.calculateNextEntryPriceX96(
                        SIDE_LONG,
                        sizeBefore,
                        entryPriceX96,
                        sizeDelta,
                        tradePriceX96,
                    ),
                ).to.eq(nextEntryPriceX96);
            });

            it("should round down if side is short", async () => {
                const {positionUtil} = await loadFixture(deployFixture);
                const nextEntryPriceX96 =
                    (sizeBefore * entryPriceX96 + sizeDelta * tradePriceX96) / (sizeBefore + sizeDelta);
                expect(nextEntryPriceX96).to.not.eq(
                    mulDiv(
                        sizeBefore * entryPriceX96 + sizeDelta * tradePriceX96,
                        1,
                        sizeBefore + sizeDelta,
                        Rounding.Up,
                    ),
                );
                expect(
                    await positionUtil.calculateNextEntryPriceX96(
                        SIDE_SHORT,
                        sizeBefore,
                        entryPriceX96,
                        sizeDelta,
                        tradePriceX96,
                    ),
                ).to.eq(nextEntryPriceX96);
            });
        });
    });

    describe("#calculateLiquidity", () => {
        it("should round up", async () => {
            const {positionUtil} = await loadFixture(deployFixture);
            const priceX96 = toPriceX96("1808.234", DECIMALS_18, DECIMALS_6);
            const liquidity = await positionUtil.calculateLiquidity(3, priceX96);
            expect(liquidity).to.eq(mulDiv(3n, priceX96, Q96, Rounding.Up));
        });
    });

    describe("#calculateUnrealizedPnL", () => {
        describe("side is long", () => {
            const side = SIDE_LONG;
            it("should round up if entryPriceX96 is greater than priceX96", async () => {
                const {positionUtil} = await loadFixture(deployFixture);
                const size = 10000n;
                const entryPriceX96 = toPriceX96("1808.234", DECIMALS_18, DECIMALS_6);
                const priceX96 = toPriceX96("1808.123", DECIMALS_18, DECIMALS_6);
                expect(mulDiv(size, entryPriceX96 - priceX96, Q96, Rounding.Up)).to.not.eq(
                    mulDiv(size, entryPriceX96 - priceX96, Q96, Rounding.Down),
                );
                expect(await positionUtil.calculateUnrealizedPnL(side, size, entryPriceX96, priceX96)).to.eq(
                    -mulDiv(size, entryPriceX96 - priceX96, Q96, Rounding.Up),
                );
            });

            it("should round down if entryPriceX96 is not greater than priceX96", async () => {
                const {positionUtil} = await loadFixture(deployFixture);
                const size = 10000n;
                const entryPriceX96 = toPriceX96("1808.123", DECIMALS_18, DECIMALS_6);
                let priceX96 = toPriceX96("1808.234", DECIMALS_18, DECIMALS_6);
                expect(mulDiv(size, priceX96 - entryPriceX96, Q96, Rounding.Down)).to.not.eq(
                    mulDiv(size, priceX96 - entryPriceX96, Q96, Rounding.Up),
                );
                expect(await positionUtil.calculateUnrealizedPnL(side, size, entryPriceX96, priceX96)).to.eq(
                    mulDiv(size, entryPriceX96 - priceX96, Q96, Rounding.Down),
                );

                priceX96 = entryPriceX96;
                expect(await positionUtil.calculateUnrealizedPnL(side, size, entryPriceX96, priceX96)).to.eq(0n);
            });
        });

        describe("side is short", () => {
            const side = SIDE_SHORT;
            it("should round up if entryPriceX96 is less than priceX96", async () => {
                const {positionUtil} = await loadFixture(deployFixture);
                const size = 10000n;
                const entryPriceX96 = toPriceX96("1808.123", DECIMALS_18, DECIMALS_6);
                let priceX96 = toPriceX96("1808.234", DECIMALS_18, DECIMALS_6);
                expect(mulDiv(size, priceX96 - entryPriceX96, Q96, Rounding.Up)).to.not.eq(
                    mulDiv(size, priceX96 - entryPriceX96, Q96, Rounding.Down),
                );
                expect(await positionUtil.calculateUnrealizedPnL(side, size, entryPriceX96, priceX96)).to.eq(
                    -mulDiv(size, entryPriceX96 - priceX96, Q96, Rounding.Up),
                );
            });

            it("should round down if entryPriceX96 is not less than priceX96", async () => {
                const {positionUtil} = await loadFixture(deployFixture);
                const size = 10000n;
                const entryPriceX96 = toPriceX96("1808.234", DECIMALS_18, DECIMALS_6);
                const priceX96 = toPriceX96("1808.123", DECIMALS_18, DECIMALS_6);
                expect(mulDiv(size, entryPriceX96 - priceX96, Q96, Rounding.Down)).to.not.eq(
                    mulDiv(size, entryPriceX96 - priceX96, Q96, Rounding.Up),
                );
                expect(await positionUtil.calculateUnrealizedPnL(side, size, entryPriceX96, priceX96)).to.eq(
                    mulDiv(size, entryPriceX96 - priceX96, Q96, Rounding.Down),
                );
            });
        });
    });

    describe("#chooseFundingRateGrowthX96", () => {
        describe("side is long", () => {
            it("should pass", async () => {
                const {positionUtil} = await loadFixture(deployFixture);
                const longFundingRateGrowthX96 = await positionUtil.chooseFundingRateGrowthX96(SIDE_LONG);
                expect(longFundingRateGrowthX96).to.eq(5n);
            });
        });
        describe("side is short", () => {
            it("should pass", async () => {
                const {positionUtil} = await loadFixture(deployFixture);
                const longFundingRateGrowthX96 = await positionUtil.chooseFundingRateGrowthX96(SIDE_SHORT);
                expect(longFundingRateGrowthX96).to.eq(6n);
            });
        });
    });

    describe("#calculateTradingFee", () => {
        it("should round up", async () => {
            const {positionUtil} = await loadFixture(deployFixture);
            const size = 1n;
            const tradePriceX96 = toPriceX96("1808.234", DECIMALS_18, DECIMALS_6);
            const tradingFeeRate = 30000n;
            const tradingFee = await positionUtil.calculateTradingFee(size, tradePriceX96, tradingFeeRate);
            expect(mulDiv(size * tradingFeeRate, tradePriceX96, BASIS_POINTS_DIVISOR * Q96, Rounding.Up)).to.not.eq(
                mulDiv(size * tradingFeeRate, tradePriceX96, BASIS_POINTS_DIVISOR * Q96, Rounding.Down),
            );
            expect(tradingFee).to.eq(
                mulDiv(size * tradingFeeRate, tradePriceX96, BASIS_POINTS_DIVISOR * Q96, Rounding.Up),
            );
        });
    });

    describe("#calculateLiquidationFee", () => {
        it("should round up", async () => {
            const {positionUtil} = await loadFixture(deployFixture);
            const size = 1n;
            const entryPriceX96 = toPriceX96("1808.234", DECIMALS_18, DECIMALS_6);
            const liquidationFeeRate = 30000n;
            const liquidationFee = await positionUtil.calculateLiquidationFee(size, entryPriceX96, liquidationFeeRate);
            expect(mulDiv(size * liquidationFeeRate, entryPriceX96, BASIS_POINTS_DIVISOR * Q96, Rounding.Up)).to.not.eq(
                mulDiv(size * liquidationFeeRate, entryPriceX96, BASIS_POINTS_DIVISOR * Q96, Rounding.Down),
            );
            expect(liquidationFee).to.eq(
                mulDiv(size * liquidationFeeRate, entryPriceX96, BASIS_POINTS_DIVISOR * Q96, Rounding.Up),
            );
        });
    });

    describe("#calculateFundingFee", () => {
        describe("globalFundingRateGrowthX96 is greater than or equal to positionFundingRateGrowthX96", () => {
            it("should be equal to zero", async () => {
                const {positionUtil} = await loadFixture(deployFixture);
                const globalFundingRateGrowthX96 = BigInt(
                    new Decimal("1808.234").mul(new Decimal(2).pow(96)).toFixed(0),
                );
                const positionFundingRateGrowthX96 = BigInt(
                    new Decimal("1808.234").mul(new Decimal(2).pow(96)).toFixed(0),
                );
                const fundingFee = await positionUtil.calculateFundingFee(
                    globalFundingRateGrowthX96,
                    positionFundingRateGrowthX96,
                    100000000000,
                );
                expect(fundingFee).to.eq(0n);
            });

            it("should round down and be greater than zero", async () => {
                const {positionUtil} = await loadFixture(deployFixture);
                const globalFundingRateGrowthX96 = BigInt(
                    new Decimal("1809.456").mul(new Decimal(2).pow(96)).toFixed(0),
                );
                const positionFundingRateGrowthX96 = BigInt(
                    new Decimal("1808.234").mul(new Decimal(2).pow(96)).toFixed(0),
                );
                const fundingFee = await positionUtil.calculateFundingFee(
                    globalFundingRateGrowthX96,
                    positionFundingRateGrowthX96,
                    100000000000,
                );
                expect(fundingFee).to.eq(
                    mulDiv(
                        globalFundingRateGrowthX96 - positionFundingRateGrowthX96,
                        100000000000n,
                        Q96,
                        Rounding.Down,
                    ),
                );
                expect(fundingFee).gt(0n);
            });
        });
        describe("globalFundingRateGrowthX96 is less than positionFundingRateGrowthX96", () => {
            const globalFundingRateGrowthX96 = BigInt(new Decimal("1807.123").mul(new Decimal(2).pow(96)).toFixed(0));
            const positionFundingRateGrowthX96 = BigInt(new Decimal("1808.234").mul(new Decimal(2).pow(96)).toFixed(0));
            it("should round up and be less than zero", async () => {
                const {positionUtil} = await loadFixture(deployFixture);
                const fundingFee = await positionUtil.calculateFundingFee(
                    globalFundingRateGrowthX96,
                    positionFundingRateGrowthX96,
                    100000000000,
                );
                expect(fundingFee).to.eq(
                    -mulDiv(positionFundingRateGrowthX96 - globalFundingRateGrowthX96, 100000000000n, Q96, Rounding.Up),
                );
                expect(fundingFee).lt(0n);
            });
        });
    });

    describe("#calculateMaintenanceMargin", () => {
        it("should round up", async () => {
            const {positionUtil} = await loadFixture(deployFixture);
            const priceX96 = toPriceX96("1807.123", DECIMALS_18, DECIMALS_6);
            const maintenanceMargin = await positionUtil.calculateMaintenanceMargin(
                1000,
                priceX96,
                priceX96,
                200,
                300,
                10000000000,
            );
            expect(mulDiv(1000n, priceX96 * 200n + priceX96 * 300n, BASIS_POINTS_DIVISOR * Q96, Rounding.Up)).to.not.eq(
                mulDiv(1000n, priceX96 * 200n + priceX96 * 300n, BASIS_POINTS_DIVISOR * Q96, Rounding.Down),
            );
            expect(maintenanceMargin).to.eq(
                mulDiv(1000n, priceX96 * 200n + priceX96 * 300n, BASIS_POINTS_DIVISOR * Q96, Rounding.Up) +
                    10000000000n,
            );
        });
    });

    describe("#calculateLiquidationPriceX96", () => {
        describe("funding fee would not be adjusted", () => {
            async function testShouldPass(side: Side) {
                const {positionUtil} = await loadFixture(deployFixture);
                const margin = 610_000n;
                const positionSize = 10_000n;
                const positionEntryPriceX96 = Q96;
                const fundingFee = 0n;
                const liquidationFeeRate = 400000n;
                const tradingFeeRate = 50000n;
                const liquidationExecutionFee = 600_000n;

                // (EP*S*(BPD+LFR) - (M-LEF)*BPD*Q96) / (S*(BPD-TFR))
                const _liquidationPriceX96 = _calculateLiquidationPriceX96(
                    side,
                    margin,
                    positionSize,
                    positionEntryPriceX96,
                    fundingFee,
                    liquidationFeeRate,
                    tradingFeeRate,
                    liquidationExecutionFee,
                );
                expect(_isAcceptableLiquidationPriceX96(side, _liquidationPriceX96, positionEntryPriceX96)).to.true;

                let position = _newPosition();
                position.margin = margin;
                position.size = positionSize;
                position.entryPriceX96 = positionEntryPriceX96;

                const {liquidationPriceX96, adjustedFundingFee} = await positionUtil.calculateLiquidationPriceX96(
                    position,
                    side,
                    fundingFee,
                    liquidationFeeRate,
                    tradingFeeRate,
                    liquidationExecutionFee,
                );
                expect(liquidationPriceX96).to.eq(_liquidationPriceX96);
                expect(adjustedFundingFee).to.eq(fundingFee);
            }

            describe("side is long", () => {
                const side = SIDE_LONG;
                it("should pass if margin after is not less than liquidation execution fee", async () => {
                    await testShouldPass(side);
                });

                it("should revert if the numerator of the formula is negative", async () => {
                    const {positionUtil} = await loadFixture(deployFixture);
                    const margin = 620_000n;
                    const positionSize = 10_000n;
                    const positionEntryPriceX96 = Q96;
                    const fundingFee = 0n;
                    const liquidationFeeRate = 400000n;
                    const tradingFeeRate = 50000n;
                    const liquidationExecutionFee = 600_000n;

                    let position = _newPosition();
                    position.margin = margin;
                    position.size = positionSize;
                    position.entryPriceX96 = positionEntryPriceX96;

                    await expect(
                        positionUtil.calculateLiquidationPriceX96(
                            position,
                            side,
                            fundingFee,
                            liquidationFeeRate,
                            tradingFeeRate,
                            liquidationExecutionFee,
                        ),
                    ).to.revertedWithPanic("0x11");
                });
            });

            describe("side is short", () => {
                const side = SIDE_SHORT;
                it("should pass if margin after is not less than liquidation execution fee", async () => {
                    await testShouldPass(side);
                });
            });
        });

        describe("funding fee is adjusted based on the previous global funding rate growth", () => {
            describe("margin is enough to pay funding fee", () => {
                const positionSize = 10_000n;
                const positionEntryPriceX96 = Q96;
                const fundingFee = 0n;
                const liquidationFeeRate = 400000n;
                const tradingFeeRate = 50000n;
                const liquidationExecutionFee = 600_000n;

                async function test(margin: bigint, side: Side) {
                    const {positionUtil} = await loadFixture(deployFixture);

                    {
                        const _liquidationPriceX96 = _calculateLiquidationPriceX96(
                            side,
                            margin,
                            positionSize,
                            positionEntryPriceX96,
                            fundingFee,
                            liquidationFeeRate,
                            tradingFeeRate,
                            liquidationExecutionFee,
                        );
                        expect(_isAcceptableLiquidationPriceX96(side, _liquidationPriceX96, positionEntryPriceX96)).to
                            .false;
                    }

                    let position = _newPosition();
                    position.margin = margin;
                    position.size = positionSize;
                    position.entryPriceX96 = positionEntryPriceX96;
                    position.entryFundingRateGrowthX96 = 0n;

                    const _adjustedFundingFee = 99n;
                    {
                        // adjust funding fee to 99
                        await positionUtil.setPreviousGlobalFundingRate(Q96 / 100n, Q96 / 100n);
                        expect(await positionUtil.calculateFundingFee(Q96 / 100n, 0n, positionSize)).to.eq(
                            _adjustedFundingFee,
                        );
                    }

                    const _liquidationPriceX96 = _calculateLiquidationPriceX96(
                        side,
                        margin,
                        positionSize,
                        positionEntryPriceX96,
                        _adjustedFundingFee,
                        liquidationFeeRate,
                        tradingFeeRate,
                        liquidationExecutionFee,
                    );
                    expect(_isAcceptableLiquidationPriceX96(side, _liquidationPriceX96, positionEntryPriceX96)).to.true;

                    const {liquidationPriceX96, adjustedFundingFee} = await positionUtil.calculateLiquidationPriceX96(
                        position,
                        side,
                        fundingFee,
                        liquidationFeeRate,
                        tradingFeeRate,
                        liquidationExecutionFee,
                    );
                    expect(liquidationPriceX96).to.eq(_liquidationPriceX96);
                    expect(adjustedFundingFee).to.eq(_adjustedFundingFee);
                }

                describe("margin after is not less than liquidation execution fee", () => {
                    const margin = 600_030n;

                    it("should pass when side is long", async () => {
                        await test(margin, SIDE_LONG);
                    });

                    it("should pass when side is short", async () => {
                        await test(margin, SIDE_SHORT);
                    });
                });

                describe("margin after is less than liquidation execution fee", () => {
                    const margin = 600_000n - 1n;
                    it("should pass when side is long", async () => {
                        await test(margin, SIDE_LONG);
                    });

                    it("should pass when side is short", async () => {
                        await test(margin, SIDE_SHORT);
                    });
                });
            });

            describe("margin is not enough to pay funding fee", () => {
                const positionSize = 10_000n;
                const positionEntryPriceX96 = Q96;
                const liquidationFeeRate = 400000n;
                const tradingFeeRate = 50000n;
                const liquidationExecutionFee = 600_000n;

                const margin = 600_100n;
                const fundingFee = -600_101n;

                async function test(side: Side) {
                    const {positionUtil} = await loadFixture(deployFixture);

                    let position = _newPosition();
                    position.margin = margin;
                    position.size = positionSize;
                    position.entryPriceX96 = positionEntryPriceX96;
                    position.entryFundingRateGrowthX96 = 0n;

                    const _adjustedFundingFee = 99n;
                    {
                        // adjust funding fee to 99
                        await positionUtil.setPreviousGlobalFundingRate(Q96 / 100n, Q96 / 100n);
                        expect(await positionUtil.calculateFundingFee(Q96 / 100n, 0n, positionSize)).to.eq(
                            _adjustedFundingFee,
                        );
                    }

                    const _liquidationPriceX96 = _calculateLiquidationPriceX96(
                        side,
                        margin,
                        positionSize,
                        positionEntryPriceX96,
                        _adjustedFundingFee,
                        liquidationFeeRate,
                        tradingFeeRate,
                        liquidationExecutionFee,
                    );
                    expect(_isAcceptableLiquidationPriceX96(side, _liquidationPriceX96, positionEntryPriceX96)).to.true;

                    const {liquidationPriceX96, adjustedFundingFee} = await positionUtil.calculateLiquidationPriceX96(
                        position,
                        side,
                        fundingFee,
                        liquidationFeeRate,
                        tradingFeeRate,
                        liquidationExecutionFee,
                    );
                    expect(liquidationPriceX96).to.eq(_liquidationPriceX96);
                    expect(adjustedFundingFee).to.eq(_adjustedFundingFee);
                }

                describe("side is long", () => {
                    const side = SIDE_LONG;
                    it("should pass", async () => {
                        await test(side);
                    });
                });

                describe("side is short", () => {
                    const side = SIDE_SHORT;
                    it("should pass", async () => {
                        await test(side);
                    });
                });
            });
        });

        describe("funding fee is adjusted to zero", () => {
            const positionSize = 10_000n;
            const positionEntryPriceX96 = Q96;
            const liquidationFeeRate = 400000n;
            const tradingFeeRate = 50000n;
            const liquidationExecutionFee = 600_000n;

            const margin = 600_100n;
            const fundingFee = -600_102n;

            async function test(side: Side) {
                const {positionUtil} = await loadFixture(deployFixture);

                let position = _newPosition();
                position.margin = margin;
                position.size = positionSize;
                position.entryPriceX96 = positionEntryPriceX96;
                position.entryFundingRateGrowthX96 = (Q96 * 600101n) / 10000n;

                let _adjustedFundingFee = -600_101n;
                {
                    // adjust funding fee to -600_101
                    expect(
                        await positionUtil.calculateFundingFee(0n, position.entryFundingRateGrowthX96, positionSize),
                    ).to.eq(_adjustedFundingFee);
                }
                _adjustedFundingFee = 0n;

                const _liquidationPriceX96 = _calculateLiquidationPriceX96(
                    side,
                    margin,
                    positionSize,
                    positionEntryPriceX96,
                    _adjustedFundingFee,
                    liquidationFeeRate,
                    tradingFeeRate,
                    liquidationExecutionFee,
                );
                expect(_isAcceptableLiquidationPriceX96(side, _liquidationPriceX96, positionEntryPriceX96)).to.true;

                const {liquidationPriceX96, adjustedFundingFee} = await positionUtil.calculateLiquidationPriceX96(
                    position,
                    side,
                    fundingFee,
                    liquidationFeeRate,
                    tradingFeeRate,
                    liquidationExecutionFee,
                );
                expect(liquidationPriceX96).to.eq(_liquidationPriceX96);
                expect(adjustedFundingFee).to.eq(_adjustedFundingFee);
            }

            describe("side is long", () => {
                const side = SIDE_LONG;
                it("should pass", async () => {
                    await test(side);
                });
            });

            describe("side is short", () => {
                const side = SIDE_SHORT;
                it("should pass", async () => {
                    await test(side);
                });
            });
        });
    });

    describe("#increasePosition", () => {
        it("should revert if side is invalid", async () => {
            const {account, ETHMarketDescriptor, marketCfg, positionUtil, _positionUtil, mockEFC, mockPriceFeed} =
                await loadFixture(deployFixture);

            await positionUtil.increaseLiquidityPosition({
                market: ETHMarketDescriptor.target,
                account: account,
                marginDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
                liquidityDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
                priceFeed: mockPriceFeed,
            });

            await expect(
                positionUtil.increasePosition({
                    market: ETHMarketDescriptor.target,
                    account: account,
                    side: 3,
                    marginDelta: marketCfg.baseConfig.minMarginPerPosition * 100n,
                    sizeDelta: marketCfg.baseConfig.minMarginPerPosition * 100n,
                    EFC: mockEFC.target,
                    priceFeed: mockPriceFeed.target,
                }),
            )
                .to.revertedWithCustomError(_positionUtil, "InvalidSide")
                .withArgs(3);
        });

        it("should revert if position size is zero and size delta is zero", async () => {
            const {account, ETHMarketDescriptor, marketCfg, positionUtil, _positionUtil, mockEFC, mockPriceFeed} =
                await loadFixture(deployFixture);

            await positionUtil.increaseLiquidityPosition({
                market: ETHMarketDescriptor.target,
                account: account,
                marginDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
                liquidityDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
                priceFeed: mockPriceFeed,
            });

            await expect(
                positionUtil.increasePosition({
                    market: ETHMarketDescriptor.target,
                    account: account,
                    side: SIDE_SHORT,
                    marginDelta: marketCfg.baseConfig.minMarginPerPosition * 100n,
                    sizeDelta: 0n,
                    EFC: mockEFC.target,
                    priceFeed: mockPriceFeed.target,
                }),
            )
                .to.revertedWithCustomError(_positionUtil, "PositionNotFound")
                .withArgs(account.address, SIDE_SHORT);
        });

        it("should revert if position size has reached the max size of per position", async () => {
            const {account, ETHMarketDescriptor, marketCfg, positionUtil, _positionUtil, mockEFC, mockPriceFeed} =
                await loadFixture(deployFixture);

            await mockPriceFeed.setMinPriceX96(Q96 + 1n);
            await mockPriceFeed.setMaxPriceX96(Q96 * 2n);

            await positionUtil.increaseLiquidityPosition({
                market: ETHMarketDescriptor.target,
                account: account,
                marginDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
                liquidityDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
                priceFeed: mockPriceFeed,
            });

            const maxSizePerPosition = (await positionUtil.state()).globalPosition.maxSizePerPosition;

            await expect(
                positionUtil.increasePosition({
                    market: ETHMarketDescriptor.target,
                    account: account,
                    side: SIDE_SHORT,
                    marginDelta: marketCfg.baseConfig.minMarginPerPosition,
                    sizeDelta: maxSizePerPosition + 1n,
                    EFC: mockEFC.target,
                    priceFeed: mockPriceFeed.target,
                }),
            )
                .to.revertedWithCustomError(_positionUtil, "SizeExceedsMaxSizePerPosition")
                .withArgs(maxSizePerPosition + 1n, maxSizePerPosition);
        });

        it("should revert if position size has reached the max size of positions", async () => {
            const {account, ETHMarketDescriptor, marketCfg, positionUtil, _positionUtil, mockEFC, mockPriceFeed} =
                await loadFixture(deployFixture);

            await mockPriceFeed.setMinPriceX96(Q96 + 1n);
            await mockPriceFeed.setMaxPriceX96(Q96 * 2n);

            await positionUtil.increaseLiquidityPosition({
                market: ETHMarketDescriptor.target,
                account: account,
                marginDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
                liquidityDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
                priceFeed: mockPriceFeed,
            });

            const globalPosition = (await positionUtil.state()).globalPosition;
            const maxSize = globalPosition.maxSize;
            const maxSizePerPosition = globalPosition.maxSizePerPosition;

            const accounts = await ethers.getSigners();
            for (let i = 1; i < 10; i++) {
                await positionUtil.increasePosition({
                    market: ETHMarketDescriptor.target,
                    account: accounts[i],
                    side: SIDE_SHORT,
                    marginDelta: marketCfg.baseConfig.minMarginPerPosition * 100n,
                    sizeDelta: maxSizePerPosition,
                    EFC: mockEFC.target,
                    priceFeed: mockPriceFeed.target,
                });
            }

            await expect(
                positionUtil.increasePosition({
                    market: ETHMarketDescriptor.target,
                    account: account,
                    side: SIDE_SHORT,
                    marginDelta: marketCfg.baseConfig.minMarginPerPosition,
                    sizeDelta: maxSizePerPosition,
                    EFC: mockEFC.target,
                    priceFeed: mockPriceFeed.target,
                }),
            )
                .to.revertedWithCustomError(_positionUtil, "SizeExceedsMaxSize")
                .withArgs(maxSize + globalPosition.longSize + globalPosition.shortSize, maxSize);
        });

        it("should revert if margin delta is less than minMarginPerPosition", async () => {
            const {account, ETHMarketDescriptor, marketCfg, positionUtil, _positionUtil, mockEFC, mockPriceFeed} =
                await loadFixture(deployFixture);

            await positionUtil.increaseLiquidityPosition({
                market: ETHMarketDescriptor.target,
                account: account,
                marginDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
                liquidityDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
                priceFeed: mockPriceFeed,
            });

            await expect(
                positionUtil.increasePosition({
                    market: ETHMarketDescriptor.target,
                    account: account,
                    side: SIDE_SHORT,
                    marginDelta: marketCfg.baseConfig.minMarginPerPosition - 1n,
                    sizeDelta: marketCfg.baseConfig.minMarginPerPosition * 100n,
                    EFC: mockEFC.target,
                    priceFeed: mockPriceFeed.target,
                }),
            ).to.revertedWithCustomError(_positionUtil, "InsufficientMargin");
        });

        it("should revert if the global liquidity is zero", async () => {
            const {account, ETHMarketDescriptor, marketCfg, positionUtil, _positionUtil, mockEFC, mockPriceFeed} =
                await loadFixture(deployFixture);

            await expect(
                positionUtil.increasePosition({
                    market: ETHMarketDescriptor.target,
                    account: account,
                    side: SIDE_SHORT,
                    marginDelta: marketCfg.baseConfig.minMarginPerPosition * 100n,
                    sizeDelta: marketCfg.baseConfig.minMarginPerPosition * 100n,
                    EFC: mockEFC.target,
                    priceFeed: mockPriceFeed.target,
                }),
            ).to.revertedWithCustomError(_positionUtil, "InsufficientGlobalLiquidity");
        });

        it("should revert if the position has reached the liquidation maintain margin rate", async () => {
            const {account, ETHMarketDescriptor, marketCfg, positionUtil, _positionUtil, mockEFC, mockPriceFeed} =
                await loadFixture(deployFixture);

            await mockPriceFeed.setMinPriceX96(Q96 + 1n);
            await mockPriceFeed.setMaxPriceX96(Q96 * 2n);

            await positionUtil.increaseLiquidityPosition({
                market: ETHMarketDescriptor.target,
                account: account,
                marginDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 2000n,
                liquidityDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 2000n,
                priceFeed: mockPriceFeed,
            });

            await expect(
                positionUtil.increasePosition({
                    market: ETHMarketDescriptor.target,
                    account: account,
                    side: SIDE_SHORT,
                    marginDelta: marketCfg.baseConfig.minMarginPerPosition,
                    sizeDelta: 900000000n,
                    EFC: mockEFC.target,
                    priceFeed: mockPriceFeed.target,
                }),
            )
                .to.revertedWithCustomError(_positionUtil, "MarginRateTooHigh")
                .withArgs(9551000n, -902000001n, 3296000n);
        });

        it("should settle liquidity unrealized PnL emit SettlementPointReached event", async () => {
            const {account, ETHMarketDescriptor, marketCfg, positionUtil, _positionUtil, mockEFC, mockPriceFeed} =
                await loadFixture(deployFixture);

            await positionUtil.increaseLiquidityPosition({
                market: ETHMarketDescriptor.target,
                account: account,
                marginDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
                liquidityDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
                priceFeed: mockPriceFeed,
            });

            await positionUtil.increasePosition({
                market: ETHMarketDescriptor.target,
                account: account,
                side: SIDE_LONG,
                marginDelta: marketCfg.baseConfig.minMarginPerPosition * 100n,
                sizeDelta: marketCfg.baseConfig.minMarginPerPosition * 100n,
                EFC: mockEFC.target,
                priceFeed: mockPriceFeed.target,
            });

            await expect(
                positionUtil.increasePosition({
                    market: ETHMarketDescriptor.target,
                    account: account,
                    side: SIDE_SHORT,
                    marginDelta: marketCfg.baseConfig.minMarginPerPosition * 100n,
                    sizeDelta: marketCfg.baseConfig.minMarginPerPosition * 100n,
                    EFC: mockEFC.target,
                    priceFeed: mockPriceFeed.target,
                }),
            )
                .to.emit(_positionUtil.attach(positionUtil.target), "SettlementPointReached")
                .withArgs(
                    ETHMarketDescriptor.target,
                    () => true,
                    () => true,
                );
        });

        it("should initialize previous SP price when size delta is positive", async () => {
            const {account, ETHMarketDescriptor, marketCfg, positionUtil, _positionUtil, mockEFC, mockPriceFeed} =
                await loadFixture(deployFixture);

            await positionUtil.increaseLiquidityPosition({
                market: ETHMarketDescriptor.target,
                account: account,
                marginDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
                liquidityDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
                priceFeed: mockPriceFeed,
            });

            expect((await positionUtil.state()).globalLiquidityPosition.netSize).to.eq(0);

            await expect(
                positionUtil.increasePosition({
                    market: ETHMarketDescriptor.target,
                    account: account,
                    side: SIDE_SHORT,
                    marginDelta: marketCfg.baseConfig.minMarginPerPosition * 100n,
                    sizeDelta: marketCfg.baseConfig.minMarginPerPosition * 100n,
                    EFC: mockEFC.target,
                    priceFeed: mockPriceFeed.target,
                }),
            )
                .to.emit(_positionUtil.attach(positionUtil.target), "PreviousSPPriceInitialized")
                .withArgs(ETHMarketDescriptor.target, await mockPriceFeed.getMinPriceX96(ETHMarketDescriptor.target));
        });

        it("should update price state when size delta is positive", async () => {
            const {account, ETHMarketDescriptor, marketCfg, positionUtil, _positionUtil, mockEFC, mockPriceFeed} =
                await loadFixture(deployFixture);

            await positionUtil.increaseLiquidityPosition({
                market: ETHMarketDescriptor.target,
                account: account,
                marginDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
                liquidityDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
                priceFeed: mockPriceFeed,
            });

            expect((await positionUtil.state()).globalLiquidityPosition.netSize).to.eq(0);

            await expect(
                positionUtil.increasePosition({
                    market: ETHMarketDescriptor.target,
                    account: account,
                    side: SIDE_SHORT,
                    marginDelta: marketCfg.baseConfig.minMarginPerPosition * 100n,
                    sizeDelta: marketCfg.baseConfig.minMarginPerPosition * 100n,
                    EFC: mockEFC.target,
                    priceFeed: mockPriceFeed.target,
                }),
            )
                .to.emit(_positionUtil.attach(positionUtil.target), "PremiumRateChanged")
                .withArgs(ETHMarketDescriptor.target, () => true);
        });

        it("should distribute fee when size delta is positive", async () => {
            const {account, ETHMarketDescriptor, marketCfg, positionUtil, _positionUtil, mockEFC, mockPriceFeed} =
                await loadFixture(deployFixture);

            await positionUtil.increaseLiquidityPosition({
                market: ETHMarketDescriptor.target,
                account: account,
                marginDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
                liquidityDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
                priceFeed: mockPriceFeed,
            });

            expect((await positionUtil.state()).globalLiquidityPosition.netSize).to.eq(0);

            const assertion = expect(
                positionUtil.increasePosition({
                    market: ETHMarketDescriptor.target,
                    account: account,
                    side: SIDE_SHORT,
                    marginDelta: marketCfg.baseConfig.minMarginPerPosition * 100n,
                    sizeDelta: marketCfg.baseConfig.minMarginPerPosition * 100n,
                    EFC: mockEFC.target,
                    priceFeed: mockPriceFeed.target,
                }),
            );
            await assertion.to.emit(_positionUtil.attach(positionUtil.target), "ProtocolFeeIncreased");
            await assertion.to.emit(
                _positionUtil.attach(positionUtil.target),
                "GlobalLiquidityPositionPnLGrowthIncreasedByTradingFee",
            );
            await assertion.to.not.emit(
                _positionUtil.attach(positionUtil.target),
                "GlobalLiquidationFundIncreasedByLiquidation",
            );
        });

        it("should increase global position when size delta is positive", async () => {
            const {account, ETHMarketDescriptor, marketCfg, positionUtil, mockEFC, mockPriceFeed} =
                await loadFixture(deployFixture);

            await positionUtil.increaseLiquidityPosition({
                market: ETHMarketDescriptor.target,
                account: account,
                marginDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
                liquidityDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
                priceFeed: mockPriceFeed,
            });

            const globalPositionBefore = (await positionUtil.state()).globalPosition;
            expect(globalPositionBefore.longSize).to.eq(1n);
            expect(globalPositionBefore.shortSize).to.eq(2n);

            await positionUtil.increasePosition({
                market: ETHMarketDescriptor.target,
                account: account,
                side: SIDE_SHORT,
                marginDelta: marketCfg.baseConfig.minMarginPerPosition * 100n,
                sizeDelta: marketCfg.baseConfig.minMarginPerPosition * 100n,
                EFC: mockEFC.target,
                priceFeed: mockPriceFeed.target,
            });
            let globalPositionAfter = (await positionUtil.state()).globalPosition;
            expect(globalPositionAfter.longSize).to.eq(1n);
            expect(globalPositionAfter.shortSize).to.eq(marketCfg.baseConfig.minMarginPerPosition * 100n + 2n);

            await positionUtil.increasePosition({
                market: ETHMarketDescriptor.target,
                account: account,
                side: SIDE_LONG,
                marginDelta: marketCfg.baseConfig.minMarginPerPosition * 100n,
                sizeDelta: marketCfg.baseConfig.minMarginPerPosition * 100n,
                EFC: mockEFC.target,
                priceFeed: mockPriceFeed.target,
            });
            globalPositionAfter = (await positionUtil.state()).globalPosition;
            expect(globalPositionAfter.longSize).to.eq(marketCfg.baseConfig.minMarginPerPosition * 100n + 1n);
            expect(globalPositionAfter.shortSize).to.eq(marketCfg.baseConfig.minMarginPerPosition * 100n + 2n);
        });

        it("should emit PositionIncreased event", async () => {
            const {account, ETHMarketDescriptor, marketCfg, positionUtil, _positionUtil, mockEFC, mockPriceFeed} =
                await loadFixture(deployFixture);

            await positionUtil.increaseLiquidityPosition({
                market: ETHMarketDescriptor.target,
                account: account,
                marginDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
                liquidityDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
                priceFeed: mockPriceFeed,
            });

            await positionUtil.increasePosition({
                market: ETHMarketDescriptor.target,
                account: account,
                side: SIDE_LONG,
                marginDelta: marketCfg.baseConfig.minMarginPerPosition * 100n,
                sizeDelta: marketCfg.baseConfig.minMarginPerPosition * 100n,
                EFC: mockEFC.target,
                priceFeed: mockPriceFeed.target,
            });

            await expect(
                positionUtil.increasePosition({
                    market: ETHMarketDescriptor.target,
                    account: account,
                    side: SIDE_SHORT,
                    marginDelta: marketCfg.baseConfig.minMarginPerPosition * 100n,
                    sizeDelta: marketCfg.baseConfig.minMarginPerPosition * 100n,
                    EFC: mockEFC.target,
                    priceFeed: mockPriceFeed.target,
                }),
            )
                .to.emit(_positionUtil.attach(positionUtil.target), "PositionIncreased")
                .withArgs(
                    ETHMarketDescriptor.target,
                    account.address,
                    SIDE_SHORT,
                    marketCfg.baseConfig.minMarginPerPosition * 100n,
                    () => true,
                    () => true,
                    () => true,
                    () => true,
                    () => true,
                    () => true,
                );
        });

        describe("not the first creation", () => {
            it("should pass if increase margin only", async () => {
                const {account, ETHMarketDescriptor, marketCfg, positionUtil, mockEFC, mockPriceFeed} =
                    await loadFixture(deployFixture);

                await positionUtil.increaseLiquidityPosition({
                    market: ETHMarketDescriptor.target,
                    account: account,
                    marginDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
                    liquidityDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
                    priceFeed: mockPriceFeed,
                });

                await positionUtil.increasePosition({
                    market: ETHMarketDescriptor.target,
                    account: account,
                    side: SIDE_LONG,
                    marginDelta: marketCfg.baseConfig.minMarginPerPosition * 50n,
                    sizeDelta: marketCfg.baseConfig.minMarginPerPosition * 100n,
                    EFC: mockEFC.target,
                    priceFeed: mockPriceFeed.target,
                });

                await positionUtil.increasePosition({
                    market: ETHMarketDescriptor.target,
                    account: account,
                    side: SIDE_LONG,
                    marginDelta: marketCfg.baseConfig.minMarginPerPosition * 50n,
                    sizeDelta: 0n,
                    EFC: mockEFC.target,
                    priceFeed: mockPriceFeed.target,
                });

                const stateAfter = await positionUtil.state();

                {
                    expect(stateAfter.globalPosition.shortSize).to.eq(stateAfter.globalPosition.shortSize);
                    expect(stateAfter.globalPosition.longSize).to.eq(stateAfter.globalPosition.longSize);
                }
            });

            it("should pass if increase size only", async () => {
                const {account, ETHMarketDescriptor, marketCfg, positionUtil, mockEFC, mockPriceFeed} =
                    await loadFixture(deployFixture);

                await positionUtil.increaseLiquidityPosition({
                    market: ETHMarketDescriptor.target,
                    account: account,
                    marginDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
                    liquidityDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
                    priceFeed: mockPriceFeed,
                });

                await positionUtil.increasePosition({
                    market: ETHMarketDescriptor.target,
                    account: account,
                    side: SIDE_LONG,
                    marginDelta: marketCfg.baseConfig.minMarginPerPosition * 50n,
                    sizeDelta: marketCfg.baseConfig.minMarginPerPosition * 100n,
                    EFC: mockEFC.target,
                    priceFeed: mockPriceFeed.target,
                });

                await positionUtil.increasePosition({
                    market: ETHMarketDescriptor.target,
                    account: account,
                    side: SIDE_LONG,
                    marginDelta: 0n,
                    sizeDelta: marketCfg.baseConfig.minMarginPerPosition * 100n,
                    EFC: mockEFC.target,
                    priceFeed: mockPriceFeed.target,
                });

                const stateAfter = await positionUtil.state();

                {
                    expect(stateAfter.globalPosition.shortSize).to.eq(stateAfter.globalPosition.shortSize);
                    expect(stateAfter.globalPosition.longSize).to.eq(
                        marketCfg.baseConfig.minMarginPerPosition * 200n + 1n,
                    );
                }
            });

            it("should pass if increase margin and size", async () => {
                const {account, ETHMarketDescriptor, marketCfg, positionUtil, mockEFC, mockPriceFeed} =
                    await loadFixture(deployFixture);

                await positionUtil.increaseLiquidityPosition({
                    market: ETHMarketDescriptor.target,
                    account: account,
                    marginDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
                    liquidityDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
                    priceFeed: mockPriceFeed,
                });

                await positionUtil.increasePosition({
                    market: ETHMarketDescriptor.target,
                    account: account,
                    side: SIDE_LONG,
                    marginDelta: marketCfg.baseConfig.minMarginPerPosition * 50n,
                    sizeDelta: marketCfg.baseConfig.minMarginPerPosition * 100n,
                    EFC: mockEFC.target,
                    priceFeed: mockPriceFeed.target,
                });

                await positionUtil.increasePosition({
                    market: ETHMarketDescriptor.target,
                    account: account,
                    side: SIDE_LONG,
                    marginDelta: marketCfg.baseConfig.minMarginPerPosition * 50n,
                    sizeDelta: marketCfg.baseConfig.minMarginPerPosition * 100n,
                    EFC: mockEFC.target,
                    priceFeed: mockPriceFeed.target,
                });

                const stateAfter = await positionUtil.state();

                {
                    expect(stateAfter.globalPosition.shortSize).to.eq(stateAfter.globalPosition.shortSize);
                    expect(stateAfter.globalPosition.longSize).to.eq(
                        marketCfg.baseConfig.minMarginPerPosition * 200n + 1n,
                    );
                }
            });
        });
    });

    describe("#decreasePosition", () => {
        it("should revert if the position is not exist", async () => {
            const {
                account,
                other,
                ETHMarketDescriptor,
                marketCfg,
                positionUtil,
                _positionUtil,
                mockEFC,
                mockPriceFeed,
            } = await loadFixture(deployFixture);

            await expect(
                positionUtil.decreasePosition({
                    market: ETHMarketDescriptor.target,
                    account: account,
                    side: SIDE_LONG,
                    marginDelta: marketCfg.baseConfig.minMarginPerPosition,
                    sizeDelta: marketCfg.baseConfig.minMarginPerPosition,
                    EFC: mockEFC,
                    priceFeed: mockPriceFeed,
                    receiver: other.address,
                }),
            )
                .to.revertedWithCustomError(_positionUtil, "PositionNotFound")
                .withArgs(account.address, SIDE_LONG);
        });

        it("should revert if size delta is greater than position size", async () => {
            const {
                account,
                other,
                ETHMarketDescriptor,
                marketCfg,
                positionUtil,
                _positionUtil,
                mockEFC,
                mockPriceFeed,
            } = await loadFixture(deployFixture);

            await positionUtil.increaseLiquidityPosition({
                market: ETHMarketDescriptor.target,
                account: account,
                marginDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
                liquidityDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
                priceFeed: mockPriceFeed,
            });

            await positionUtil.increasePosition({
                market: ETHMarketDescriptor.target,
                account: account,
                side: SIDE_LONG,
                marginDelta: marketCfg.baseConfig.minMarginPerPosition * 100n,
                sizeDelta: marketCfg.baseConfig.minMarginPerPosition * 100n,
                EFC: mockEFC.target,
                priceFeed: mockPriceFeed.target,
            });

            await expect(
                positionUtil.decreasePosition({
                    market: ETHMarketDescriptor.target,
                    account: account,
                    side: SIDE_LONG,
                    marginDelta: 0n,
                    sizeDelta: marketCfg.baseConfig.minMarginPerPosition * 100n + 1n,
                    EFC: mockEFC,
                    priceFeed: mockPriceFeed,
                    receiver: other.address,
                }),
            )
                .to.revertedWithCustomError(_positionUtil, "InsufficientSizeToDecrease")
                .withArgs(
                    marketCfg.baseConfig.minMarginPerPosition * 100n,
                    marketCfg.baseConfig.minMarginPerPosition * 100n + 1n,
                );
        });

        it("should revert if margin after is negative", async () => {
            const {
                account,
                other,
                ETHMarketDescriptor,
                marketCfg,
                positionUtil,
                _positionUtil,
                mockEFC,
                mockPriceFeed,
            } = await loadFixture(deployFixture);

            await positionUtil.increaseLiquidityPosition({
                market: ETHMarketDescriptor.target,
                account: account,
                marginDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
                liquidityDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
                priceFeed: mockPriceFeed,
            });

            await positionUtil.increasePosition({
                market: ETHMarketDescriptor.target,
                account: account,
                side: SIDE_LONG,
                marginDelta: marketCfg.baseConfig.minMarginPerPosition * 100n,
                sizeDelta: marketCfg.baseConfig.minMarginPerPosition * 100n,
                EFC: mockEFC.target,
                priceFeed: mockPriceFeed.target,
            });

            await expect(
                positionUtil.decreasePosition({
                    market: ETHMarketDescriptor.target,
                    account: account,
                    side: SIDE_LONG,
                    marginDelta: marketCfg.baseConfig.minMarginPerPosition * 100n,
                    sizeDelta: marketCfg.baseConfig.minMarginPerPosition * 50n,
                    EFC: mockEFC,
                    priceFeed: mockPriceFeed,
                    receiver: other.address,
                }),
            ).to.revertedWithCustomError(_positionUtil, "InsufficientMargin");
        });

        it("should revert if the position has reached the liquidation maintain margin rate", async () => {
            const {
                account,
                other,
                ETHMarketDescriptor,
                marketCfg,
                positionUtil,
                _positionUtil,
                mockEFC,
                mockPriceFeed,
            } = await loadFixture(deployFixture);

            await mockPriceFeed.setMinPriceX96(Q96 + 1n);
            await mockPriceFeed.setMaxPriceX96(Q96 * 2n);

            await positionUtil.increaseLiquidityPosition({
                market: ETHMarketDescriptor.target,
                account: account,
                marginDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 2000n,
                liquidityDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 2000n,
                priceFeed: mockPriceFeed,
            });

            await positionUtil.increasePosition({
                market: ETHMarketDescriptor.target,
                account: account,
                side: SIDE_SHORT,
                marginDelta: marketCfg.baseConfig.minMarginPerPosition * 100n,
                sizeDelta: 900000000n,
                EFC: mockEFC.target,
                priceFeed: mockPriceFeed.target,
            });

            await expect(
                positionUtil.decreasePosition({
                    market: ETHMarketDescriptor.target,
                    account: account,
                    side: SIDE_SHORT,
                    marginDelta: marketCfg.baseConfig.minMarginPerPosition * 99n,
                    sizeDelta: 0n,
                    EFC: mockEFC,
                    priceFeed: mockPriceFeed,
                    receiver: other.address,
                }),
            )
                .to.revertedWithCustomError(_positionUtil, "MarginRateTooHigh")
                .withArgs(7863499n, -902000001n, 3296000n);
        });

        it("should settle liquidity unrealized PnL emit SettlementPointReached event", async () => {
            const {
                account,
                other,
                ETHMarketDescriptor,
                marketCfg,
                positionUtil,
                _positionUtil,
                mockEFC,
                mockPriceFeed,
            } = await loadFixture(deployFixture);

            await positionUtil.increaseLiquidityPosition({
                market: ETHMarketDescriptor.target,
                account: account,
                marginDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
                liquidityDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
                priceFeed: mockPriceFeed,
            });

            await positionUtil.increasePosition({
                market: ETHMarketDescriptor.target,
                account: account,
                side: SIDE_LONG,
                marginDelta: marketCfg.baseConfig.minMarginPerPosition * 100n,
                sizeDelta: marketCfg.baseConfig.minMarginPerPosition * 100n,
                EFC: mockEFC.target,
                priceFeed: mockPriceFeed.target,
            });

            await expect(
                positionUtil.decreasePosition({
                    market: ETHMarketDescriptor.target,
                    account: account,
                    side: SIDE_LONG,
                    marginDelta: 0n,
                    sizeDelta: marketCfg.baseConfig.minMarginPerPosition * 50n,
                    EFC: mockEFC,
                    priceFeed: mockPriceFeed,
                    receiver: other.address,
                }),
            )
                .to.emit(_positionUtil.attach(positionUtil.target), "SettlementPointReached")
                .withArgs(
                    ETHMarketDescriptor.target,
                    () => true,
                    () => true,
                );
        });

        it("should initialize previous SP price when size delta is positive", async () => {
            const {
                account,
                other,
                ETHMarketDescriptor,
                marketCfg,
                positionUtil,
                _positionUtil,
                mockEFC,
                mockPriceFeed,
            } = await loadFixture(deployFixture);

            await positionUtil.increaseLiquidityPosition({
                market: ETHMarketDescriptor.target,
                account: account,
                marginDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
                liquidityDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
                priceFeed: mockPriceFeed,
            });

            await positionUtil.increasePosition({
                market: ETHMarketDescriptor.target,
                account: account,
                side: SIDE_LONG,
                marginDelta: marketCfg.baseConfig.minMarginPerPosition * 100n,
                sizeDelta: marketCfg.baseConfig.minMarginPerPosition * 100n,
                EFC: mockEFC.target,
                priceFeed: mockPriceFeed.target,
            });

            {
                // make global net size and liquidation buffer net size to be zero
                const globalLiquidityPosition = (await positionUtil.state()).globalLiquidityPosition;
                await positionUtil.setGlobalLiquidityPosition({
                    netSize: 0n,
                    liquidationBufferNetSize: 0n,
                    previousSPPriceX96: globalLiquidityPosition.previousSPPriceX96,
                    side: globalLiquidityPosition.side,
                    liquidity: globalLiquidityPosition.liquidity,
                    unrealizedPnLGrowthX64: globalLiquidityPosition.unrealizedPnLGrowthX64,
                });
            }

            await expect(
                positionUtil.decreasePosition({
                    market: ETHMarketDescriptor.target,
                    account: account,
                    side: SIDE_LONG,
                    marginDelta: 0n,
                    sizeDelta: marketCfg.baseConfig.minMarginPerPosition * 50n,
                    EFC: mockEFC,
                    priceFeed: mockPriceFeed,
                    receiver: other.address,
                }),
            )
                .to.emit(_positionUtil.attach(positionUtil.target), "PreviousSPPriceInitialized")
                .withArgs(ETHMarketDescriptor.target, await mockPriceFeed.getMinPriceX96(ETHMarketDescriptor.target));
        });

        it("should update price state when size delta is positive", async () => {
            const {
                account,
                other,
                ETHMarketDescriptor,
                marketCfg,
                positionUtil,
                _positionUtil,
                mockEFC,
                mockPriceFeed,
            } = await loadFixture(deployFixture);

            await positionUtil.increaseLiquidityPosition({
                market: ETHMarketDescriptor.target,
                account: account,
                marginDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
                liquidityDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
                priceFeed: mockPriceFeed,
            });

            expect((await positionUtil.state()).globalLiquidityPosition.netSize).to.eq(0);

            await positionUtil.increasePosition({
                market: ETHMarketDescriptor.target,
                account: account,
                side: SIDE_LONG,
                marginDelta: marketCfg.baseConfig.minMarginPerPosition * 100n,
                sizeDelta: marketCfg.baseConfig.minMarginPerPosition * 100n,
                EFC: mockEFC.target,
                priceFeed: mockPriceFeed.target,
            });

            await expect(
                positionUtil.decreasePosition({
                    market: ETHMarketDescriptor.target,
                    account: account,
                    side: SIDE_LONG,
                    marginDelta: 0n,
                    sizeDelta: marketCfg.baseConfig.minMarginPerPosition * 50n,
                    EFC: mockEFC,
                    priceFeed: mockPriceFeed,
                    receiver: other.address,
                }),
            )
                .to.emit(_positionUtil.attach(positionUtil.target), "PremiumRateChanged")
                .withArgs(ETHMarketDescriptor.target, () => true);
        });

        it("should distribute fee when size delta is positive", async () => {
            const {
                account,
                other,
                ETHMarketDescriptor,
                marketCfg,
                positionUtil,
                _positionUtil,
                mockEFC,
                mockPriceFeed,
            } = await loadFixture(deployFixture);

            await positionUtil.increaseLiquidityPosition({
                market: ETHMarketDescriptor.target,
                account: account,
                marginDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
                liquidityDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
                priceFeed: mockPriceFeed,
            });

            expect((await positionUtil.state()).globalLiquidityPosition.netSize).to.eq(0);

            await positionUtil.increasePosition({
                market: ETHMarketDescriptor.target,
                account: account,
                side: SIDE_LONG,
                marginDelta: marketCfg.baseConfig.minMarginPerPosition * 100n,
                sizeDelta: marketCfg.baseConfig.minMarginPerPosition * 100n,
                EFC: mockEFC.target,
                priceFeed: mockPriceFeed.target,
            });

            const assertion = expect(
                positionUtil.decreasePosition({
                    market: ETHMarketDescriptor.target,
                    account: account,
                    side: SIDE_LONG,
                    marginDelta: 0n,
                    sizeDelta: marketCfg.baseConfig.minMarginPerPosition * 50n,
                    EFC: mockEFC,
                    priceFeed: mockPriceFeed,
                    receiver: other.address,
                }),
            );
            await assertion.to.emit(
                _positionUtil.attach(positionUtil.target),
                "GlobalLiquidityPositionPnLGrowthIncreasedByTradingFee",
            );
            await assertion.to.not.emit(
                _positionUtil.attach(positionUtil.target),
                "GlobalLiquidationFundIncreasedByLiquidation",
            );
        });

        it("should delete position when size after is zero", async () => {
            const {account, other, ETHMarketDescriptor, marketCfg, positionUtil, mockEFC, mockPriceFeed} =
                await loadFixture(deployFixture);

            await positionUtil.increaseLiquidityPosition({
                market: ETHMarketDescriptor.target,
                account: account,
                marginDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
                liquidityDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
                priceFeed: mockPriceFeed,
            });

            expect((await positionUtil.state()).globalLiquidityPosition.netSize).to.eq(0);

            await positionUtil.increasePosition({
                market: ETHMarketDescriptor.target,
                account: account,
                side: SIDE_LONG,
                marginDelta: marketCfg.baseConfig.minMarginPerPosition * 100n,
                sizeDelta: marketCfg.baseConfig.minMarginPerPosition * 100n,
                EFC: mockEFC.target,
                priceFeed: mockPriceFeed.target,
            });

            await positionUtil.decreasePosition({
                market: ETHMarketDescriptor.target,
                account: account,
                side: SIDE_LONG,
                marginDelta: 0n,
                sizeDelta: marketCfg.baseConfig.minMarginPerPosition * 100n,
                EFC: mockEFC,
                priceFeed: mockPriceFeed,
                receiver: other.address,
            });

            const position = await positionUtil.positions(account.address, SIDE_LONG);
            expect(position.size).to.eq(0n);
        });

        it("should decrease global position when size delta is positive", async () => {
            const {account, other, ETHMarketDescriptor, marketCfg, positionUtil, mockEFC, mockPriceFeed} =
                await loadFixture(deployFixture);

            await positionUtil.increaseLiquidityPosition({
                market: ETHMarketDescriptor.target,
                account: account,
                marginDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
                liquidityDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
                priceFeed: mockPriceFeed,
            });

            const globalPositionBefore = (await positionUtil.state()).globalPosition;
            expect(globalPositionBefore.longSize).to.eq(1n);
            expect(globalPositionBefore.shortSize).to.eq(2n);

            await positionUtil.increasePosition({
                market: ETHMarketDescriptor.target,
                account: account,
                side: SIDE_SHORT,
                marginDelta: marketCfg.baseConfig.minMarginPerPosition * 100n,
                sizeDelta: marketCfg.baseConfig.minMarginPerPosition * 100n,
                EFC: mockEFC.target,
                priceFeed: mockPriceFeed.target,
            });
            let globalPositionAfter = (await positionUtil.state()).globalPosition;
            expect(globalPositionAfter.longSize).to.eq(1n);
            expect(globalPositionAfter.shortSize).to.eq(marketCfg.baseConfig.minMarginPerPosition * 100n + 2n);

            await positionUtil.decreasePosition({
                market: ETHMarketDescriptor.target,
                account: account,
                side: SIDE_SHORT,
                marginDelta: 0n,
                sizeDelta: marketCfg.baseConfig.minMarginPerPosition * 50n,
                EFC: mockEFC,
                priceFeed: mockPriceFeed,
                receiver: other.address,
            });
            globalPositionAfter = (await positionUtil.state()).globalPosition;
            expect(globalPositionAfter.longSize).to.eq(1n);
            expect(globalPositionAfter.shortSize).to.eq(marketCfg.baseConfig.minMarginPerPosition * 50n + 2n);
        });

        it("should emit PositionDecreased event", async () => {
            const {
                account,
                other,
                ETHMarketDescriptor,
                marketCfg,
                positionUtil,
                _positionUtil,
                mockEFC,
                mockPriceFeed,
            } = await loadFixture(deployFixture);

            await positionUtil.increaseLiquidityPosition({
                market: ETHMarketDescriptor.target,
                account: account,
                marginDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
                liquidityDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
                priceFeed: mockPriceFeed,
            });

            await positionUtil.increasePosition({
                market: ETHMarketDescriptor.target,
                account: account,
                side: SIDE_LONG,
                marginDelta: marketCfg.baseConfig.minMarginPerPosition * 100n,
                sizeDelta: marketCfg.baseConfig.minMarginPerPosition * 100n,
                EFC: mockEFC.target,
                priceFeed: mockPriceFeed.target,
            });

            await expect(
                positionUtil.decreasePosition({
                    market: ETHMarketDescriptor.target,
                    account: account,
                    side: SIDE_LONG,
                    marginDelta: 0n,
                    sizeDelta: marketCfg.baseConfig.minMarginPerPosition * 50n,
                    EFC: mockEFC,
                    priceFeed: mockPriceFeed,
                    receiver: other.address,
                }),
            )
                .to.emit(_positionUtil.attach(positionUtil.target), "PositionDecreased")
                .withArgs(
                    ETHMarketDescriptor.target,
                    account.address,
                    SIDE_LONG,
                    () => true,
                    () => true,
                    () => true,
                    () => true,
                    () => true,
                    () => true,
                    () => true,
                    other.address,
                );
        });
    });

    describe("#liquidatePosition", () => {
        it("should revert if the position is not exist", async () => {
            const {account, other, ETHMarketDescriptor, positionUtil, _positionUtil, mockEFC, mockPriceFeed} =
                await loadFixture(deployFixture);

            await expect(
                positionUtil.liquidatePosition({
                    market: ETHMarketDescriptor.target,
                    account: account,
                    side: SIDE_LONG,
                    EFC: mockEFC,
                    priceFeed: mockPriceFeed,
                    feeReceiver: other.address,
                }),
            )
                .to.revertedWithCustomError(_positionUtil, "PositionNotFound")
                .withArgs(account.address, SIDE_LONG);
        });

        it("should revert if the position has not reached the liquidation maintain margin rate", async () => {
            const {
                account,
                other,
                ETHMarketDescriptor,
                marketCfg,
                positionUtil,
                _positionUtil,
                mockEFC,
                mockPriceFeed,
            } = await loadFixture(deployFixture);

            await positionUtil.increaseLiquidityPosition({
                market: ETHMarketDescriptor.target,
                account: account,
                marginDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
                liquidityDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 1000n,
                priceFeed: mockPriceFeed,
            });

            await positionUtil.increasePosition({
                market: ETHMarketDescriptor.target,
                account: account,
                side: SIDE_LONG,
                marginDelta: marketCfg.baseConfig.minMarginPerPosition * 100n,
                sizeDelta: marketCfg.baseConfig.minMarginPerPosition * 100n,
                EFC: mockEFC.target,
                priceFeed: mockPriceFeed.target,
            });

            await expect(
                positionUtil.liquidatePosition({
                    market: ETHMarketDescriptor.target,
                    account: account,
                    side: SIDE_LONG,
                    EFC: mockEFC,
                    priceFeed: mockPriceFeed,
                    feeReceiver: other.address,
                }),
            )
                .to.revertedWithCustomError(_positionUtil, "MarginRateTooLow")
                .withArgs(999999998n, -1n, 600001n);
        });

        it("should settle liquidity unrealized PnL emit SettlementPointReached event", async () => {
            const {
                account,
                other,
                ETHMarketDescriptor,
                marketCfg,
                positionUtil,
                _positionUtil,
                mockEFC,
                mockPriceFeed,
            } = await loadFixture(deployFixture);

            await mockPriceFeed.setMinPriceX96(toPriceX96("1", DECIMALS_18, DECIMALS_6));
            await mockPriceFeed.setMaxPriceX96(toPriceX96("1", DECIMALS_18, DECIMALS_6) + 1n);
            const lastTimestamp = await time.latest();
            const nextHourBegin = lastTimestamp - (lastTimestamp % 3600) + 3600;
            await time.setNextBlockTimestamp(nextHourBegin);

            await positionUtil.increaseLiquidityPosition({
                market: ETHMarketDescriptor.target,
                account: account,
                marginDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 100n,
                liquidityDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 100n,
                priceFeed: mockPriceFeed,
            });

            const _sizeDelta = toPriceX96("1", DECIMALS_18, DECIMALS_6) * 600n;
            const _marginDelta = marketCfg.baseConfig.minMarginPerPosition;

            await time.setNextBlockTimestamp(nextHourBegin + 5);
            await positionUtil.increasePosition({
                market: ETHMarketDescriptor.target,
                account: account,
                side: SIDE_LONG,
                marginDelta: _marginDelta,
                sizeDelta: _sizeDelta,
                EFC: mockEFC.target,
                priceFeed: mockPriceFeed.target,
            });

            await time.setNextBlockTimestamp(nextHourBegin + 10);
            await positionUtil.increasePosition({
                market: ETHMarketDescriptor.target,
                account: account,
                side: SIDE_SHORT,
                marginDelta: _marginDelta,
                sizeDelta: _sizeDelta,
                EFC: mockEFC.target,
                priceFeed: mockPriceFeed.target,
            });

            await time.setNextBlockTimestamp(nextHourBegin + 3600);
            await positionUtil.decreasePosition({
                market: ETHMarketDescriptor.target,
                account: account,
                side: SIDE_LONG,
                marginDelta: 0n,
                sizeDelta: _sizeDelta,
                EFC: mockEFC,
                priceFeed: mockPriceFeed,
                receiver: other.address,
            });

            await time.setNextBlockTimestamp(nextHourBegin + 3605);
            {
                // Make the price change so that the Position can be liquidated
                await mockPriceFeed.setMaxPriceX96(toPriceX96("2", DECIMALS_18, DECIMALS_6) + 2n);
            }

            await expect(
                positionUtil.liquidatePosition({
                    market: ETHMarketDescriptor.target,
                    account: account,
                    side: SIDE_SHORT,
                    EFC: mockEFC,
                    priceFeed: mockPriceFeed.target,
                    feeReceiver: other.address,
                }),
            )
                .to.emit(_positionUtil.attach(positionUtil.target), "SettlementPointReached")
                .withArgs(
                    ETHMarketDescriptor.target,
                    () => true,
                    () => true,
                );
        });

        it("should initialize previous SP price", async () => {
            const {
                account,
                other,
                ETHMarketDescriptor,
                marketCfg,
                positionUtil,
                _positionUtil,
                mockEFC,
                mockPriceFeed,
            } = await loadFixture(deployFixture);

            await mockPriceFeed.setMinPriceX96(toPriceX96("1", DECIMALS_18, DECIMALS_6));
            await mockPriceFeed.setMaxPriceX96(toPriceX96("1", DECIMALS_18, DECIMALS_6) + 1n);
            const lastTimestamp = await time.latest();
            const nextHourBegin = lastTimestamp - (lastTimestamp % 3600) + 3600;
            await time.setNextBlockTimestamp(nextHourBegin);

            await positionUtil.increaseLiquidityPosition({
                market: ETHMarketDescriptor.target,
                account: account,
                marginDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 100n,
                liquidityDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 100n,
                priceFeed: mockPriceFeed,
            });

            const _sizeDelta = toPriceX96("1", DECIMALS_18, DECIMALS_6) * 600n;
            const _marginDelta = marketCfg.baseConfig.minMarginPerPosition;

            await time.setNextBlockTimestamp(nextHourBegin + 5);
            await positionUtil.increasePosition({
                market: ETHMarketDescriptor.target,
                account: account,
                side: SIDE_LONG,
                marginDelta: _marginDelta,
                sizeDelta: _sizeDelta,
                EFC: mockEFC.target,
                priceFeed: mockPriceFeed.target,
            });

            await time.setNextBlockTimestamp(nextHourBegin + 10);
            await positionUtil.increasePosition({
                market: ETHMarketDescriptor.target,
                account: account,
                side: SIDE_SHORT,
                marginDelta: _marginDelta,
                sizeDelta: _sizeDelta,
                EFC: mockEFC.target,
                priceFeed: mockPriceFeed.target,
            });

            await time.setNextBlockTimestamp(nextHourBegin + 3600);
            await positionUtil.decreasePosition({
                market: ETHMarketDescriptor.target,
                account: account,
                side: SIDE_LONG,
                marginDelta: 0n,
                sizeDelta: _sizeDelta,
                EFC: mockEFC,
                priceFeed: mockPriceFeed,
                receiver: other.address,
            });

            await time.setNextBlockTimestamp(nextHourBegin + 3605);
            {
                // Make the price change so that the Position can be liquidated
                await mockPriceFeed.setMaxPriceX96(toPriceX96("2", DECIMALS_18, DECIMALS_6) + 2n);
                // make global net size and liquidation buffer net size to be zero
                const globalLiquidityPosition = (await positionUtil.state()).globalLiquidityPosition;
                await positionUtil.setGlobalLiquidityPosition({
                    netSize: 0n,
                    liquidationBufferNetSize: 0n,
                    previousSPPriceX96: globalLiquidityPosition.previousSPPriceX96,
                    side: globalLiquidityPosition.side,
                    liquidity: globalLiquidityPosition.liquidity,
                    unrealizedPnLGrowthX64: globalLiquidityPosition.unrealizedPnLGrowthX64,
                });
            }

            await expect(
                positionUtil.liquidatePosition({
                    market: ETHMarketDescriptor.target,
                    account: account,
                    side: SIDE_SHORT,
                    EFC: mockEFC,
                    priceFeed: mockPriceFeed.target,
                    feeReceiver: other.address,
                }),
            )
                .to.emit(_positionUtil.attach(positionUtil.target), "PreviousSPPriceInitialized")
                .withArgs(ETHMarketDescriptor.target, await mockPriceFeed.getMaxPriceX96(ETHMarketDescriptor.target));
        });

        it("should update price state", async () => {
            const {
                account,
                other,
                ETHMarketDescriptor,
                marketCfg,
                positionUtil,
                _positionUtil,
                mockEFC,
                mockPriceFeed,
            } = await loadFixture(deployFixture);

            await mockPriceFeed.setMinPriceX96(toPriceX96("1", DECIMALS_18, DECIMALS_6));
            await mockPriceFeed.setMaxPriceX96(toPriceX96("1", DECIMALS_18, DECIMALS_6) + 1n);
            const lastTimestamp = await time.latest();
            const nextHourBegin = lastTimestamp - (lastTimestamp % 3600) + 3600;
            await time.setNextBlockTimestamp(nextHourBegin);

            await positionUtil.increaseLiquidityPosition({
                market: ETHMarketDescriptor.target,
                account: account,
                marginDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 100n,
                liquidityDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 100n,
                priceFeed: mockPriceFeed,
            });

            const _sizeDelta = toPriceX96("1", DECIMALS_18, DECIMALS_6) * 600n;
            const _marginDelta = marketCfg.baseConfig.minMarginPerPosition;

            await time.setNextBlockTimestamp(nextHourBegin + 5);
            await positionUtil.increasePosition({
                market: ETHMarketDescriptor.target,
                account: account,
                side: SIDE_LONG,
                marginDelta: _marginDelta,
                sizeDelta: _sizeDelta,
                EFC: mockEFC.target,
                priceFeed: mockPriceFeed.target,
            });

            await time.setNextBlockTimestamp(nextHourBegin + 10);
            await positionUtil.increasePosition({
                market: ETHMarketDescriptor.target,
                account: account,
                side: SIDE_SHORT,
                marginDelta: _marginDelta,
                sizeDelta: _sizeDelta,
                EFC: mockEFC.target,
                priceFeed: mockPriceFeed.target,
            });

            await time.setNextBlockTimestamp(nextHourBegin + 3600);
            await positionUtil.decreasePosition({
                market: ETHMarketDescriptor.target,
                account: account,
                side: SIDE_LONG,
                marginDelta: 0n,
                sizeDelta: _sizeDelta,
                EFC: mockEFC,
                priceFeed: mockPriceFeed,
                receiver: other.address,
            });

            await time.setNextBlockTimestamp(nextHourBegin + 3605);
            {
                // Make the price change so that the Position can be liquidated
                await mockPriceFeed.setMaxPriceX96(toPriceX96("2", DECIMALS_18, DECIMALS_6) + 2n);
            }

            await expect(
                positionUtil.liquidatePosition({
                    market: ETHMarketDescriptor.target,
                    account: account,
                    side: SIDE_SHORT,
                    EFC: mockEFC,
                    priceFeed: mockPriceFeed.target,
                    feeReceiver: other.address,
                }),
            )
                .to.emit(_positionUtil.attach(positionUtil.target), "PremiumRateChanged")
                .withArgs(ETHMarketDescriptor.target, () => true);
        });

        it("should distribute fee", async () => {
            const {
                account,
                other,
                ETHMarketDescriptor,
                marketCfg,
                positionUtil,
                _positionUtil,
                mockEFC,
                mockPriceFeed,
            } = await loadFixture(deployFixture);

            await mockPriceFeed.setMinPriceX96(toPriceX96("1", DECIMALS_18, DECIMALS_6));
            await mockPriceFeed.setMaxPriceX96(toPriceX96("1", DECIMALS_18, DECIMALS_6) + 1n);
            const lastTimestamp = await time.latest();
            const nextHourBegin = lastTimestamp - (lastTimestamp % 3600) + 3600;
            await time.setNextBlockTimestamp(nextHourBegin);

            await positionUtil.increaseLiquidityPosition({
                market: ETHMarketDescriptor.target,
                account: account,
                marginDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 100n,
                liquidityDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 100n,
                priceFeed: mockPriceFeed,
            });

            const _sizeDelta = toPriceX96("1", DECIMALS_18, DECIMALS_6) * 600n;
            const _marginDelta = marketCfg.baseConfig.minMarginPerPosition;

            await time.setNextBlockTimestamp(nextHourBegin + 5);
            await positionUtil.increasePosition({
                market: ETHMarketDescriptor.target,
                account: account,
                side: SIDE_LONG,
                marginDelta: _marginDelta,
                sizeDelta: _sizeDelta,
                EFC: mockEFC.target,
                priceFeed: mockPriceFeed.target,
            });

            await time.setNextBlockTimestamp(nextHourBegin + 10);
            await positionUtil.increasePosition({
                market: ETHMarketDescriptor.target,
                account: account,
                side: SIDE_SHORT,
                marginDelta: _marginDelta,
                sizeDelta: _sizeDelta,
                EFC: mockEFC.target,
                priceFeed: mockPriceFeed.target,
            });

            await time.setNextBlockTimestamp(nextHourBegin + 3600);
            await positionUtil.decreasePosition({
                market: ETHMarketDescriptor.target,
                account: account,
                side: SIDE_LONG,
                marginDelta: 0n,
                sizeDelta: _sizeDelta,
                EFC: mockEFC,
                priceFeed: mockPriceFeed,
                receiver: other.address,
            });

            await time.setNextBlockTimestamp(nextHourBegin + 3605);
            {
                // Make the price change so that the Position can be liquidated
                await mockPriceFeed.setMaxPriceX96(toPriceX96("2", DECIMALS_18, DECIMALS_6) + 2n);
            }

            const assertion = expect(
                positionUtil.liquidatePosition({
                    market: ETHMarketDescriptor.target,
                    account: account,
                    side: SIDE_SHORT,
                    EFC: mockEFC,
                    priceFeed: mockPriceFeed.target,
                    feeReceiver: other.address,
                }),
            );

            await assertion.to.emit(_positionUtil.attach(positionUtil.target), "ProtocolFeeIncreased");
            await assertion.to.emit(
                _positionUtil.attach(positionUtil.target),
                "GlobalLiquidationFundIncreasedByLiquidation",
            );
            await assertion.to.emit(
                _positionUtil.attach(positionUtil.target),
                "GlobalLiquidityPositionPnLGrowthIncreasedByTradingFee",
            );
        });

        it("should decrease global position", async () => {
            const {account, other, ETHMarketDescriptor, marketCfg, positionUtil, mockEFC, mockPriceFeed} =
                await loadFixture(deployFixture);

            await mockPriceFeed.setMinPriceX96(toPriceX96("1", DECIMALS_18, DECIMALS_6));
            await mockPriceFeed.setMaxPriceX96(toPriceX96("1", DECIMALS_18, DECIMALS_6) + 1n);
            const lastTimestamp = await time.latest();
            const nextHourBegin = lastTimestamp - (lastTimestamp % 3600) + 3600;
            await time.setNextBlockTimestamp(nextHourBegin);

            await positionUtil.increaseLiquidityPosition({
                market: ETHMarketDescriptor.target,
                account: account,
                marginDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 100n,
                liquidityDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 100n,
                priceFeed: mockPriceFeed,
            });

            const _sizeDelta = toPriceX96("1", DECIMALS_18, DECIMALS_6) * 600n;
            const _marginDelta = marketCfg.baseConfig.minMarginPerPosition;

            await time.setNextBlockTimestamp(nextHourBegin + 5);
            await positionUtil.increasePosition({
                market: ETHMarketDescriptor.target,
                account: account,
                side: SIDE_LONG,
                marginDelta: _marginDelta,
                sizeDelta: _sizeDelta,
                EFC: mockEFC.target,
                priceFeed: mockPriceFeed.target,
            });

            await time.setNextBlockTimestamp(nextHourBegin + 10);
            await positionUtil.increasePosition({
                market: ETHMarketDescriptor.target,
                account: account,
                side: SIDE_SHORT,
                marginDelta: _marginDelta,
                sizeDelta: _sizeDelta,
                EFC: mockEFC.target,
                priceFeed: mockPriceFeed.target,
            });

            await time.setNextBlockTimestamp(nextHourBegin + 3600);
            await positionUtil.decreasePosition({
                market: ETHMarketDescriptor.target,
                account: account,
                side: SIDE_LONG,
                marginDelta: 0n,
                sizeDelta: _sizeDelta,
                EFC: mockEFC,
                priceFeed: mockPriceFeed,
                receiver: other.address,
            });

            await time.setNextBlockTimestamp(nextHourBegin + 3605);
            {
                // Make the price change so that the Position can be liquidated
                await mockPriceFeed.setMaxPriceX96(toPriceX96("2", DECIMALS_18, DECIMALS_6) + 2n);
            }

            const globalPositionBefore = (await positionUtil.state()).globalPosition;

            await positionUtil.liquidatePosition({
                market: ETHMarketDescriptor.target,
                account: account,
                side: SIDE_SHORT,
                EFC: mockEFC,
                priceFeed: mockPriceFeed.target,
                feeReceiver: other.address,
            });

            const globalPositionAfter = (await positionUtil.state()).globalPosition;
            expect(globalPositionAfter.longSize).to.eq(globalPositionBefore.longSize);
            expect(globalPositionAfter.shortSize).to.eq(globalPositionBefore.shortSize - _sizeDelta);
        });

        it("should delete position", async () => {
            const {account, other, ETHMarketDescriptor, marketCfg, positionUtil, mockEFC, mockPriceFeed} =
                await loadFixture(deployFixture);

            await mockPriceFeed.setMinPriceX96(toPriceX96("1", DECIMALS_18, DECIMALS_6));
            await mockPriceFeed.setMaxPriceX96(toPriceX96("1", DECIMALS_18, DECIMALS_6) + 1n);
            const lastTimestamp = await time.latest();
            const nextHourBegin = lastTimestamp - (lastTimestamp % 3600) + 3600;
            await time.setNextBlockTimestamp(nextHourBegin);

            await positionUtil.increaseLiquidityPosition({
                market: ETHMarketDescriptor.target,
                account: account,
                marginDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 100n,
                liquidityDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 100n,
                priceFeed: mockPriceFeed,
            });

            const _sizeDelta = toPriceX96("1", DECIMALS_18, DECIMALS_6) * 600n;
            const _marginDelta = marketCfg.baseConfig.minMarginPerPosition;

            await time.setNextBlockTimestamp(nextHourBegin + 5);
            await positionUtil.increasePosition({
                market: ETHMarketDescriptor.target,
                account: account,
                side: SIDE_LONG,
                marginDelta: _marginDelta,
                sizeDelta: _sizeDelta,
                EFC: mockEFC.target,
                priceFeed: mockPriceFeed.target,
            });

            await time.setNextBlockTimestamp(nextHourBegin + 10);
            await positionUtil.increasePosition({
                market: ETHMarketDescriptor.target,
                account: account,
                side: SIDE_SHORT,
                marginDelta: _marginDelta,
                sizeDelta: _sizeDelta,
                EFC: mockEFC.target,
                priceFeed: mockPriceFeed.target,
            });

            await time.setNextBlockTimestamp(nextHourBegin + 3600);
            await positionUtil.decreasePosition({
                market: ETHMarketDescriptor.target,
                account: account,
                side: SIDE_LONG,
                marginDelta: 0n,
                sizeDelta: _sizeDelta,
                EFC: mockEFC,
                priceFeed: mockPriceFeed,
                receiver: other.address,
            });

            await time.setNextBlockTimestamp(nextHourBegin + 3605);
            {
                // Make the price change so that the Position can be liquidated
                await mockPriceFeed.setMaxPriceX96(toPriceX96("2", DECIMALS_18, DECIMALS_6) + 2n);
            }

            await positionUtil.liquidatePosition({
                market: ETHMarketDescriptor.target,
                account: account,
                side: SIDE_SHORT,
                EFC: mockEFC,
                priceFeed: mockPriceFeed.target,
                feeReceiver: other.address,
            });

            const position = await positionUtil.positions(account.address, SIDE_SHORT);
            expect(position.size).to.eq(0n);
        });

        it("should emit PositionLiquidated event", async () => {
            const {
                account,
                other,
                ETHMarketDescriptor,
                marketCfg,
                positionUtil,
                _positionUtil,
                mockEFC,
                mockPriceFeed,
            } = await loadFixture(deployFixture);

            await mockPriceFeed.setMinPriceX96(toPriceX96("1", DECIMALS_18, DECIMALS_6));
            await mockPriceFeed.setMaxPriceX96(toPriceX96("1", DECIMALS_18, DECIMALS_6) + 1n);
            const lastTimestamp = await time.latest();
            const nextHourBegin = lastTimestamp - (lastTimestamp % 3600) + 3600;
            await time.setNextBlockTimestamp(nextHourBegin);

            await positionUtil.increaseLiquidityPosition({
                market: ETHMarketDescriptor.target,
                account: account,
                marginDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 100n,
                liquidityDelta: marketCfg.baseConfig.minMarginPerLiquidityPosition * 100n,
                priceFeed: mockPriceFeed,
            });

            const _sizeDelta = toPriceX96("1", DECIMALS_18, DECIMALS_6) * 600n;
            const _marginDelta = marketCfg.baseConfig.minMarginPerPosition;

            await time.setNextBlockTimestamp(nextHourBegin + 5);
            await positionUtil.increasePosition({
                market: ETHMarketDescriptor.target,
                account: account,
                side: SIDE_LONG,
                marginDelta: _marginDelta,
                sizeDelta: _sizeDelta,
                EFC: mockEFC.target,
                priceFeed: mockPriceFeed.target,
            });

            await time.setNextBlockTimestamp(nextHourBegin + 10);
            await positionUtil.increasePosition({
                market: ETHMarketDescriptor.target,
                account: account,
                side: SIDE_SHORT,
                marginDelta: _marginDelta,
                sizeDelta: _sizeDelta,
                EFC: mockEFC.target,
                priceFeed: mockPriceFeed.target,
            });

            await time.setNextBlockTimestamp(nextHourBegin + 3600);
            await positionUtil.decreasePosition({
                market: ETHMarketDescriptor.target,
                account: account,
                side: SIDE_LONG,
                marginDelta: 0n,
                sizeDelta: _sizeDelta,
                EFC: mockEFC,
                priceFeed: mockPriceFeed,
                receiver: other.address,
            });

            await time.setNextBlockTimestamp(nextHourBegin + 3605);
            {
                // Make the price change so that the Position can be liquidated
                await mockPriceFeed.setMaxPriceX96(toPriceX96("2", DECIMALS_18, DECIMALS_6) + 2n);
            }

            await expect(
                positionUtil.liquidatePosition({
                    market: ETHMarketDescriptor.target,
                    account: account,
                    side: SIDE_SHORT,
                    EFC: mockEFC,
                    priceFeed: mockPriceFeed.target,
                    feeReceiver: other.address,
                }),
            )
                .to.emit(_positionUtil.attach(positionUtil.target), "PositionLiquidated")
                .withArgs(
                    ETHMarketDescriptor.target,
                    account.address,
                    account.address,
                    SIDE_SHORT,
                    toPriceX96("2", DECIMALS_18, DECIMALS_6) + 2n,
                    () => true,
                    () => true,
                    () => true,
                    () => true,
                    () => true,
                    () => true,
                    other.address,
                );
        });
    });
});

function _isAcceptableLiquidationPriceX96(_side: Side, _liquidationPriceX96: bigint, _entryPriceX96: bigint): boolean {
    return (
        (isLongSide(_side) && _liquidationPriceX96 < _entryPriceX96) ||
        (isShortSide(_side) && _liquidationPriceX96 > _entryPriceX96)
    );
}

function _calculateLiquidationPriceX96(
    _side: Side,
    _positionMargin: bigint,
    _positionSize: bigint,
    _positionEntryPriceX96: bigint,
    _fundingFee: bigint,
    _liquidationFeeRate: bigint,
    _tradingFeeRate: bigint,
    _liquidationExecutionFee: bigint,
): bigint {
    let marginAfter = _positionMargin;
    marginAfter = marginAfter + _fundingFee;
    expect(marginAfter).to.gte(0n);
    if (isLongSide(_side)) {
        let numeratorX96 = _positionEntryPriceX96 * _positionSize * (BASIS_POINTS_DIVISOR + _liquidationFeeRate);
        if (marginAfter >= _liquidationExecutionFee) {
            const numeratorPart2X96 = (marginAfter - _liquidationExecutionFee) * BASIS_POINTS_DIVISOR * Q96;
            numeratorX96 = numeratorX96 - numeratorPart2X96;
            expect(numeratorX96).to.gt(0n);
        } else {
            const numeratorPart2X96 = (_liquidationExecutionFee - marginAfter) * BASIS_POINTS_DIVISOR * Q96;
            numeratorX96 = numeratorX96 + numeratorPart2X96;
        }
        return numeratorX96 / (_positionSize * (BASIS_POINTS_DIVISOR - _tradingFeeRate));
    } else {
        let numeratorX96 = _positionEntryPriceX96 * _positionSize * (BASIS_POINTS_DIVISOR - _liquidationFeeRate);
        if (marginAfter >= _liquidationExecutionFee) {
            const numeratorPart2X96 = (marginAfter - _liquidationExecutionFee) * BASIS_POINTS_DIVISOR * Q96;
            numeratorX96 = numeratorX96 + numeratorPart2X96;
        } else {
            const numeratorPart2X96 = (_liquidationExecutionFee - marginAfter) * BASIS_POINTS_DIVISOR * Q96;
            numeratorX96 = numeratorX96 - numeratorPart2X96;
            expect(numeratorX96).to.gt(0n);
        }
        return mulDiv(numeratorX96, 1n, _positionSize * (BASIS_POINTS_DIVISOR + _tradingFeeRate), Rounding.Up);
    }
}

function _newPosition() {
    return {
        margin: 0n,
        size: 0n,
        entryPriceX96: 0n,
        entryFundingRateGrowthX96: 0n,
    };
}
