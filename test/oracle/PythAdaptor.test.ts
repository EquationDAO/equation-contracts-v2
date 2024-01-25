import {ethers} from "hardhat";
import {loadFixture, time} from "@nomicfoundation/hardhat-network-helpers";
import {toBigInt} from "ethers";
import Decimal from "decimal.js";
import {expect} from "chai";

describe("PythAdaptor", () => {
    type PriceData = {
        tick: bigint;
        publishTime: bigint;
        index: bigint;
    };

    const BTCAssetId = "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43";
    const ETHAssetId = "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";
    const SOLAssetId = "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";
    const ARBAssetId = "0x3fa4252848f9f0a1480be62745a4629d9eb1322aebab8a791e344b3b9c1adcf5";
    const OPAssetId = "0x385f64d993f7b77d8182ed5003d97c60aa3361f3cecfe711544d2d59165e9bdf";
    const MATICAssetId = "0x5de33a9112c2b700b8d30b8a3402c103578ccfa2765696471cc672bd5cf6ac52";
    const AVAXAssetId = "0x93da3352f9f1d105fdfe4971cfa80e9dd777bfc5d0f683ebb6e1294b92137bb7";
    const USDTAssetId = "0x2b89b9dc8fdf9f34709a5b106b472f0f39bb6ca9ce04b0fd7f2e971688e2e53b";

    const assetIds = [ETHAssetId, BTCAssetId, SOLAssetId, ARBAssetId, OPAssetId, MATICAssetId, AVAXAssetId];
    const assetIdsPart1 = [ETHAssetId, BTCAssetId, SOLAssetId];
    const assetIdsPart2 = [ARBAssetId, OPAssetId, MATICAssetId, AVAXAssetId];
    const rawPrices = ["2532.13", "42890.1", "96.92", "2.1355", "3.5305", "0.8522", "36.132"];

    async function deployFixture() {
        const [owner] = await ethers.getSigners();
        const PythAdaptor = await ethers.getContractFactory("PythAdaptor");
        const TickMathTest = await ethers.getContractFactory("TickMathTest");
        const Helper = await ethers.getContractFactory("PythAdaptorHelper");
        const pythAdaptor = await PythAdaptor.deploy(USDTAssetId);
        const helper = await Helper.deploy(pythAdaptor);
        await pythAdaptor.assignAssetsIndexes(assetIdsPart1);
        await pythAdaptor.setUpdater(owner, true);
        await pythAdaptor.setUpdater(helper, true);
        const tickMathTest = await TickMathTest.deploy();

        return {pythAdaptor, owner, tickMathTest, helper};
    }

    function gatherPriceData(priceData: PriceData[]) {
        priceData = priceData.sort(function (a, b) {
            return Number(a.index - b.index);
        });
        let minTimestamp = 100000000000n;
        for (let i = 0; i < priceData.length; i++) {
            if (priceData[i].publishTime < minTimestamp) {
                minTimestamp = priceData[i].publishTime;
            }
        }
        let encodedData = new Map();
        for (let i = 0; i < priceData.length; i++) {
            let outerIndex = toBigInt(i) / 4n;
            if (!encodedData.has(outerIndex)) {
                encodedData.set(outerIndex, 0n);
            }
            let param = encodedData.get(outerIndex);
            param += priceData[i].index * 2n ** ((toBigInt(i) % 4n) * 64n);
            if (priceData[i].tick >= 0n) {
                param += priceData[i].tick * 2n ** ((toBigInt(i) % 4n) * 64n + 16n);
            } else {
                param += (2n ** 24n + priceData[i].tick) * 2n ** ((toBigInt(i) % 4n) * 64n + 16n);
            }
            param += (priceData[i].publishTime - minTimestamp) * 2n ** ((toBigInt(i) % 4n) * 64n + 40n);
            encodedData.set(outerIndex, param);
        }
        let res = [];
        for (let value of encodedData.values()) {
            res.push(value);
        }
        return {res, minTimestamp};
    }

    function toSqrtX96(price: string) {
        let de = new Decimal(price).sqrt().mul(new Decimal(2).pow(new Decimal(96)));
        const bi = BigInt(de.toNumber());
        return bi.valueOf();
    }

    describe("PythAdaptor test", () => {
        it("update prices and clear price", async () => {
            const {pythAdaptor, owner, tickMathTest} = await loadFixture(deployFixture);
            await pythAdaptor.assignAssetsIndexes(assetIdsPart2);
            const latestBlockTimestamp = await time.latest();
            const canIgnoredDeviationPercent = 0.001; // 0.1%
            const publishTimeDiff = [-1n, 0n, 1n, 2n, 3n, 4n, 5n];
            let {res, minTimestamp} = gatherPriceData([
                {
                    // eth
                    tick: await tickMathTest.getTickAtSqrtRatio(toSqrtX96(rawPrices[0])),
                    publishTime: toBigInt(latestBlockTimestamp) + publishTimeDiff[0],
                    index: 1n,
                },
                {
                    // btc
                    tick: await tickMathTest.getTickAtSqrtRatio(toSqrtX96(rawPrices[1])),
                    publishTime: toBigInt(latestBlockTimestamp) + publishTimeDiff[1],
                    index: 2n,
                },
                {
                    // sol
                    tick: await tickMathTest.getTickAtSqrtRatio(toSqrtX96(rawPrices[2])),
                    publishTime: toBigInt(latestBlockTimestamp) + publishTimeDiff[2],
                    index: 3n,
                },
                {
                    // arb
                    tick: await tickMathTest.getTickAtSqrtRatio(toSqrtX96(rawPrices[3])),
                    publishTime: toBigInt(latestBlockTimestamp) + publishTimeDiff[3],
                    index: 4n,
                },
                {
                    // op
                    tick: await tickMathTest.getTickAtSqrtRatio(toSqrtX96(rawPrices[4])),
                    publishTime: toBigInt(latestBlockTimestamp) + publishTimeDiff[4],
                    index: 5n,
                },
                {
                    // matic
                    tick: await tickMathTest.getTickAtSqrtRatio(toSqrtX96(rawPrices[5])),
                    publishTime: toBigInt(latestBlockTimestamp) + publishTimeDiff[5],
                    index: 6n,
                },
                {
                    // avax
                    tick: await tickMathTest.getTickAtSqrtRatio(toSqrtX96(rawPrices[6])),
                    publishTime: toBigInt(latestBlockTimestamp) + publishTimeDiff[6],
                    index: 7n,
                },
            ]);
            await expect(
                pythAdaptor.updatePriceFeeds(
                    res,
                    minTimestamp,
                    "0x5de33a9112c2b700b8d30b8a3402c103578ccfa2765696471cc672bd5cf6ac52",
                ),
            )
                .to.emit(pythAdaptor, "LogVaas")
                .withArgs("0x5de33a9112c2b700b8d30b8a3402c103578ccfa2765696471cc672bd5cf6ac52");
            for (let i = 0; i < assetIds.length; ++i) {
                let priceData = await pythAdaptor.getPriceUnsafe(assetIds[i]);
                let truePrice = Number(rawPrices[i]) * 10 ** 8;
                let diff = truePrice - Number(priceData[0]);
                if (diff < 0) {
                    diff = -diff;
                }
                expect(diff / truePrice).lt(canIgnoredDeviationPercent);
            }
            await pythAdaptor.clearPrices(assetIds);
            for (let i = 0; i < assetIds.length; ++i) {
                await expect(pythAdaptor.getPriceUnsafe(assetIds[i]))
                    .to.revertedWithCustomError(pythAdaptor, "PriceDataNotExist")
                    .withArgs(assetIds[i]);
            }
        });

        it("test affectedAssetIds", async () => {
            const {pythAdaptor, helper, owner, tickMathTest} = await loadFixture(deployFixture);
            await pythAdaptor.assignAssetsIndexes(assetIdsPart2);
            const latestBlockTimestamp = await time.latest();
            const publishTimeDiff = [-1n, 0n, 1n, 2n, 3n, 4n, 5n];
            let {res, minTimestamp} = gatherPriceData([
                {
                    // eth
                    tick: await tickMathTest.getTickAtSqrtRatio(toSqrtX96(rawPrices[0])),
                    publishTime: toBigInt(latestBlockTimestamp) + publishTimeDiff[0],
                    index: 1n,
                },
                {
                    // btc
                    tick: await tickMathTest.getTickAtSqrtRatio(toSqrtX96(rawPrices[1])),
                    publishTime: toBigInt(latestBlockTimestamp) + publishTimeDiff[1],
                    index: 2n,
                },
                {
                    // sol
                    tick: await tickMathTest.getTickAtSqrtRatio(toSqrtX96(rawPrices[2])),
                    publishTime: toBigInt(latestBlockTimestamp) + publishTimeDiff[2],
                    index: 3n,
                },
                {
                    // arb
                    tick: await tickMathTest.getTickAtSqrtRatio(toSqrtX96(rawPrices[3])),
                    publishTime: toBigInt(latestBlockTimestamp) + publishTimeDiff[3],
                    index: 4n,
                },
                {
                    // op
                    tick: await tickMathTest.getTickAtSqrtRatio(toSqrtX96(rawPrices[4])),
                    publishTime: toBigInt(latestBlockTimestamp) + publishTimeDiff[4],
                    index: 5n,
                },
                {
                    // matic
                    tick: await tickMathTest.getTickAtSqrtRatio(toSqrtX96(rawPrices[5])),
                    publishTime: toBigInt(latestBlockTimestamp) + publishTimeDiff[5],
                    index: 6n,
                },
                {
                    // avax
                    tick: await tickMathTest.getTickAtSqrtRatio(toSqrtX96(rawPrices[6])),
                    publishTime: toBigInt(latestBlockTimestamp) + publishTimeDiff[6],
                    index: 7n,
                },
            ]);
            await expect(
                helper.updatePriceFeeds(
                    res,
                    minTimestamp,
                    "0x5de33a9112c2b700b8d30b8a3402c103578ccfa2765696471cc672bd5cf6ac52",
                ),
            )
                .to.emit(pythAdaptor, "LogVaas")
                .withArgs("0x5de33a9112c2b700b8d30b8a3402c103578ccfa2765696471cc672bd5cf6ac52");
            expect(await helper.affectedAssetIdLength()).equal(8);
            for (let i = 0; i < assetIds.length; ++i) {
                await expect(pythAdaptor.getPriceUnsafe(assetIds[i]))
                    .to.revertedWithCustomError(pythAdaptor, "PriceDataNotExist")
                    .withArgs(assetIds[i]);
            }
        });

        it("update price for asset that not registered", async () => {
            const {pythAdaptor, owner, tickMathTest} = await loadFixture(deployFixture);
            const latestBlockTimestamp = await time.latest();
            const publishTimeDiff = [-1n, 0n, 1n, 2n, 3n, 4n, 5n];
            let {res, minTimestamp} = gatherPriceData([
                {
                    // eth
                    tick: await tickMathTest.getTickAtSqrtRatio(toSqrtX96(rawPrices[0])),
                    publishTime: toBigInt(latestBlockTimestamp) + publishTimeDiff[0],
                    index: 1n,
                },
                {
                    // btc
                    tick: await tickMathTest.getTickAtSqrtRatio(toSqrtX96(rawPrices[1])),
                    publishTime: toBigInt(latestBlockTimestamp) + publishTimeDiff[1],
                    index: 2n,
                },
                {
                    // sol
                    tick: await tickMathTest.getTickAtSqrtRatio(toSqrtX96(rawPrices[2])),
                    publishTime: toBigInt(latestBlockTimestamp) + publishTimeDiff[2],
                    index: 3n,
                },
                {
                    // arb asset id not assigned to index
                    tick: await tickMathTest.getTickAtSqrtRatio(toSqrtX96(rawPrices[3])),
                    publishTime: toBigInt(latestBlockTimestamp) + publishTimeDiff[3],
                    index: 4n,
                },
            ]);
            await expect(
                pythAdaptor.updatePriceFeeds(
                    res,
                    minTimestamp,
                    "0x5de33a9112c2b700b8d30b8a3402c103578ccfa2765696471cc672bd5cf6ac52",
                ),
            )
                .to.revertedWithCustomError(pythAdaptor, "InvalidAssetIndex")
                .withArgs(4);
        });

        it("extreme number price test", async () => {
            const extremePrice = ["1", "92233720367", "93233720367"];
            const {pythAdaptor, owner, tickMathTest} = await loadFixture(deployFixture);
            await pythAdaptor.assignAssetsIndexes(assetIdsPart2);
            const latestBlockTimestamp = await time.latest();
            const canIgnoredDeviationPercent = 0.001; // 0.1%
            const publishTimeDiff = [-1n, 0n, 1n, 2n, 3n, 4n, 5n];
            let {res, minTimestamp} = gatherPriceData([
                {
                    // eth
                    tick: await tickMathTest.getTickAtSqrtRatio(toSqrtX96(extremePrice[0])),
                    publishTime: toBigInt(latestBlockTimestamp) + publishTimeDiff[0],
                    index: 1n,
                },
                {
                    // btc
                    tick: await tickMathTest.getTickAtSqrtRatio(toSqrtX96(extremePrice[1])),
                    publishTime: toBigInt(latestBlockTimestamp) + publishTimeDiff[1],
                    index: 2n,
                },
                {
                    // sol
                    tick: await tickMathTest.getTickAtSqrtRatio(toSqrtX96(extremePrice[2])),
                    publishTime: toBigInt(latestBlockTimestamp) + publishTimeDiff[2],
                    index: 3n,
                },
            ]);
            await expect(
                pythAdaptor.updatePriceFeeds(
                    res,
                    minTimestamp,
                    "0x5de33a9112c2b700b8d30b8a3402c103578ccfa2765696471cc672bd5cf6ac52",
                ),
            )
                .to.emit(pythAdaptor, "LogVaas")
                .withArgs("0x5de33a9112c2b700b8d30b8a3402c103578ccfa2765696471cc672bd5cf6ac52");

            for (let i = 0; i < assetIdsPart1.length; ++i) {
                if (i == 2) {
                    await expect(pythAdaptor.getPriceUnsafe(assetIdsPart1[i])).to.revertedWithCustomError(
                        pythAdaptor,
                        "SafeCastOverflowedIntDowncast",
                    );
                    continue;
                }
                let priceData = await pythAdaptor.getPriceUnsafe(assetIdsPart1[i]);
                let truePrice = Number(extremePrice[i]) * 10 ** 8;
                let diff = truePrice - Number(priceData[0]);
                if (diff < 0) {
                    diff = -diff;
                }
                expect(diff / truePrice).lt(canIgnoredDeviationPercent);
            }
            await pythAdaptor.clearPrices([ETHAssetId, BTCAssetId, SOLAssetId]);
            for (let i = 0; i < assetIdsPart1.length; ++i) {
                await expect(pythAdaptor.getPriceUnsafe(assetIdsPart1[i]))
                    .to.revertedWithCustomError(pythAdaptor, "PriceDataNotExist")
                    .withArgs(assetIdsPart1[i]);
            }
        });
    });
});
