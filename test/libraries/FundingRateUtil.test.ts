import {ethers} from "hardhat";
import {
    ADJUST_FUNDING_RATE_INTERVAL,
    BASIS_POINTS_DIVISOR,
    DECIMALS_18,
    DECIMALS_6,
    flipSide,
    isLongSide,
    mulDiv,
    PREMIUM_RATE_AVG_DENOMINATOR,
    PREMIUM_RATE_CLAMP_BOUNDARY_X96,
    Q32,
    Q96,
    REQUIRED_SAMPLE_COUNT,
    Rounding,
    SAMPLE_PREMIUM_RATE_INTERVAL,
    SIDE_LONG,
    SIDE_SHORT,
    toPriceX96,
    toX96,
} from "../shared/Constants";
import {newMarketBaseConfig} from "../shared/MarketConfig";
import {loadFixture, time} from "@nomicfoundation/hardhat-network-helpers";
import {expect} from "chai";
import {MarketDescriptor} from "../../typechain-types";
import {toBigInt} from "ethers";

describe("FundingRateUtil", () => {
    async function deployFixture() {
        const mockPriceFeed = await ethers.deployContract("MockPriceFeed");
        await mockPriceFeed.waitForDeployment();
        await mockPriceFeed.setMinPriceX96(toPriceX96("1808.234", DECIMALS_18, DECIMALS_6));
        await mockPriceFeed.setMaxPriceX96(toPriceX96("1808.235", DECIMALS_18, DECIMALS_6));

        const MarketDescriptorDeployer = await ethers.deployContract("MarketDescriptorDeployer");
        await MarketDescriptorDeployer.waitForDeployment();
        await MarketDescriptorDeployer.deploy("ETH");
        const ETHMarketDescriptorAddr = await MarketDescriptorDeployer.descriptors("ETH");
        const MarketDescriptor = await ethers.getContractFactory("MarketDescriptor");
        const ETHMarketDescriptor = MarketDescriptor.attach(ETHMarketDescriptorAddr) as MarketDescriptor;

        const _fundingRateUtil = await ethers.deployContract("FundingRateUtil");
        await _fundingRateUtil.waitForDeployment();

        const fundingRateUtil = await ethers.deployContract("FundingRateUtilTest", {
            libraries: {
                FundingRateUtil: _fundingRateUtil.target,
            },
        });
        await fundingRateUtil.waitForDeployment();
        await fundingRateUtil.setPriceFeed(mockPriceFeed.target);

        const marketBaseCfg = newMarketBaseConfig();
        await fundingRateUtil.setMarketBaseConfig(marketBaseCfg);

        return {fundingRateUtil, _fundingRateUtil, marketBaseCfg, mockPriceFeed, ETHMarketDescriptor};
    }

    describe("#snapshotAndAdjustGlobalFundingRate", () => {
        it("should snapshot previous global funding rate", async () => {
            const {fundingRateUtil, ETHMarketDescriptor} = await loadFixture(deployFixture);

            await fundingRateUtil.setGlobalPosition({
                longSize: 1,
                shortSize: 2,
                maxSize: 3,
                maxSizePerPosition: 4,
                longFundingRateGrowthX96: 5,
                shortFundingRateGrowthX96: 6,
            });

            await fundingRateUtil.setGlobalFundingRateSample({
                lastAdjustFundingRateTime: 7,
                sampleCount: 8,
                cumulativePremiumRateX96: 9,
            });

            await fundingRateUtil.snapshotAndAdjustGlobalFundingRate(ETHMarketDescriptor.target, 10n, 11n, 12n);

            const stateAfter = await fundingRateUtil.state();
            expect(stateAfter.previousGlobalFundingRate.longFundingRateGrowthX96).to.eq(5);
            expect(stateAfter.previousGlobalFundingRate.shortFundingRateGrowthX96).to.eq(6);
            expect(stateAfter.globalPosition.longFundingRateGrowthX96).to.eq(11);
            expect(stateAfter.globalPosition.shortFundingRateGrowthX96).to.eq(12);
        });

        it("should emit FundingRateGrowthAdjusted event", async () => {
            const {fundingRateUtil, _fundingRateUtil, ETHMarketDescriptor} = await loadFixture(deployFixture);

            await fundingRateUtil.setGlobalPosition({
                longSize: 1,
                shortSize: 2,
                maxSize: 3,
                maxSizePerPosition: 4,
                longFundingRateGrowthX96: 5,
                shortFundingRateGrowthX96: 6,
            });

            await fundingRateUtil.setGlobalFundingRateSample({
                lastAdjustFundingRateTime: 7,
                sampleCount: 8,
                cumulativePremiumRateX96: 9,
            });

            await expect(fundingRateUtil.snapshotAndAdjustGlobalFundingRate(ETHMarketDescriptor.target, 10n, 11n, 12n))
                .to.emit(_fundingRateUtil.attach(fundingRateUtil.target), "FundingRateGrowthAdjusted")
                .withArgs(ETHMarketDescriptor.target, 10n, 11n, 12n, 7n);
        });
    });

    describe("#sampleAndAdjustFundingRate", () => {
        function newGlobalPosition() {
            return {
                longSize: 1n,
                shortSize: 2n,
                maxSize: 3n,
                maxSizePerPosition: 4n,
                longFundingRateGrowthX96: 5n,
                shortFundingRateGrowthX96: 6n,
            };
        }

        function newGlobalLiquidityPosition() {
            return {
                netSize: 10n,
                liquidationBufferNetSize: 11n,
                previousSPPriceX96: 12n,
                side: SIDE_LONG,
                liquidity: 13n,
                unrealizedPnLGrowthX64: 14n,
            };
        }

        function newPriceState() {
            return {
                premiumRateX96: 15n,
                pendingVertexIndex: 1n,
                currentVertexIndex: 2n,
                basisIndexPriceX96: 16n,
                priceVertices: [
                    {size: 0n, premiumRateX96: 0n},
                    {size: 0n, premiumRateX96: 0n},
                    {size: 0n, premiumRateX96: 0n},
                    {size: 0n, premiumRateX96: 0n},
                    {size: 0n, premiumRateX96: 0n},
                    {size: 0n, premiumRateX96: 0n},
                    {size: 0n, premiumRateX96: 0n},
                    {size: 0n, premiumRateX96: 0n},
                    {size: 0n, premiumRateX96: 0n},
                    {size: 0n, premiumRateX96: 0n},
                ],
                liquidationBufferNetSizes: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            };
        }

        it("should do nothing if time delta is less than 5 seconds", async () => {
            const {fundingRateUtil, _fundingRateUtil, ETHMarketDescriptor, marketBaseCfg, mockPriceFeed} =
                await loadFixture(deployFixture);
            const lastTimestamp = await time.latest();
            const nextHourBegin = lastTimestamp - (lastTimestamp % 3600) + 3600;
            await time.setNextBlockTimestamp(nextHourBegin);

            let globalPosition = newGlobalPosition();
            let globalLiquidityPosition = newGlobalLiquidityPosition();
            let priceState = newPriceState();

            let globalFundingRateSample = {
                lastAdjustFundingRateTime: toBigInt(nextHourBegin + 2),
                sampleCount: 0n,
                cumulativePremiumRateX96: 9n,
            };

            await fundingRateUtil.setGlobalPosition(globalPosition);
            await fundingRateUtil.setGlobalFundingRateSample(globalFundingRateSample);
            await fundingRateUtil.setGlobalLiquidityPosition(globalLiquidityPosition);
            await fundingRateUtil.setPriceState(priceState);

            await time.setNextBlockTimestamp(nextHourBegin + 5);
            const simulateRes = simulateSampleAndAdjustFundingRate(
                globalPosition,
                globalLiquidityPosition,
                globalFundingRateSample,
                priceState,
                marketBaseCfg.maxFundingRate,
                toBigInt(nextHourBegin + 5),
                isLongSide(flipSide(globalLiquidityPosition.side))
                    ? await mockPriceFeed.getMaxPriceX96(ETHMarketDescriptor.target)
                    : await mockPriceFeed.getMinPriceX96(ETHMarketDescriptor.target),
                await mockPriceFeed.getMaxPriceX96(ETHMarketDescriptor.target),
                marketBaseCfg.interestRate,
            );
            expect(simulateRes.timeDelta).to.lt(SAMPLE_PREMIUM_RATE_INTERVAL);
            expect(simulateRes.shouldAdjustFundingRate).to.false;
            expect(simulateRes.fundingRateDeltaX96).to.eq(0n);

            const assertion = expect(fundingRateUtil.sampleAndAdjustFundingRate(ETHMarketDescriptor.target));
            await assertion.to.not.emit(
                _fundingRateUtil.attach(fundingRateUtil.target),
                "GlobalFundingRateSampleAdjusted",
            );
            await assertion.to.not.emit(_fundingRateUtil.attach(fundingRateUtil.target), "FundingRateGrowthAdjusted");

            {
                const stateAfter = await fundingRateUtil.state();
                expect(stateAfter.globalPosition.longSize).to.eq(globalPosition.longSize);
                expect(stateAfter.globalPosition.shortSize).to.eq(globalPosition.shortSize);
                expect(stateAfter.globalPosition.maxSize).to.eq(globalPosition.maxSize);
                expect(stateAfter.globalPosition.maxSizePerPosition).to.eq(globalPosition.maxSizePerPosition);
                expect(stateAfter.globalPosition.longFundingRateGrowthX96).to.eq(
                    globalPosition.longFundingRateGrowthX96,
                );
                expect(stateAfter.globalPosition.shortFundingRateGrowthX96).to.eq(
                    globalPosition.shortFundingRateGrowthX96,
                );

                expect(stateAfter.globalLiquidityPosition.netSize).to.eq(globalLiquidityPosition.netSize);
                expect(stateAfter.globalLiquidityPosition.liquidationBufferNetSize).to.eq(
                    globalLiquidityPosition.liquidationBufferNetSize,
                );
                expect(stateAfter.globalLiquidityPosition.previousSPPriceX96).to.eq(
                    globalLiquidityPosition.previousSPPriceX96,
                );
                expect(stateAfter.globalLiquidityPosition.side).to.eq(globalLiquidityPosition.side);
                expect(stateAfter.globalLiquidityPosition.liquidity).to.eq(globalLiquidityPosition.liquidity);
                expect(stateAfter.globalLiquidityPosition.unrealizedPnLGrowthX64).to.eq(
                    globalLiquidityPosition.unrealizedPnLGrowthX64,
                );

                expect(stateAfter.globalFundingRateSample.lastAdjustFundingRateTime).to.eq(
                    globalFundingRateSample.lastAdjustFundingRateTime,
                );
                expect(stateAfter.globalFundingRateSample.sampleCount).to.eq(globalFundingRateSample.sampleCount);
                expect(stateAfter.globalFundingRateSample.cumulativePremiumRateX96).to.eq(
                    globalFundingRateSample.cumulativePremiumRateX96,
                );
            }
        });

        it("should sample premium rate if time delta is greater than 5 seconds", async () => {
            const {fundingRateUtil, _fundingRateUtil, ETHMarketDescriptor, marketBaseCfg, mockPriceFeed} =
                await loadFixture(deployFixture);

            const lastTimestamp = await time.latest();
            const nextHourBegin = lastTimestamp - (lastTimestamp % 3600) + 3600;
            await time.setNextBlockTimestamp(nextHourBegin);

            let globalPosition = newGlobalPosition();
            let globalLiquidityPosition = newGlobalLiquidityPosition();
            let priceState = newPriceState();

            let globalFundingRateSample = {
                lastAdjustFundingRateTime: toBigInt(nextHourBegin),
                sampleCount: 8n,
                cumulativePremiumRateX96: 9n,
            };

            await fundingRateUtil.setGlobalPosition(globalPosition);
            await fundingRateUtil.setGlobalFundingRateSample(globalFundingRateSample);
            await fundingRateUtil.setGlobalLiquidityPosition(globalLiquidityPosition);
            await fundingRateUtil.setPriceState(priceState);

            await time.setNextBlockTimestamp(nextHourBegin + 46);
            const simulateRes = simulateSampleAndAdjustFundingRate(
                globalPosition,
                globalLiquidityPosition,
                globalFundingRateSample,
                priceState,
                marketBaseCfg.maxFundingRate,
                toBigInt(nextHourBegin + 46),
                isLongSide(flipSide(globalLiquidityPosition.side))
                    ? await mockPriceFeed.getMaxPriceX96(ETHMarketDescriptor.target)
                    : await mockPriceFeed.getMinPriceX96(ETHMarketDescriptor.target),
                await mockPriceFeed.getMaxPriceX96(ETHMarketDescriptor.target),
                marketBaseCfg.interestRate,
            );
            expect(simulateRes.timeDelta).to.gte(SAMPLE_PREMIUM_RATE_INTERVAL);
            expect(simulateRes.shouldAdjustFundingRate).to.false;
            expect(simulateRes.fundingRateDeltaX96).to.eq(0n);
            expect(simulateRes.sampleCountAfter).to.eq(9n);

            const assertion = expect(fundingRateUtil.sampleAndAdjustFundingRate(ETHMarketDescriptor.target));
            await assertion.to
                .emit(_fundingRateUtil.attach(fundingRateUtil.target), "GlobalFundingRateSampleAdjusted")
                .withArgs(
                    ETHMarketDescriptor.target,
                    simulateRes.sampleCountAfter,
                    simulateRes.cumulativePremiumRateAfterX96,
                );
            await assertion.to.not.emit(_fundingRateUtil.attach(fundingRateUtil.target), "FundingRateGrowthAdjusted");

            {
                const stateAfter = await fundingRateUtil.state();
                expect(stateAfter.globalPosition.longSize).to.eq(globalPosition.longSize);
                expect(stateAfter.globalPosition.shortSize).to.eq(globalPosition.shortSize);
                expect(stateAfter.globalPosition.maxSize).to.eq(globalPosition.maxSize);
                expect(stateAfter.globalPosition.maxSizePerPosition).to.eq(globalPosition.maxSizePerPosition);
                expect(stateAfter.globalPosition.longFundingRateGrowthX96).to.eq(
                    globalPosition.longFundingRateGrowthX96,
                );
                expect(stateAfter.globalPosition.shortFundingRateGrowthX96).to.eq(
                    globalPosition.shortFundingRateGrowthX96,
                );

                expect(stateAfter.globalLiquidityPosition.netSize).to.eq(globalLiquidityPosition.netSize);
                expect(stateAfter.globalLiquidityPosition.liquidationBufferNetSize).to.eq(
                    globalLiquidityPosition.liquidationBufferNetSize,
                );
                expect(stateAfter.globalLiquidityPosition.previousSPPriceX96).to.eq(
                    globalLiquidityPosition.previousSPPriceX96,
                );
                expect(stateAfter.globalLiquidityPosition.side).to.eq(globalLiquidityPosition.side);
                expect(stateAfter.globalLiquidityPosition.liquidity).to.eq(globalLiquidityPosition.liquidity);
                expect(stateAfter.globalLiquidityPosition.unrealizedPnLGrowthX64).to.eq(
                    globalLiquidityPosition.unrealizedPnLGrowthX64,
                );

                expect(stateAfter.globalFundingRateSample.lastAdjustFundingRateTime).to.eq(
                    simulateRes.lastAdjustFundingRateTimeAfter,
                );
                expect(stateAfter.globalFundingRateSample.sampleCount).to.eq(simulateRes.sampleCountAfter);
                expect(stateAfter.globalFundingRateSample.cumulativePremiumRateX96).to.eq(
                    simulateRes.cumulativePremiumRateAfterX96,
                );
            }
        });

        it("should sample premium rate if time delta is greater than 60 seconds", async () => {
            const {fundingRateUtil, _fundingRateUtil, ETHMarketDescriptor, marketBaseCfg, mockPriceFeed} =
                await loadFixture(deployFixture);

            const lastTimestamp = await time.latest();
            const nextHourBegin = lastTimestamp - (lastTimestamp % 3600) + 3600;
            await time.setNextBlockTimestamp(nextHourBegin);

            let globalPosition = newGlobalPosition();
            let globalLiquidityPosition = newGlobalLiquidityPosition();
            let priceState = newPriceState();

            let globalFundingRateSample = {
                lastAdjustFundingRateTime: toBigInt(nextHourBegin),
                sampleCount: 8n,
                cumulativePremiumRateX96: 9n,
            };

            await fundingRateUtil.setGlobalPosition(globalPosition);
            await fundingRateUtil.setGlobalFundingRateSample(globalFundingRateSample);
            await fundingRateUtil.setGlobalLiquidityPosition(globalLiquidityPosition);
            await fundingRateUtil.setPriceState(priceState);

            await time.setNextBlockTimestamp(nextHourBegin + 101);
            const simulateRes = simulateSampleAndAdjustFundingRate(
                globalPosition,
                globalLiquidityPosition,
                globalFundingRateSample,
                priceState,
                marketBaseCfg.maxFundingRate,
                toBigInt(nextHourBegin + 101),
                isLongSide(flipSide(globalLiquidityPosition.side))
                    ? await mockPriceFeed.getMaxPriceX96(ETHMarketDescriptor.target)
                    : await mockPriceFeed.getMinPriceX96(ETHMarketDescriptor.target),
                await mockPriceFeed.getMaxPriceX96(ETHMarketDescriptor.target),
                marketBaseCfg.interestRate,
            );
            expect(simulateRes.timeDelta).to.gte(SAMPLE_PREMIUM_RATE_INTERVAL);
            expect(simulateRes.shouldAdjustFundingRate).to.false;
            expect(simulateRes.fundingRateDeltaX96).to.eq(0n);
            expect(simulateRes.sampleCountAfter).to.eq(20n);

            const assertion = expect(fundingRateUtil.sampleAndAdjustFundingRate(ETHMarketDescriptor.target));
            await assertion.to
                .emit(_fundingRateUtil.attach(fundingRateUtil.target), "GlobalFundingRateSampleAdjusted")
                .withArgs(
                    ETHMarketDescriptor.target,
                    simulateRes.sampleCountAfter,
                    simulateRes.cumulativePremiumRateAfterX96,
                );
            await assertion.to.not.emit(_fundingRateUtil.attach(fundingRateUtil.target), "FundingRateGrowthAdjusted");

            {
                const stateAfter = await fundingRateUtil.state();
                expect(stateAfter.globalPosition.longSize).to.eq(globalPosition.longSize);
                expect(stateAfter.globalPosition.shortSize).to.eq(globalPosition.shortSize);
                expect(stateAfter.globalPosition.maxSize).to.eq(globalPosition.maxSize);
                expect(stateAfter.globalPosition.maxSizePerPosition).to.eq(globalPosition.maxSizePerPosition);
                expect(stateAfter.globalPosition.longFundingRateGrowthX96).to.eq(
                    globalPosition.longFundingRateGrowthX96,
                );
                expect(stateAfter.globalPosition.shortFundingRateGrowthX96).to.eq(
                    globalPosition.shortFundingRateGrowthX96,
                );

                expect(stateAfter.globalLiquidityPosition.netSize).to.eq(globalLiquidityPosition.netSize);
                expect(stateAfter.globalLiquidityPosition.liquidationBufferNetSize).to.eq(
                    globalLiquidityPosition.liquidationBufferNetSize,
                );
                expect(stateAfter.globalLiquidityPosition.previousSPPriceX96).to.eq(
                    globalLiquidityPosition.previousSPPriceX96,
                );
                expect(stateAfter.globalLiquidityPosition.side).to.eq(globalLiquidityPosition.side);
                expect(stateAfter.globalLiquidityPosition.liquidity).to.eq(globalLiquidityPosition.liquidity);
                expect(stateAfter.globalLiquidityPosition.unrealizedPnLGrowthX64).to.eq(
                    globalLiquidityPosition.unrealizedPnLGrowthX64,
                );

                expect(stateAfter.globalFundingRateSample.lastAdjustFundingRateTime).to.eq(
                    simulateRes.lastAdjustFundingRateTimeAfter,
                );
                expect(stateAfter.globalFundingRateSample.sampleCount).to.eq(simulateRes.sampleCountAfter);
                expect(stateAfter.globalFundingRateSample.cumulativePremiumRateX96).to.eq(
                    simulateRes.cumulativePremiumRateAfterX96,
                );
            }
        });

        it("should not adjust global funding rate if sample count is less then 720", async () => {
            const {fundingRateUtil, _fundingRateUtil, ETHMarketDescriptor, marketBaseCfg, mockPriceFeed} =
                await loadFixture(deployFixture);

            const lastTimestamp = await time.latest();
            const nextHourBegin = lastTimestamp - (lastTimestamp % 3600) + 3600;
            await time.setNextBlockTimestamp(nextHourBegin);

            let globalPosition = newGlobalPosition();
            let globalLiquidityPosition = newGlobalLiquidityPosition();
            let priceState = newPriceState();

            let globalFundingRateSample = {
                lastAdjustFundingRateTime: toBigInt(nextHourBegin),
                sampleCount: 8n,
                cumulativePremiumRateX96: 9n,
            };

            await fundingRateUtil.setGlobalPosition(globalPosition);
            await fundingRateUtil.setGlobalFundingRateSample(globalFundingRateSample);
            await fundingRateUtil.setGlobalLiquidityPosition(globalLiquidityPosition);
            await fundingRateUtil.setPriceState(priceState);

            await time.setNextBlockTimestamp(nextHourBegin + 3595);
            const simulateRes = simulateSampleAndAdjustFundingRate(
                globalPosition,
                globalLiquidityPosition,
                globalFundingRateSample,
                priceState,
                marketBaseCfg.maxFundingRate,
                toBigInt(nextHourBegin + 3595),
                isLongSide(flipSide(globalLiquidityPosition.side))
                    ? await mockPriceFeed.getMaxPriceX96(ETHMarketDescriptor.target)
                    : await mockPriceFeed.getMinPriceX96(ETHMarketDescriptor.target),
                await mockPriceFeed.getMaxPriceX96(ETHMarketDescriptor.target),
                marketBaseCfg.interestRate,
            );
            expect(simulateRes.timeDelta).to.gte(SAMPLE_PREMIUM_RATE_INTERVAL);
            expect(simulateRes.shouldAdjustFundingRate).to.false;
            expect(simulateRes.fundingRateDeltaX96).to.eq(0n);
            expect(simulateRes.sampleCountAfter).to.eq(719n);

            const assertion = expect(fundingRateUtil.sampleAndAdjustFundingRate(ETHMarketDescriptor.target));
            await assertion.to
                .emit(_fundingRateUtil.attach(fundingRateUtil.target), "GlobalFundingRateSampleAdjusted")
                .withArgs(
                    ETHMarketDescriptor.target,
                    simulateRes.sampleCountAfter,
                    simulateRes.cumulativePremiumRateAfterX96,
                );
            await assertion.to.not.emit(_fundingRateUtil.attach(fundingRateUtil.target), "FundingRateGrowthAdjusted");

            {
                const stateAfter = await fundingRateUtil.state();
                expect(stateAfter.globalPosition.longSize).to.eq(globalPosition.longSize);
                expect(stateAfter.globalPosition.shortSize).to.eq(globalPosition.shortSize);
                expect(stateAfter.globalPosition.maxSize).to.eq(globalPosition.maxSize);
                expect(stateAfter.globalPosition.maxSizePerPosition).to.eq(globalPosition.maxSizePerPosition);
                expect(stateAfter.globalPosition.longFundingRateGrowthX96).to.eq(
                    globalPosition.longFundingRateGrowthX96,
                );
                expect(stateAfter.globalPosition.shortFundingRateGrowthX96).to.eq(
                    globalPosition.shortFundingRateGrowthX96,
                );

                expect(stateAfter.globalLiquidityPosition.netSize).to.eq(globalLiquidityPosition.netSize);
                expect(stateAfter.globalLiquidityPosition.liquidationBufferNetSize).to.eq(
                    globalLiquidityPosition.liquidationBufferNetSize,
                );
                expect(stateAfter.globalLiquidityPosition.previousSPPriceX96).to.eq(
                    globalLiquidityPosition.previousSPPriceX96,
                );
                expect(stateAfter.globalLiquidityPosition.side).to.eq(globalLiquidityPosition.side);
                expect(stateAfter.globalLiquidityPosition.liquidity).to.eq(globalLiquidityPosition.liquidity);
                expect(stateAfter.globalLiquidityPosition.unrealizedPnLGrowthX64).to.eq(
                    globalLiquidityPosition.unrealizedPnLGrowthX64,
                );

                expect(stateAfter.globalFundingRateSample.lastAdjustFundingRateTime).to.eq(
                    simulateRes.lastAdjustFundingRateTimeAfter,
                );
                expect(stateAfter.globalFundingRateSample.sampleCount).to.eq(simulateRes.sampleCountAfter);
                expect(stateAfter.globalFundingRateSample.cumulativePremiumRateX96).to.eq(
                    simulateRes.cumulativePremiumRateAfterX96,
                );
            }
        });

        it("should adjust global funding rate if sample count is equal to 720", async () => {
            const {fundingRateUtil, _fundingRateUtil, ETHMarketDescriptor, marketBaseCfg, mockPriceFeed} =
                await loadFixture(deployFixture);

            const lastTimestamp = await time.latest();
            const nextHourBegin = lastTimestamp - (lastTimestamp % 3600) + 3600;
            await time.setNextBlockTimestamp(nextHourBegin);

            let globalPosition = newGlobalPosition();
            let globalLiquidityPosition = newGlobalLiquidityPosition();
            let priceState = newPriceState();

            let globalFundingRateSample = {
                lastAdjustFundingRateTime: toBigInt(nextHourBegin),
                sampleCount: 8n,
                cumulativePremiumRateX96: 9n,
            };

            await fundingRateUtil.setGlobalPosition(globalPosition);
            await fundingRateUtil.setGlobalFundingRateSample(globalFundingRateSample);
            await fundingRateUtil.setGlobalLiquidityPosition(globalLiquidityPosition);
            await fundingRateUtil.setPriceState(priceState);

            await time.setNextBlockTimestamp(nextHourBegin + 3600);
            const simulateRes = simulateSampleAndAdjustFundingRate(
                globalPosition,
                globalLiquidityPosition,
                globalFundingRateSample,
                priceState,
                marketBaseCfg.maxFundingRate,
                toBigInt(nextHourBegin + 3600),
                isLongSide(flipSide(globalLiquidityPosition.side))
                    ? await mockPriceFeed.getMaxPriceX96(ETHMarketDescriptor.target)
                    : await mockPriceFeed.getMinPriceX96(ETHMarketDescriptor.target),
                await mockPriceFeed.getMaxPriceX96(ETHMarketDescriptor.target),
                marketBaseCfg.interestRate,
            );
            expect(simulateRes.timeDelta).to.gte(SAMPLE_PREMIUM_RATE_INTERVAL);
            expect(simulateRes.shouldAdjustFundingRate).to.true;
            expect(simulateRes.fundingRateDeltaX96).to.gte(0n);
            expect(simulateRes.sampleCountAfter).to.eq(0n);
            expect(simulateRes.lastAdjustFundingRateTimeAfter).to.eq(nextHourBegin + 3600);

            const assertion = expect(fundingRateUtil.sampleAndAdjustFundingRate(ETHMarketDescriptor.target));
            await assertion.to
                .emit(_fundingRateUtil.attach(fundingRateUtil.target), "GlobalFundingRateSampleAdjusted")
                .withArgs(
                    ETHMarketDescriptor.target,
                    simulateRes.sampleCountAfter,
                    simulateRes.cumulativePremiumRateAfterX96,
                );
            await assertion.to
                .emit(_fundingRateUtil.attach(fundingRateUtil.target), "FundingRateGrowthAdjusted")
                .withArgs(
                    ETHMarketDescriptor.target,
                    simulateRes.clampedFundingRateDeltaX96,
                    simulateRes.longFundingRateGrowthAfterX96,
                    simulateRes.shortFundingRateGrowthAfterX96,
                    simulateRes.lastAdjustFundingRateTimeAfter,
                );

            {
                const stateAfter = await fundingRateUtil.state();
                expect(stateAfter.globalPosition.longSize).to.eq(globalPosition.longSize);
                expect(stateAfter.globalPosition.shortSize).to.eq(globalPosition.shortSize);
                expect(stateAfter.globalPosition.maxSize).to.eq(globalPosition.maxSize);
                expect(stateAfter.globalPosition.maxSizePerPosition).to.eq(globalPosition.maxSizePerPosition);
                expect(stateAfter.globalPosition.longFundingRateGrowthX96).to.eq(
                    simulateRes.longFundingRateGrowthAfterX96,
                );
                expect(stateAfter.globalPosition.shortFundingRateGrowthX96).to.eq(
                    simulateRes.shortFundingRateGrowthAfterX96,
                );

                expect(stateAfter.globalLiquidityPosition.netSize).to.eq(globalLiquidityPosition.netSize);
                expect(stateAfter.globalLiquidityPosition.liquidationBufferNetSize).to.eq(
                    globalLiquidityPosition.liquidationBufferNetSize,
                );
                expect(stateAfter.globalLiquidityPosition.previousSPPriceX96).to.eq(
                    globalLiquidityPosition.previousSPPriceX96,
                );
                expect(stateAfter.globalLiquidityPosition.side).to.eq(globalLiquidityPosition.side);
                expect(stateAfter.globalLiquidityPosition.liquidity).to.eq(globalLiquidityPosition.liquidity);
                expect(stateAfter.globalLiquidityPosition.unrealizedPnLGrowthX64).to.eq(
                    simulateRes.unrealizedPnLGrowthAfterX64,
                );

                expect(stateAfter.globalFundingRateSample.lastAdjustFundingRateTime).to.eq(
                    simulateRes.lastAdjustFundingRateTimeAfter,
                );
                expect(stateAfter.globalFundingRateSample.sampleCount).to.eq(simulateRes.sampleCountAfter);
                expect(stateAfter.globalFundingRateSample.cumulativePremiumRateX96).to.eq(
                    simulateRes.cumulativePremiumRateAfterX96,
                );

                expect(stateAfter.previousGlobalFundingRate.longFundingRateGrowthX96).to.eq(
                    globalPosition.longFundingRateGrowthX96,
                );
                expect(stateAfter.previousGlobalFundingRate.shortFundingRateGrowthX96).to.eq(
                    globalPosition.shortFundingRateGrowthX96,
                );
            }
        });

        it("should adjust global funding rate if sample count is greater then 720", async () => {
            const {fundingRateUtil, _fundingRateUtil, ETHMarketDescriptor, marketBaseCfg, mockPriceFeed} =
                await loadFixture(deployFixture);

            const lastTimestamp = await time.latest();
            const nextHourBegin = lastTimestamp - (lastTimestamp % 3600) + 3600;
            await time.setNextBlockTimestamp(nextHourBegin);

            let globalPosition = newGlobalPosition();
            let globalLiquidityPosition = newGlobalLiquidityPosition();
            let priceState = newPriceState();

            let globalFundingRateSample = {
                lastAdjustFundingRateTime: toBigInt(nextHourBegin),
                sampleCount: 8n,
                cumulativePremiumRateX96: 9n,
            };

            await fundingRateUtil.setGlobalPosition(globalPosition);
            await fundingRateUtil.setGlobalFundingRateSample(globalFundingRateSample);
            await fundingRateUtil.setGlobalLiquidityPosition(globalLiquidityPosition);
            await fundingRateUtil.setPriceState(priceState);

            await time.setNextBlockTimestamp(nextHourBegin + 3605);
            const simulateRes = simulateSampleAndAdjustFundingRate(
                globalPosition,
                globalLiquidityPosition,
                globalFundingRateSample,
                priceState,
                marketBaseCfg.maxFundingRate,
                toBigInt(nextHourBegin + 3605),
                isLongSide(flipSide(globalLiquidityPosition.side))
                    ? await mockPriceFeed.getMaxPriceX96(ETHMarketDescriptor.target)
                    : await mockPriceFeed.getMinPriceX96(ETHMarketDescriptor.target),
                await mockPriceFeed.getMaxPriceX96(ETHMarketDescriptor.target),
                marketBaseCfg.interestRate,
            );
            expect(simulateRes.timeDelta).to.gte(SAMPLE_PREMIUM_RATE_INTERVAL);
            expect(simulateRes.shouldAdjustFundingRate).to.true;
            expect(simulateRes.fundingRateDeltaX96).to.gte(0n);
            expect(simulateRes.sampleCountAfter).to.eq(0n);
            expect(simulateRes.lastAdjustFundingRateTimeAfter).to.eq(nextHourBegin + 3600);

            const assertion = expect(fundingRateUtil.sampleAndAdjustFundingRate(ETHMarketDescriptor.target));
            await assertion.to
                .emit(_fundingRateUtil.attach(fundingRateUtil.target), "GlobalFundingRateSampleAdjusted")
                .withArgs(
                    ETHMarketDescriptor.target,
                    simulateRes.sampleCountAfter,
                    simulateRes.cumulativePremiumRateAfterX96,
                );
            await assertion.to
                .emit(_fundingRateUtil.attach(fundingRateUtil.target), "FundingRateGrowthAdjusted")
                .withArgs(
                    ETHMarketDescriptor.target,
                    simulateRes.clampedFundingRateDeltaX96,
                    simulateRes.longFundingRateGrowthAfterX96,
                    simulateRes.shortFundingRateGrowthAfterX96,
                    simulateRes.lastAdjustFundingRateTimeAfter,
                );

            {
                const stateAfter = await fundingRateUtil.state();
                expect(stateAfter.globalPosition.longSize).to.eq(globalPosition.longSize);
                expect(stateAfter.globalPosition.shortSize).to.eq(globalPosition.shortSize);
                expect(stateAfter.globalPosition.maxSize).to.eq(globalPosition.maxSize);
                expect(stateAfter.globalPosition.maxSizePerPosition).to.eq(globalPosition.maxSizePerPosition);
                expect(stateAfter.globalPosition.longFundingRateGrowthX96).to.eq(
                    simulateRes.longFundingRateGrowthAfterX96,
                );
                expect(stateAfter.globalPosition.shortFundingRateGrowthX96).to.eq(
                    simulateRes.shortFundingRateGrowthAfterX96,
                );

                expect(stateAfter.globalLiquidityPosition.netSize).to.eq(globalLiquidityPosition.netSize);
                expect(stateAfter.globalLiquidityPosition.liquidationBufferNetSize).to.eq(
                    globalLiquidityPosition.liquidationBufferNetSize,
                );
                expect(stateAfter.globalLiquidityPosition.previousSPPriceX96).to.eq(
                    globalLiquidityPosition.previousSPPriceX96,
                );
                expect(stateAfter.globalLiquidityPosition.side).to.eq(globalLiquidityPosition.side);
                expect(stateAfter.globalLiquidityPosition.liquidity).to.eq(globalLiquidityPosition.liquidity);
                expect(stateAfter.globalLiquidityPosition.unrealizedPnLGrowthX64).to.eq(
                    simulateRes.unrealizedPnLGrowthAfterX64,
                );

                expect(stateAfter.globalFundingRateSample.lastAdjustFundingRateTime).to.eq(
                    simulateRes.lastAdjustFundingRateTimeAfter,
                );
                expect(stateAfter.globalFundingRateSample.sampleCount).to.eq(simulateRes.sampleCountAfter);
                expect(stateAfter.globalFundingRateSample.cumulativePremiumRateX96).to.eq(
                    simulateRes.cumulativePremiumRateAfterX96,
                );

                expect(stateAfter.previousGlobalFundingRate.longFundingRateGrowthX96).to.eq(
                    globalPosition.longFundingRateGrowthX96,
                );
                expect(stateAfter.previousGlobalFundingRate.shortFundingRateGrowthX96).to.eq(
                    globalPosition.shortFundingRateGrowthX96,
                );
            }
        });

        it("should adjust global funding rate if sample count is greater then 1440", async () => {
            const {fundingRateUtil, _fundingRateUtil, ETHMarketDescriptor, marketBaseCfg, mockPriceFeed} =
                await loadFixture(deployFixture);

            const lastTimestamp = await time.latest();
            const nextHourBegin = lastTimestamp - (lastTimestamp % 3600) + 3600;
            await time.setNextBlockTimestamp(nextHourBegin);

            let globalPosition = newGlobalPosition();
            let globalLiquidityPosition = newGlobalLiquidityPosition();
            let priceState = newPriceState();

            let globalFundingRateSample = {
                lastAdjustFundingRateTime: toBigInt(nextHourBegin),
                sampleCount: 8n,
                cumulativePremiumRateX96: 9n,
            };

            await fundingRateUtil.setGlobalPosition(globalPosition);
            await fundingRateUtil.setGlobalFundingRateSample(globalFundingRateSample);
            await fundingRateUtil.setGlobalLiquidityPosition(globalLiquidityPosition);
            await fundingRateUtil.setPriceState(priceState);

            await time.setNextBlockTimestamp(nextHourBegin + 7205);
            const simulateRes = simulateSampleAndAdjustFundingRate(
                globalPosition,
                globalLiquidityPosition,
                globalFundingRateSample,
                priceState,
                marketBaseCfg.maxFundingRate,
                toBigInt(nextHourBegin + 7205),
                isLongSide(flipSide(globalLiquidityPosition.side))
                    ? await mockPriceFeed.getMaxPriceX96(ETHMarketDescriptor.target)
                    : await mockPriceFeed.getMinPriceX96(ETHMarketDescriptor.target),
                await mockPriceFeed.getMaxPriceX96(ETHMarketDescriptor.target),
                marketBaseCfg.interestRate,
            );
            expect(simulateRes.timeDelta).to.gte(SAMPLE_PREMIUM_RATE_INTERVAL);
            expect(simulateRes.shouldAdjustFundingRate).to.true;
            expect(simulateRes.fundingRateDeltaX96).to.gte(0n);
            expect(simulateRes.sampleCountAfter).to.eq(0n);
            expect(simulateRes.lastAdjustFundingRateTimeAfter).to.eq(nextHourBegin + 3600);

            const assertion = expect(fundingRateUtil.sampleAndAdjustFundingRate(ETHMarketDescriptor.target));
            await assertion.to
                .emit(_fundingRateUtil.attach(fundingRateUtil.target), "GlobalFundingRateSampleAdjusted")
                .withArgs(
                    ETHMarketDescriptor.target,
                    simulateRes.sampleCountAfter,
                    simulateRes.cumulativePremiumRateAfterX96,
                );
            await assertion.to
                .emit(_fundingRateUtil.attach(fundingRateUtil.target), "FundingRateGrowthAdjusted")
                .withArgs(
                    ETHMarketDescriptor.target,
                    simulateRes.clampedFundingRateDeltaX96,
                    simulateRes.longFundingRateGrowthAfterX96,
                    simulateRes.shortFundingRateGrowthAfterX96,
                    simulateRes.lastAdjustFundingRateTimeAfter,
                );

            {
                const stateAfter = await fundingRateUtil.state();
                expect(stateAfter.globalPosition.longSize).to.eq(globalPosition.longSize);
                expect(stateAfter.globalPosition.shortSize).to.eq(globalPosition.shortSize);
                expect(stateAfter.globalPosition.maxSize).to.eq(globalPosition.maxSize);
                expect(stateAfter.globalPosition.maxSizePerPosition).to.eq(globalPosition.maxSizePerPosition);
                expect(stateAfter.globalPosition.longFundingRateGrowthX96).to.eq(
                    simulateRes.longFundingRateGrowthAfterX96,
                );
                expect(stateAfter.globalPosition.shortFundingRateGrowthX96).to.eq(
                    simulateRes.shortFundingRateGrowthAfterX96,
                );

                expect(stateAfter.globalLiquidityPosition.netSize).to.eq(globalLiquidityPosition.netSize);
                expect(stateAfter.globalLiquidityPosition.liquidationBufferNetSize).to.eq(
                    globalLiquidityPosition.liquidationBufferNetSize,
                );
                expect(stateAfter.globalLiquidityPosition.previousSPPriceX96).to.eq(
                    globalLiquidityPosition.previousSPPriceX96,
                );
                expect(stateAfter.globalLiquidityPosition.side).to.eq(globalLiquidityPosition.side);
                expect(stateAfter.globalLiquidityPosition.liquidity).to.eq(globalLiquidityPosition.liquidity);
                expect(stateAfter.globalLiquidityPosition.unrealizedPnLGrowthX64).to.eq(
                    simulateRes.unrealizedPnLGrowthAfterX64,
                );

                expect(stateAfter.globalFundingRateSample.lastAdjustFundingRateTime).to.eq(
                    simulateRes.lastAdjustFundingRateTimeAfter,
                );
                expect(stateAfter.globalFundingRateSample.sampleCount).to.eq(simulateRes.sampleCountAfter);
                expect(stateAfter.globalFundingRateSample.cumulativePremiumRateX96).to.eq(
                    simulateRes.cumulativePremiumRateAfterX96,
                );

                expect(stateAfter.previousGlobalFundingRate.longFundingRateGrowthX96).to.eq(
                    globalPosition.longFundingRateGrowthX96,
                );
                expect(stateAfter.previousGlobalFundingRate.shortFundingRateGrowthX96).to.eq(
                    globalPosition.shortFundingRateGrowthX96,
                );
            }
        });

        it("should make funding rate to be clamped to the maximum funding rate", async () => {
            const {fundingRateUtil, _fundingRateUtil, ETHMarketDescriptor, mockPriceFeed} =
                await loadFixture(deployFixture);

            const lastTimestamp = await time.latest();
            let nextHourBegin = lastTimestamp - (lastTimestamp % 3600) + 3600;
            await time.setNextBlockTimestamp(nextHourBegin);

            let globalPosition = newGlobalPosition();
            let globalLiquidityPosition = newGlobalLiquidityPosition();
            let priceState = newPriceState();

            let globalFundingRateSample = {
                lastAdjustFundingRateTime: toBigInt(nextHourBegin),
                sampleCount: 8n,
                cumulativePremiumRateX96: toX96("1000"),
            };

            {
                // global liquidity position side is long
                await fundingRateUtil.setGlobalPosition(globalPosition);
                await fundingRateUtil.setGlobalFundingRateSample(globalFundingRateSample);
                await fundingRateUtil.setGlobalLiquidityPosition(globalLiquidityPosition);
                await fundingRateUtil.setPriceState(priceState);

                let marketBaseConfigNew = newMarketBaseConfig();
                {
                    // change market base config
                    marketBaseConfigNew.maxFundingRate = marketBaseConfigNew.maxFundingRate / 25n;
                    marketBaseConfigNew.interestRate = marketBaseConfigNew.interestRate * 10n;
                    await fundingRateUtil.setMarketBaseConfig(marketBaseConfigNew);
                }

                await time.setNextBlockTimestamp(nextHourBegin + 3600);
                const simulateRes = simulateSampleAndAdjustFundingRate(
                    globalPosition,
                    globalLiquidityPosition,
                    globalFundingRateSample,
                    priceState,
                    marketBaseConfigNew.maxFundingRate,
                    toBigInt(nextHourBegin + 3600),
                    isLongSide(flipSide(globalLiquidityPosition.side))
                        ? await mockPriceFeed.getMaxPriceX96(ETHMarketDescriptor.target)
                        : await mockPriceFeed.getMinPriceX96(ETHMarketDescriptor.target),
                    await mockPriceFeed.getMaxPriceX96(ETHMarketDescriptor.target),
                    marketBaseConfigNew.interestRate,
                );
                expect(simulateRes.timeDelta).to.gte(SAMPLE_PREMIUM_RATE_INTERVAL);
                expect(simulateRes.shouldAdjustFundingRate).to.true;
                expect(simulateRes.fundingRateDeltaX96).to.gt(
                    mulDiv(marketBaseConfigNew.maxFundingRate, Q96, BASIS_POINTS_DIVISOR, Rounding.Up),
                );
                expect(simulateRes.clampedFundingRateDeltaX96).to.eq(
                    mulDiv(marketBaseConfigNew.maxFundingRate, Q96, BASIS_POINTS_DIVISOR, Rounding.Up),
                );
                expect(simulateRes.sampleCountAfter).to.eq(0n);
                expect(simulateRes.lastAdjustFundingRateTimeAfter).to.eq(nextHourBegin + 3600);

                const assertion = expect(fundingRateUtil.sampleAndAdjustFundingRate(ETHMarketDescriptor.target));
                await assertion.to
                    .emit(_fundingRateUtil.attach(fundingRateUtil.target), "GlobalFundingRateSampleAdjusted")
                    .withArgs(
                        ETHMarketDescriptor.target,
                        simulateRes.sampleCountAfter,
                        simulateRes.cumulativePremiumRateAfterX96,
                    );
                await assertion.to
                    .emit(_fundingRateUtil.attach(fundingRateUtil.target), "FundingRateGrowthAdjusted")
                    .withArgs(
                        ETHMarketDescriptor.target,
                        simulateRes.clampedFundingRateDeltaX96,
                        simulateRes.longFundingRateGrowthAfterX96,
                        simulateRes.shortFundingRateGrowthAfterX96,
                        simulateRes.lastAdjustFundingRateTimeAfter,
                    );

                {
                    const stateAfter = await fundingRateUtil.state();
                    expect(stateAfter.globalPosition.longSize).to.eq(globalPosition.longSize);
                    expect(stateAfter.globalPosition.shortSize).to.eq(globalPosition.shortSize);
                    expect(stateAfter.globalPosition.maxSize).to.eq(globalPosition.maxSize);
                    expect(stateAfter.globalPosition.maxSizePerPosition).to.eq(globalPosition.maxSizePerPosition);
                    expect(stateAfter.globalPosition.longFundingRateGrowthX96).to.eq(
                        simulateRes.longFundingRateGrowthAfterX96,
                    );
                    expect(stateAfter.globalPosition.shortFundingRateGrowthX96).to.eq(
                        simulateRes.shortFundingRateGrowthAfterX96,
                    );

                    expect(stateAfter.globalLiquidityPosition.netSize).to.eq(globalLiquidityPosition.netSize);
                    expect(stateAfter.globalLiquidityPosition.liquidationBufferNetSize).to.eq(
                        globalLiquidityPosition.liquidationBufferNetSize,
                    );
                    expect(stateAfter.globalLiquidityPosition.previousSPPriceX96).to.eq(
                        globalLiquidityPosition.previousSPPriceX96,
                    );
                    expect(stateAfter.globalLiquidityPosition.side).to.eq(globalLiquidityPosition.side);
                    expect(stateAfter.globalLiquidityPosition.liquidity).to.eq(globalLiquidityPosition.liquidity);
                    expect(stateAfter.globalLiquidityPosition.unrealizedPnLGrowthX64).to.eq(
                        simulateRes.unrealizedPnLGrowthAfterX64,
                    );

                    expect(stateAfter.globalFundingRateSample.lastAdjustFundingRateTime).to.eq(
                        simulateRes.lastAdjustFundingRateTimeAfter,
                    );
                    expect(stateAfter.globalFundingRateSample.sampleCount).to.eq(simulateRes.sampleCountAfter);
                    expect(stateAfter.globalFundingRateSample.cumulativePremiumRateX96).to.eq(
                        simulateRes.cumulativePremiumRateAfterX96,
                    );

                    expect(stateAfter.previousGlobalFundingRate.longFundingRateGrowthX96).to.eq(
                        globalPosition.longFundingRateGrowthX96,
                    );
                    expect(stateAfter.previousGlobalFundingRate.shortFundingRateGrowthX96).to.eq(
                        globalPosition.shortFundingRateGrowthX96,
                    );
                }
            }

            nextHourBegin = nextHourBegin + 3600;
            {
                // global liquidity position side is short
                globalLiquidityPosition.side = SIDE_SHORT;
                globalFundingRateSample.lastAdjustFundingRateTime = toBigInt(nextHourBegin);
                // set cumulativePremiumRateX96 to a very small value, so that the fundingRateDeltaX96 is less than -maxFundingRate
                globalFundingRateSample.cumulativePremiumRateX96 = -toX96("1000");
                await fundingRateUtil.setGlobalPosition(globalPosition);
                await fundingRateUtil.setGlobalFundingRateSample(globalFundingRateSample);
                await fundingRateUtil.setGlobalLiquidityPosition(globalLiquidityPosition);
                await fundingRateUtil.setPriceState(priceState);

                let marketBaseConfigNew = newMarketBaseConfig();
                {
                    // change market base config
                    marketBaseConfigNew.maxFundingRate = marketBaseConfigNew.maxFundingRate / 25n;
                    marketBaseConfigNew.interestRate = marketBaseConfigNew.interestRate * 10n;
                    await fundingRateUtil.setMarketBaseConfig(marketBaseConfigNew);
                }

                await time.setNextBlockTimestamp(nextHourBegin + 3600);
                const simulateRes = simulateSampleAndAdjustFundingRate(
                    globalPosition,
                    globalLiquidityPosition,
                    globalFundingRateSample,
                    priceState,
                    marketBaseConfigNew.maxFundingRate,
                    toBigInt(nextHourBegin + 3600),
                    isLongSide(flipSide(globalLiquidityPosition.side))
                        ? await mockPriceFeed.getMaxPriceX96(ETHMarketDescriptor.target)
                        : await mockPriceFeed.getMinPriceX96(ETHMarketDescriptor.target),
                    await mockPriceFeed.getMaxPriceX96(ETHMarketDescriptor.target),
                    marketBaseConfigNew.interestRate,
                );
                expect(simulateRes.timeDelta).to.gte(SAMPLE_PREMIUM_RATE_INTERVAL);
                expect(simulateRes.shouldAdjustFundingRate).to.true;
                expect(simulateRes.fundingRateDeltaX96).to.lt(
                    -mulDiv(marketBaseConfigNew.maxFundingRate, Q96, BASIS_POINTS_DIVISOR, Rounding.Up),
                );
                expect(simulateRes.clampedFundingRateDeltaX96).to.eq(
                    -mulDiv(marketBaseConfigNew.maxFundingRate, Q96, BASIS_POINTS_DIVISOR, Rounding.Up),
                );
                expect(simulateRes.sampleCountAfter).to.eq(0n);
                expect(simulateRes.lastAdjustFundingRateTimeAfter).to.eq(nextHourBegin + 3600);

                const assertion = expect(fundingRateUtil.sampleAndAdjustFundingRate(ETHMarketDescriptor.target));
                await assertion.to
                    .emit(_fundingRateUtil.attach(fundingRateUtil.target), "GlobalFundingRateSampleAdjusted")
                    .withArgs(
                        ETHMarketDescriptor.target,
                        simulateRes.sampleCountAfter,
                        simulateRes.cumulativePremiumRateAfterX96,
                    );
                await assertion.to
                    .emit(_fundingRateUtil.attach(fundingRateUtil.target), "FundingRateGrowthAdjusted")
                    .withArgs(
                        ETHMarketDescriptor.target,
                        simulateRes.clampedFundingRateDeltaX96,
                        simulateRes.longFundingRateGrowthAfterX96,
                        simulateRes.shortFundingRateGrowthAfterX96,
                        simulateRes.lastAdjustFundingRateTimeAfter,
                    );

                {
                    const stateAfter = await fundingRateUtil.state();
                    expect(stateAfter.globalPosition.longSize).to.eq(globalPosition.longSize);
                    expect(stateAfter.globalPosition.shortSize).to.eq(globalPosition.shortSize);
                    expect(stateAfter.globalPosition.maxSize).to.eq(globalPosition.maxSize);
                    expect(stateAfter.globalPosition.maxSizePerPosition).to.eq(globalPosition.maxSizePerPosition);
                    expect(stateAfter.globalPosition.longFundingRateGrowthX96).to.eq(
                        simulateRes.longFundingRateGrowthAfterX96,
                    );
                    expect(stateAfter.globalPosition.shortFundingRateGrowthX96).to.eq(
                        simulateRes.shortFundingRateGrowthAfterX96,
                    );

                    expect(stateAfter.globalLiquidityPosition.netSize).to.eq(globalLiquidityPosition.netSize);
                    expect(stateAfter.globalLiquidityPosition.liquidationBufferNetSize).to.eq(
                        globalLiquidityPosition.liquidationBufferNetSize,
                    );
                    expect(stateAfter.globalLiquidityPosition.previousSPPriceX96).to.eq(
                        globalLiquidityPosition.previousSPPriceX96,
                    );
                    expect(stateAfter.globalLiquidityPosition.side).to.eq(globalLiquidityPosition.side);
                    expect(stateAfter.globalLiquidityPosition.liquidity).to.eq(globalLiquidityPosition.liquidity);
                    expect(stateAfter.globalLiquidityPosition.unrealizedPnLGrowthX64).to.eq(
                        simulateRes.unrealizedPnLGrowthAfterX64,
                    );

                    expect(stateAfter.globalFundingRateSample.lastAdjustFundingRateTime).to.eq(
                        simulateRes.lastAdjustFundingRateTimeAfter,
                    );
                    expect(stateAfter.globalFundingRateSample.sampleCount).to.eq(simulateRes.sampleCountAfter);
                    expect(stateAfter.globalFundingRateSample.cumulativePremiumRateX96).to.eq(
                        simulateRes.cumulativePremiumRateAfterX96,
                    );

                    expect(stateAfter.previousGlobalFundingRate.longFundingRateGrowthX96).to.eq(
                        globalPosition.longFundingRateGrowthX96,
                    );
                    expect(stateAfter.previousGlobalFundingRate.shortFundingRateGrowthX96).to.eq(
                        globalPosition.shortFundingRateGrowthX96,
                    );
                }
            }
        });

        it("should adjust global unrealized PnL growth when paid size is greater than received size", async () => {
            const {fundingRateUtil, _fundingRateUtil, ETHMarketDescriptor, mockPriceFeed} =
                await loadFixture(deployFixture);
            const lastTimestamp = await time.latest();
            let nextHourBegin = lastTimestamp - (lastTimestamp % 3600) + 3600;
            await time.setNextBlockTimestamp(nextHourBegin);

            let globalPosition = {
                longSize: 2n,
                shortSize: 1n,
                maxSize: 3n,
                maxSizePerPosition: 4n,
                longFundingRateGrowthX96: 5n,
                shortFundingRateGrowthX96: 6n,
            };

            let globalFundingRateSample = {
                lastAdjustFundingRateTime: toBigInt(nextHourBegin),
                sampleCount: 8n,
                cumulativePremiumRateX96: toX96("1000"),
            };

            let globalLiquidityPosition = newGlobalLiquidityPosition();
            let priceState = newPriceState();

            // global liquidity position side is long
            await fundingRateUtil.setGlobalPosition(globalPosition);
            await fundingRateUtil.setGlobalFundingRateSample(globalFundingRateSample);
            await fundingRateUtil.setGlobalLiquidityPosition(globalLiquidityPosition);
            await fundingRateUtil.setPriceState(priceState);

            let marketBaseConfigNew = newMarketBaseConfig();
            {
                // change market base config
                marketBaseConfigNew.maxFundingRate = marketBaseConfigNew.maxFundingRate / 25n;
                marketBaseConfigNew.interestRate = marketBaseConfigNew.interestRate * 10n;
                await fundingRateUtil.setMarketBaseConfig(marketBaseConfigNew);
            }

            await time.setNextBlockTimestamp(nextHourBegin + 3600);
            const simulateRes = simulateSampleAndAdjustFundingRate(
                globalPosition,
                globalLiquidityPosition,
                globalFundingRateSample,
                priceState,
                marketBaseConfigNew.maxFundingRate,
                toBigInt(nextHourBegin + 3600),
                isLongSide(flipSide(globalLiquidityPosition.side))
                    ? await mockPriceFeed.getMaxPriceX96(ETHMarketDescriptor.target)
                    : await mockPriceFeed.getMinPriceX96(ETHMarketDescriptor.target),
                await mockPriceFeed.getMaxPriceX96(ETHMarketDescriptor.target),
                marketBaseConfigNew.interestRate,
            );
            expect(simulateRes.timeDelta).to.gte(SAMPLE_PREMIUM_RATE_INTERVAL);
            expect(simulateRes.shouldAdjustFundingRate).to.true;
            expect(simulateRes.fundingRateDeltaX96).to.gt(
                mulDiv(marketBaseConfigNew.maxFundingRate, Q96, BASIS_POINTS_DIVISOR, Rounding.Up),
            );
            expect(simulateRes.clampedFundingRateDeltaX96).to.eq(
                mulDiv(marketBaseConfigNew.maxFundingRate, Q96, BASIS_POINTS_DIVISOR, Rounding.Up),
            );
            expect(simulateRes.sampleCountAfter).to.eq(0n);
            expect(simulateRes.lastAdjustFundingRateTimeAfter).to.eq(nextHourBegin + 3600);

            const assertion = expect(fundingRateUtil.sampleAndAdjustFundingRate(ETHMarketDescriptor.target));
            await assertion.to
                .emit(_fundingRateUtil.attach(fundingRateUtil.target), "GlobalFundingRateSampleAdjusted")
                .withArgs(
                    ETHMarketDescriptor.target,
                    simulateRes.sampleCountAfter,
                    simulateRes.cumulativePremiumRateAfterX96,
                );
            await assertion.to
                .emit(_fundingRateUtil.attach(fundingRateUtil.target), "FundingRateGrowthAdjusted")
                .withArgs(
                    ETHMarketDescriptor.target,
                    simulateRes.clampedFundingRateDeltaX96,
                    simulateRes.longFundingRateGrowthAfterX96,
                    simulateRes.shortFundingRateGrowthAfterX96,
                    simulateRes.lastAdjustFundingRateTimeAfter,
                );
            await assertion.to
                .emit(
                    _fundingRateUtil.attach(fundingRateUtil.target),
                    "GlobalLiquidityPositionPnLGrowthIncreasedByFundingFee",
                )
                .withArgs(ETHMarketDescriptor.target, simulateRes.unrealizedPnLGrowthAfterX64);

            {
                const stateAfter = await fundingRateUtil.state();
                expect(stateAfter.globalPosition.longSize).to.eq(globalPosition.longSize);
                expect(stateAfter.globalPosition.shortSize).to.eq(globalPosition.shortSize);
                expect(stateAfter.globalPosition.maxSize).to.eq(globalPosition.maxSize);
                expect(stateAfter.globalPosition.maxSizePerPosition).to.eq(globalPosition.maxSizePerPosition);
                expect(stateAfter.globalPosition.longFundingRateGrowthX96).to.eq(
                    simulateRes.longFundingRateGrowthAfterX96,
                );
                expect(stateAfter.globalPosition.shortFundingRateGrowthX96).to.eq(
                    simulateRes.shortFundingRateGrowthAfterX96,
                );
                expect(stateAfter.globalPosition.longFundingRateGrowthX96).to.not.eq(
                    globalPosition.longFundingRateGrowthX96,
                );
                expect(stateAfter.globalPosition.shortFundingRateGrowthX96).to.not.eq(
                    globalPosition.shortFundingRateGrowthX96,
                );

                expect(stateAfter.globalLiquidityPosition.netSize).to.eq(globalLiquidityPosition.netSize);
                expect(stateAfter.globalLiquidityPosition.liquidationBufferNetSize).to.eq(
                    globalLiquidityPosition.liquidationBufferNetSize,
                );
                expect(stateAfter.globalLiquidityPosition.previousSPPriceX96).to.eq(
                    globalLiquidityPosition.previousSPPriceX96,
                );
                expect(stateAfter.globalLiquidityPosition.side).to.eq(globalLiquidityPosition.side);
                expect(stateAfter.globalLiquidityPosition.liquidity).to.eq(globalLiquidityPosition.liquidity);
                expect(stateAfter.globalLiquidityPosition.unrealizedPnLGrowthX64).to.not.eq(
                    globalLiquidityPosition.unrealizedPnLGrowthX64,
                );
                expect(stateAfter.globalLiquidityPosition.unrealizedPnLGrowthX64).to.eq(
                    simulateRes.unrealizedPnLGrowthAfterX64,
                );

                expect(stateAfter.globalFundingRateSample.lastAdjustFundingRateTime).to.eq(
                    simulateRes.lastAdjustFundingRateTimeAfter,
                );
                expect(stateAfter.globalFundingRateSample.sampleCount).to.eq(simulateRes.sampleCountAfter);
                expect(stateAfter.globalFundingRateSample.cumulativePremiumRateX96).to.eq(
                    simulateRes.cumulativePremiumRateAfterX96,
                );

                expect(stateAfter.previousGlobalFundingRate.longFundingRateGrowthX96).to.eq(
                    globalPosition.longFundingRateGrowthX96,
                );
                expect(stateAfter.previousGlobalFundingRate.shortFundingRateGrowthX96).to.eq(
                    globalPosition.shortFundingRateGrowthX96,
                );
            }
        });

        it("should not adjust global unrealized PnL growth when paid size is not greater than received size", async () => {
            const {fundingRateUtil, _fundingRateUtil, ETHMarketDescriptor, mockPriceFeed} =
                await loadFixture(deployFixture);

            const lastTimestamp = await time.latest();
            let nextHourBegin = lastTimestamp - (lastTimestamp % 3600) + 3600;
            await time.setNextBlockTimestamp(nextHourBegin);

            let globalPosition = newGlobalPosition();
            let globalLiquidityPosition = newGlobalLiquidityPosition();
            let priceState = newPriceState();

            let globalFundingRateSample = {
                lastAdjustFundingRateTime: toBigInt(nextHourBegin),
                sampleCount: 8n,
                cumulativePremiumRateX96: toX96("1000"),
            };

            // global liquidity position side is long
            await fundingRateUtil.setGlobalPosition(globalPosition);
            await fundingRateUtil.setGlobalFundingRateSample(globalFundingRateSample);
            await fundingRateUtil.setGlobalLiquidityPosition(globalLiquidityPosition);
            await fundingRateUtil.setPriceState(priceState);

            let marketBaseConfigNew = newMarketBaseConfig();
            {
                // change market base config
                marketBaseConfigNew.maxFundingRate = marketBaseConfigNew.maxFundingRate / 25n;
                marketBaseConfigNew.interestRate = marketBaseConfigNew.interestRate * 10n;
                await fundingRateUtil.setMarketBaseConfig(marketBaseConfigNew);
            }

            await time.setNextBlockTimestamp(nextHourBegin + 3600);
            const simulateRes = simulateSampleAndAdjustFundingRate(
                globalPosition,
                globalLiquidityPosition,
                globalFundingRateSample,
                priceState,
                marketBaseConfigNew.maxFundingRate,
                toBigInt(nextHourBegin + 3600),
                isLongSide(flipSide(globalLiquidityPosition.side))
                    ? await mockPriceFeed.getMaxPriceX96(ETHMarketDescriptor.target)
                    : await mockPriceFeed.getMinPriceX96(ETHMarketDescriptor.target),
                await mockPriceFeed.getMaxPriceX96(ETHMarketDescriptor.target),
                marketBaseConfigNew.interestRate,
            );
            expect(simulateRes.timeDelta).to.gte(SAMPLE_PREMIUM_RATE_INTERVAL);
            expect(simulateRes.shouldAdjustFundingRate).to.true;
            expect(simulateRes.fundingRateDeltaX96).to.gt(
                mulDiv(marketBaseConfigNew.maxFundingRate, Q96, BASIS_POINTS_DIVISOR, Rounding.Up),
            );
            expect(simulateRes.clampedFundingRateDeltaX96).to.eq(
                mulDiv(marketBaseConfigNew.maxFundingRate, Q96, BASIS_POINTS_DIVISOR, Rounding.Up),
            );
            expect(simulateRes.sampleCountAfter).to.eq(0n);
            expect(simulateRes.lastAdjustFundingRateTimeAfter).to.eq(nextHourBegin + 3600);

            const assertion = expect(fundingRateUtil.sampleAndAdjustFundingRate(ETHMarketDescriptor.target));
            await assertion.to
                .emit(_fundingRateUtil.attach(fundingRateUtil.target), "GlobalFundingRateSampleAdjusted")
                .withArgs(
                    ETHMarketDescriptor.target,
                    simulateRes.sampleCountAfter,
                    simulateRes.cumulativePremiumRateAfterX96,
                );
            await assertion.to
                .emit(_fundingRateUtil.attach(fundingRateUtil.target), "FundingRateGrowthAdjusted")
                .withArgs(
                    ETHMarketDescriptor.target,
                    simulateRes.clampedFundingRateDeltaX96,
                    simulateRes.longFundingRateGrowthAfterX96,
                    simulateRes.shortFundingRateGrowthAfterX96,
                    simulateRes.lastAdjustFundingRateTimeAfter,
                );
            await assertion.to.not.emit(
                _fundingRateUtil.attach(fundingRateUtil.target),
                "GlobalLiquidityPositionPnLGrowthIncreasedByFundingFee",
            );

            {
                const stateAfter = await fundingRateUtil.state();
                expect(stateAfter.globalPosition.longSize).to.eq(globalPosition.longSize);
                expect(stateAfter.globalPosition.shortSize).to.eq(globalPosition.shortSize);
                expect(stateAfter.globalPosition.maxSize).to.eq(globalPosition.maxSize);
                expect(stateAfter.globalPosition.maxSizePerPosition).to.eq(globalPosition.maxSizePerPosition);
                expect(stateAfter.globalPosition.longFundingRateGrowthX96).to.eq(
                    simulateRes.longFundingRateGrowthAfterX96,
                );
                expect(stateAfter.globalPosition.shortFundingRateGrowthX96).to.eq(
                    simulateRes.shortFundingRateGrowthAfterX96,
                );

                expect(stateAfter.globalLiquidityPosition.netSize).to.eq(globalLiquidityPosition.netSize);
                expect(stateAfter.globalLiquidityPosition.liquidationBufferNetSize).to.eq(
                    globalLiquidityPosition.liquidationBufferNetSize,
                );
                expect(stateAfter.globalLiquidityPosition.previousSPPriceX96).to.eq(
                    globalLiquidityPosition.previousSPPriceX96,
                );
                expect(stateAfter.globalLiquidityPosition.side).to.eq(globalLiquidityPosition.side);
                expect(stateAfter.globalLiquidityPosition.liquidity).to.eq(globalLiquidityPosition.liquidity);
                expect(stateAfter.globalLiquidityPosition.unrealizedPnLGrowthX64).to.eq(
                    globalLiquidityPosition.unrealizedPnLGrowthX64,
                );

                expect(stateAfter.globalFundingRateSample.lastAdjustFundingRateTime).to.eq(
                    simulateRes.lastAdjustFundingRateTimeAfter,
                );
                expect(stateAfter.globalFundingRateSample.sampleCount).to.eq(simulateRes.sampleCountAfter);
                expect(stateAfter.globalFundingRateSample.cumulativePremiumRateX96).to.eq(
                    simulateRes.cumulativePremiumRateAfterX96,
                );

                expect(stateAfter.previousGlobalFundingRate.longFundingRateGrowthX96).to.eq(
                    globalPosition.longFundingRateGrowthX96,
                );
                expect(stateAfter.previousGlobalFundingRate.shortFundingRateGrowthX96).to.eq(
                    globalPosition.shortFundingRateGrowthX96,
                );
            }
        });

        it("should not adjust received funding rate growth when received size is zero", async () => {
            const {fundingRateUtil, _fundingRateUtil, ETHMarketDescriptor, mockPriceFeed} =
                await loadFixture(deployFixture);

            const lastTimestamp = await time.latest();
            let nextHourBegin = lastTimestamp - (lastTimestamp % 3600) + 3600;
            await time.setNextBlockTimestamp(nextHourBegin);

            let globalPosition = {
                longSize: 1n,
                shortSize: 0n,
                maxSize: 3n,
                maxSizePerPosition: 4n,
                longFundingRateGrowthX96: 5n,
                shortFundingRateGrowthX96: 6n,
            };

            let globalFundingRateSample = {
                lastAdjustFundingRateTime: toBigInt(nextHourBegin),
                sampleCount: 8n,
                cumulativePremiumRateX96: toX96("1000"),
            };

            let globalLiquidityPosition = newGlobalLiquidityPosition();
            let priceState = newPriceState();

            // global liquidity position side is long
            await fundingRateUtil.setGlobalPosition(globalPosition);
            await fundingRateUtil.setGlobalFundingRateSample(globalFundingRateSample);
            await fundingRateUtil.setGlobalLiquidityPosition(globalLiquidityPosition);
            await fundingRateUtil.setPriceState(priceState);

            let marketBaseConfigNew = newMarketBaseConfig();
            {
                // change market base config
                marketBaseConfigNew.maxFundingRate = marketBaseConfigNew.maxFundingRate / 25n;
                marketBaseConfigNew.interestRate = marketBaseConfigNew.interestRate * 10n;
                await fundingRateUtil.setMarketBaseConfig(marketBaseConfigNew);
            }

            await time.setNextBlockTimestamp(nextHourBegin + 3600);
            const simulateRes = simulateSampleAndAdjustFundingRate(
                globalPosition,
                globalLiquidityPosition,
                globalFundingRateSample,
                priceState,
                marketBaseConfigNew.maxFundingRate,
                toBigInt(nextHourBegin + 3600),
                isLongSide(flipSide(globalLiquidityPosition.side))
                    ? await mockPriceFeed.getMaxPriceX96(ETHMarketDescriptor.target)
                    : await mockPriceFeed.getMinPriceX96(ETHMarketDescriptor.target),
                await mockPriceFeed.getMaxPriceX96(ETHMarketDescriptor.target),
                marketBaseConfigNew.interestRate,
            );
            expect(simulateRes.timeDelta).to.gte(SAMPLE_PREMIUM_RATE_INTERVAL);
            expect(simulateRes.shouldAdjustFundingRate).to.true;
            expect(simulateRes.fundingRateDeltaX96).to.gt(
                mulDiv(marketBaseConfigNew.maxFundingRate, Q96, BASIS_POINTS_DIVISOR, Rounding.Up),
            );
            expect(simulateRes.clampedFundingRateDeltaX96).to.eq(
                mulDiv(marketBaseConfigNew.maxFundingRate, Q96, BASIS_POINTS_DIVISOR, Rounding.Up),
            );
            expect(simulateRes.sampleCountAfter).to.eq(0n);
            expect(simulateRes.lastAdjustFundingRateTimeAfter).to.eq(nextHourBegin + 3600);

            const assertion = expect(fundingRateUtil.sampleAndAdjustFundingRate(ETHMarketDescriptor.target));
            await assertion.to
                .emit(_fundingRateUtil.attach(fundingRateUtil.target), "GlobalFundingRateSampleAdjusted")
                .withArgs(
                    ETHMarketDescriptor.target,
                    simulateRes.sampleCountAfter,
                    simulateRes.cumulativePremiumRateAfterX96,
                );
            await assertion.to
                .emit(_fundingRateUtil.attach(fundingRateUtil.target), "FundingRateGrowthAdjusted")
                .withArgs(
                    ETHMarketDescriptor.target,
                    simulateRes.clampedFundingRateDeltaX96,
                    simulateRes.longFundingRateGrowthAfterX96,
                    simulateRes.shortFundingRateGrowthAfterX96,
                    simulateRes.lastAdjustFundingRateTimeAfter,
                );
            await assertion.to
                .emit(
                    _fundingRateUtil.attach(fundingRateUtil.target),
                    "GlobalLiquidityPositionPnLGrowthIncreasedByFundingFee",
                )
                .withArgs(ETHMarketDescriptor.target, simulateRes.unrealizedPnLGrowthAfterX64);

            {
                const stateAfter = await fundingRateUtil.state();
                expect(stateAfter.globalPosition.longSize).to.eq(globalPosition.longSize);
                expect(stateAfter.globalPosition.shortSize).to.eq(globalPosition.shortSize);
                expect(stateAfter.globalPosition.maxSize).to.eq(globalPosition.maxSize);
                expect(stateAfter.globalPosition.maxSizePerPosition).to.eq(globalPosition.maxSizePerPosition);
                expect(stateAfter.globalPosition.longFundingRateGrowthX96).to.eq(
                    simulateRes.longFundingRateGrowthAfterX96,
                );
                expect(stateAfter.globalPosition.longFundingRateGrowthX96).to.not.eq(
                    globalPosition.longFundingRateGrowthX96,
                );
                expect(stateAfter.globalPosition.shortFundingRateGrowthX96).to.eq(
                    simulateRes.shortFundingRateGrowthAfterX96,
                );
                expect(stateAfter.globalPosition.shortFundingRateGrowthX96).to.eq(
                    globalPosition.shortFundingRateGrowthX96,
                );

                expect(stateAfter.globalLiquidityPosition.netSize).to.eq(globalLiquidityPosition.netSize);
                expect(stateAfter.globalLiquidityPosition.liquidationBufferNetSize).to.eq(
                    globalLiquidityPosition.liquidationBufferNetSize,
                );
                expect(stateAfter.globalLiquidityPosition.previousSPPriceX96).to.eq(
                    globalLiquidityPosition.previousSPPriceX96,
                );
                expect(stateAfter.globalLiquidityPosition.side).to.eq(globalLiquidityPosition.side);
                expect(stateAfter.globalLiquidityPosition.liquidity).to.eq(globalLiquidityPosition.liquidity);
                expect(stateAfter.globalLiquidityPosition.unrealizedPnLGrowthX64).to.eq(
                    simulateRes.unrealizedPnLGrowthAfterX64,
                );

                expect(stateAfter.globalFundingRateSample.lastAdjustFundingRateTime).to.eq(
                    simulateRes.lastAdjustFundingRateTimeAfter,
                );
                expect(stateAfter.globalFundingRateSample.sampleCount).to.eq(simulateRes.sampleCountAfter);
                expect(stateAfter.globalFundingRateSample.cumulativePremiumRateX96).to.eq(
                    simulateRes.cumulativePremiumRateAfterX96,
                );

                expect(stateAfter.previousGlobalFundingRate.longFundingRateGrowthX96).to.eq(
                    globalPosition.longFundingRateGrowthX96,
                );
                expect(stateAfter.previousGlobalFundingRate.shortFundingRateGrowthX96).to.eq(
                    globalPosition.shortFundingRateGrowthX96,
                );
            }
        });
    });
});

function simulateSampleAndAdjustFundingRate(
    globalPosition: {
        longSize: bigint;
        shortSize: bigint;
        maxSize: bigint;
        maxSizePerPosition: bigint;
        longFundingRateGrowthX96: bigint;
        shortFundingRateGrowthX96: bigint;
    },
    globalLiquidityPosition: {
        netSize: bigint;
        liquidationBufferNetSize: bigint;
        previousSPPriceX96: bigint;
        side: number;
        liquidity: bigint;
        unrealizedPnLGrowthX64: bigint;
    },
    globalFundingRateSample: {lastAdjustFundingRateTime: bigint; sampleCount: bigint; cumulativePremiumRateX96: bigint},
    priceState: {
        premiumRateX96: bigint;
        pendingVertexIndex: bigint;
        currentVertexIndex: bigint;
        basisIndexPriceX96: bigint;
        priceVertices: {size: bigint; premiumRateX96: bigint}[];
        liquidationBufferNetSizes: number[];
    },
    maxFundingRate: bigint,
    blockTimestamp: bigint,
    flipIndexPriceX96: bigint,
    maxIndexPriceX96: bigint,
    interestRate: bigint,
) {
    let res = {
        timeDelta: 0n,
        shouldAdjustFundingRate: false,
        fundingRateDeltaX96: 0n,
        sampleCountAfter: globalFundingRateSample.sampleCount,
        cumulativePremiumRateAfterX96: globalFundingRateSample.cumulativePremiumRateX96,
        lastAdjustFundingRateTimeAfter: globalFundingRateSample.lastAdjustFundingRateTime,
        unrealizedPnLGrowthAfterX64: 0n,
        clampedFundingRateDeltaX96: 0n,
        longFundingRateGrowthAfterX96: 0n,
        shortFundingRateGrowthAfterX96: 0n,
    };
    {
        // simulate sample premium rate
        const lastAdjustFundingRateTime = globalFundingRateSample.lastAdjustFundingRateTime;
        const maxSamplingTime = lastAdjustFundingRateTime + ADJUST_FUNDING_RATE_INTERVAL;
        let currentTimestamp = blockTimestamp;
        if (maxSamplingTime < currentTimestamp) currentTimestamp = maxSamplingTime;

        const lastSamplingTime =
            lastAdjustFundingRateTime + globalFundingRateSample.sampleCount * SAMPLE_PREMIUM_RATE_INTERVAL;
        res.timeDelta = currentTimestamp - lastSamplingTime;
        if (res.timeDelta >= SAMPLE_PREMIUM_RATE_INTERVAL) {
            const actualPremiumRateX96 = mulDiv(
                priceState.premiumRateX96,
                priceState.basisIndexPriceX96,
                flipIndexPriceX96,
                Rounding.Up,
            );
            {
                // simulate sample premium rate and calculate funding rate
                const premiumRateX96 = isLongSide(globalLiquidityPosition.side)
                    ? -actualPremiumRateX96
                    : actualPremiumRateX96;
                const sampleCountDelta = res.timeDelta / SAMPLE_PREMIUM_RATE_INTERVAL;
                const sampleCountAfter = globalFundingRateSample.sampleCount + sampleCountDelta;
                const cumulativePremiumRateDeltaX96 =
                    premiumRateX96 *
                    (((globalFundingRateSample.sampleCount + 1n + sampleCountAfter) * sampleCountDelta) / 2n);
                const cumulativePremiumRateX96 =
                    globalFundingRateSample.cumulativePremiumRateX96 + cumulativePremiumRateDeltaX96;
                if (sampleCountAfter < REQUIRED_SAMPLE_COUNT) {
                    res.sampleCountAfter = sampleCountAfter;
                    res.cumulativePremiumRateAfterX96 = cumulativePremiumRateX96;
                } else {
                    const premiumRateAvgX96 =
                        cumulativePremiumRateX96 >= 0n
                            ? mulDiv(cumulativePremiumRateX96, 1n, PREMIUM_RATE_AVG_DENOMINATOR, Rounding.Up)
                            : -mulDiv(-cumulativePremiumRateX96, 1n, PREMIUM_RATE_AVG_DENOMINATOR, Rounding.Up);
                    res.fundingRateDeltaX96 = premiumRateAvgX96 + _clamp(premiumRateAvgX96, interestRate);
                    res.lastAdjustFundingRateTimeAfter = maxSamplingTime;
                    res.sampleCountAfter = 0n;
                    res.cumulativePremiumRateAfterX96 = 0n;
                    res.shouldAdjustFundingRate = true;
                }
            }
        }

        if (res.shouldAdjustFundingRate) {
            // simulate calculate funding rate growth x96
            const maxFundingRateX96 = mulDiv(maxFundingRate, Q96, BASIS_POINTS_DIVISOR, Rounding.Up);
            if (res.fundingRateDeltaX96 > maxFundingRateX96) res.clampedFundingRateDeltaX96 = maxFundingRateX96;
            else if (res.fundingRateDeltaX96 < -maxFundingRateX96) res.clampedFundingRateDeltaX96 = -maxFundingRateX96;
            else res.clampedFundingRateDeltaX96 = res.fundingRateDeltaX96;

            const [paidSize, receivedSize, clampedFundingRateDeltaAbsX96] =
                res.clampedFundingRateDeltaX96 >= 0n
                    ? [globalPosition.longSize, globalPosition.shortSize, res.clampedFundingRateDeltaX96]
                    : [globalPosition.shortSize, globalPosition.longSize, -res.clampedFundingRateDeltaX96];

            res.longFundingRateGrowthAfterX96 = globalPosition.longFundingRateGrowthX96;
            res.shortFundingRateGrowthAfterX96 = globalPosition.shortFundingRateGrowthX96;
            res.unrealizedPnLGrowthAfterX64 = globalLiquidityPosition.unrealizedPnLGrowthX64;
            if (paidSize > 0n) {
                const paidFundingRateGrowthDeltaX96 = mulDiv(
                    maxIndexPriceX96,
                    clampedFundingRateDeltaAbsX96,
                    Q96,
                    Rounding.Up,
                );
                let receivedFundingRateGrowthDeltaX96 = 0n;
                if (paidFundingRateGrowthDeltaX96 > 0) {
                    if (paidSize > receivedSize) {
                        const unrealizedPnLGrowthDeltaX64 = mulDiv(
                            paidSize - receivedSize,
                            paidFundingRateGrowthDeltaX96,
                            Q32 * globalLiquidityPosition.liquidity,
                        );
                        res.unrealizedPnLGrowthAfterX64 =
                            globalLiquidityPosition.unrealizedPnLGrowthX64 + unrealizedPnLGrowthDeltaX64;
                        receivedFundingRateGrowthDeltaX96 = receivedSize == 0n ? 0n : paidFundingRateGrowthDeltaX96;
                    } else {
                        receivedFundingRateGrowthDeltaX96 =
                            receivedSize == 0n ? 0n : mulDiv(paidSize, paidFundingRateGrowthDeltaX96, receivedSize);
                    }
                }

                if (res.clampedFundingRateDeltaX96 >= 0) {
                    res.longFundingRateGrowthAfterX96 -= paidFundingRateGrowthDeltaX96;
                    res.shortFundingRateGrowthAfterX96 += receivedFundingRateGrowthDeltaX96;
                } else {
                    res.shortFundingRateGrowthAfterX96 -= paidFundingRateGrowthDeltaX96;
                    res.longFundingRateGrowthAfterX96 += receivedFundingRateGrowthDeltaX96;
                }
            }
        }
    }
    return res;
}

function _clamp(_premiumRateAvgX96: bigint, _interestRate: bigint): bigint {
    const interestRateX96 = mulDiv(_interestRate, Q96, BASIS_POINTS_DIVISOR, Rounding.Up);
    const rateDeltaX96 = interestRateX96 - _premiumRateAvgX96;
    if (rateDeltaX96 > PREMIUM_RATE_CLAMP_BOUNDARY_X96) return PREMIUM_RATE_CLAMP_BOUNDARY_X96;
    else if (rateDeltaX96 < -PREMIUM_RATE_CLAMP_BOUNDARY_X96) return -PREMIUM_RATE_CLAMP_BOUNDARY_X96;
    else return rateDeltaX96;
}
