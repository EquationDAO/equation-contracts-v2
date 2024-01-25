import {ethers} from "hardhat";
import {loadFixture, time} from "@nomicfoundation/hardhat-network-helpers";

import Decimal from "decimal.js";
import {expect} from "chai";
import {PythPriceFeed} from "../../typechain-types";
import {BigNumberish, toBigInt} from "ethers";

describe("PythAdaptor", () => {
    type PriceData = {
        tick: bigint;
        publishTime: bigint;
        index: bigint;
    };

    const BTCAssetId = "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43";
    const ETHAssetId = "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";
    const USDTAssetId = "0x2b89b9dc8fdf9f34709a5b106b472f0f39bb6ca9ce04b0fd7f2e971688e2e53b";

    const BTCMarket = "0x0000000000000000000000000000000000000001";
    const ETHMarket = "0x0000000000000000000000000000000000000002";

    const assetIds = [ETHAssetId, BTCAssetId];
    const rawPrices = ["2532.13", "42890.1", "0.998855"];

    async function deployFixture() {
        const [owner, notOwner] = await ethers.getSigners();
        const PythAdaptor = await ethers.getContractFactory("PythAdaptor");
        const TickMathTest = await ethers.getContractFactory("TickMathTest");
        const Helper = await ethers.getContractFactory("PythAdaptorHelper");
        const PythPriceFee = await ethers.getContractFactory("PythPriceFeed");
        const pythAdaptor = await PythAdaptor.deploy(USDTAssetId);
        const helper = await Helper.deploy(pythAdaptor);
        await pythAdaptor.assignAssetsIndexes(assetIds);
        await pythAdaptor.setUpdater(owner, true);
        await pythAdaptor.setUpdater(helper, true);
        const tickMathTest = await TickMathTest.deploy();
        const latestBlockTimestamp = await time.latest();
        let {res, minTimestamp} = gatherPriceData([
            {
                // eth
                tick: await tickMathTest.getTickAtSqrtRatio(toSqrtX96(rawPrices[0])),
                publishTime: toBigInt(latestBlockTimestamp),
                index: 1n,
            },
            {
                // btc
                tick: await tickMathTest.getTickAtSqrtRatio(toSqrtX96(rawPrices[1])),
                publishTime: toBigInt(latestBlockTimestamp),
                index: 2n,
            },
            {
                // usdt
                tick: await tickMathTest.getTickAtSqrtRatio(toSqrtX96(rawPrices[2])),
                publishTime: toBigInt(latestBlockTimestamp),
                index: 65535n,
            },
        ]);
        await pythAdaptor.updatePriceFeeds(
            res,
            minTimestamp,
            "0x5de33a9112c2b700b8d30b8a3402c103578ccfa2765696471cc672bd5cf6ac52",
        );

        const pythPriceFeed = await PythPriceFee.deploy(pythAdaptor, USDTAssetId, false);
        await pythPriceFeed.setUpdater(owner.address, true);
        await pythPriceFeed.setPythAssetId(BTCMarket, BTCAssetId);
        await pythPriceFeed.setPythAssetId(ETHMarket, ETHAssetId);

        return {pythAdaptor, owner, tickMathTest, helper, pythPriceFeed, notOwner};
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

    function toPriceX96(
        price: string,
        tokenDecimals: bigint = 18n,
        usdDecimals: bigint = 6n,
        refPriceDecimals: bigint = 18n,
    ): bigint {
        const intPrice = BigInt(Number(price) * Number(10n ** usdDecimals));
        return (intPrice * 10n ** refPriceDecimals * 2n ** 96n) / 10n ** tokenDecimals / 10n ** refPriceDecimals;
    }

    describe("PythPriceFeed test", () => {
        it("update prices", async () => {
            const latestBlockTimestamp = await time.latest();
            const {pythPriceFeed} = await loadFixture(deployFixture);
            await expect(
                pythPriceFeed.setPriceX96s(
                    [
                        {
                            market: ETHMarket,
                            priceX96: toPriceX96(rawPrices[0]),
                        },
                        {
                            market: BTCMarket,
                            priceX96: toPriceX96(rawPrices[1]),
                        },
                    ],
                    latestBlockTimestamp,
                ),
            ).emit(pythPriceFeed, "PriceUpdated");
            expect(await pythPriceFeed.getMinPriceX96(ETHMarket)).equal(toPriceX96(rawPrices[0]));
            expect(await pythPriceFeed.getMaxPriceX96(ETHMarket)).equal(toPriceX96(rawPrices[0]));
            expect(await pythPriceFeed.getMinPriceX96(BTCMarket)).equal(toPriceX96(rawPrices[1]));
            expect(await pythPriceFeed.getMaxPriceX96(BTCMarket)).equal(toPriceX96(rawPrices[1]));
        });

        it("the difference between price and refPrice is greater than maxDeviationRatio", async () => {
            const latestBlockTimestamp = await time.latest();
            const {pythPriceFeed, owner, tickMathTest} = await loadFixture(deployFixture);
            const maxETHPriceX96 = (toPriceX96(rawPrices[0]) * 12n) / 10n;
            const minBTCPriceX96 = (toPriceX96(rawPrices[1]) * 10n) / 12n;
            await expect(
                pythPriceFeed.setPriceX96s(
                    [
                        {
                            market: ETHMarket,
                            priceX96: maxETHPriceX96,
                        },
                        {
                            market: BTCMarket,
                            priceX96: minBTCPriceX96,
                        },
                    ],
                    latestBlockTimestamp,
                ),
            ).emit(pythPriceFeed, "PriceUpdated");
            expect(await pythPriceFeed.getMinPriceX96(ETHMarket)).not.equal(maxETHPriceX96);
            expect(await pythPriceFeed.getMaxPriceX96(ETHMarket)).equal(maxETHPriceX96);
            expect(await pythPriceFeed.getMinPriceX96(BTCMarket)).equal(minBTCPriceX96);
            expect(await pythPriceFeed.getMaxPriceX96(BTCMarket)).not.equal(minBTCPriceX96);
        });

        it("referencePriceAdjustmentMagnifications test", async () => {
            const latestBlockTimestamp = await time.latest();
            const {pythPriceFeed} = await loadFixture(deployFixture);
            await pythPriceFeed.setReferencePriceAdjustmentMagnification(ETHMarket, 100);
            await expect(
                pythPriceFeed.setPriceX96s(
                    [
                        {
                            market: ETHMarket,
                            priceX96: toPriceX96(rawPrices[0]) * 100n,
                        },
                        {
                            market: BTCMarket,
                            priceX96: toPriceX96(rawPrices[1]),
                        },
                    ],
                    latestBlockTimestamp,
                ),
            ).emit(pythPriceFeed, "PriceUpdated");
            expect(await pythPriceFeed.getMinPriceX96(ETHMarket)).equal(toPriceX96(rawPrices[0]) * 100n);
            expect(await pythPriceFeed.getMaxPriceX96(ETHMarket)).equal(toPriceX96(rawPrices[0]) * 100n);
            expect(await pythPriceFeed.getMinPriceX96(BTCMarket)).equal(toPriceX96(rawPrices[1]));
            expect(await pythPriceFeed.getMaxPriceX96(BTCMarket)).equal(toPriceX96(rawPrices[1]));
        });

        it("role test", async () => {
            const latestBlockTimestamp = await time.latest();
            const {pythPriceFeed, notOwner} = await loadFixture(deployFixture);
            const maxETHPriceX96 = (toPriceX96(rawPrices[0]) * 12n) / 10n;
            const minBTCPriceX96 = (toPriceX96(rawPrices[1]) * 10n) / 12n;
            await pythPriceFeed.setPythAssetId(
                "0x0000000000000000000000000000000000000003",
                "0x5de33a9112c2b700b8d30b8a3402c103578ccfa2765696471cc672bd5cf6ac52",
            );
            expect(await pythPriceFeed.pythAssetIds("0x0000000000000000000000000000000000000003")).equal(
                "0x5de33a9112c2b700b8d30b8a3402c103578ccfa2765696471cc672bd5cf6ac52",
            );

            await pythPriceFeed.setUpdater("0x0000000000000000000000000000000000000003", true);
            expect(await pythPriceFeed.isUpdater("0x0000000000000000000000000000000000000003")).equal(true);

            await pythPriceFeed.setReferencePriceAdjustmentMagnification(
                "0x0000000000000000000000000000000000000003",
                100,
            );
            expect(
                await pythPriceFeed.referencePriceAdjustmentMagnifications(
                    "0x0000000000000000000000000000000000000003",
                ),
            ).equal(100);

            await pythPriceFeed.setValidTimePeriod(100);
            await pythPriceFeed.setMaxDeviationRatio(100);

            expect((await pythPriceFeed.slot())[0]).equal(100n);
            expect((await pythPriceFeed.slot())[1]).equal(100n);

            await expect(
                pythPriceFeed.connect(notOwner).setPriceX96s(
                    [
                        {
                            market: ETHMarket,
                            priceX96: maxETHPriceX96,
                        },
                        {
                            market: BTCMarket,
                            priceX96: minBTCPriceX96,
                        },
                    ],
                    latestBlockTimestamp,
                ),
            ).revertedWithCustomError(pythPriceFeed, "Forbidden");
            await expect(
                pythPriceFeed
                    .connect(notOwner)
                    .setPythAssetId(
                        "0x0000000000000000000000000000000000000003",
                        "0x5de33a9112c2b700b8d30b8a3402c103578ccfa2765696471cc672bd5cf6ac52",
                    ),
            ).revertedWithCustomError(pythPriceFeed, "Forbidden");

            await expect(
                pythPriceFeed.connect(notOwner).setUpdater("0x0000000000000000000000000000000000000003", true),
            ).revertedWithCustomError(pythPriceFeed, "Forbidden");

            await expect(
                pythPriceFeed
                    .connect(notOwner)
                    .setReferencePriceAdjustmentMagnification("0x0000000000000000000000000000000000000003", 100),
            ).revertedWithCustomError(pythPriceFeed, "Forbidden");

            await expect(pythPriceFeed.connect(notOwner).setValidTimePeriod(100)).revertedWithCustomError(
                pythPriceFeed,
                "Forbidden",
            );

            await expect(pythPriceFeed.connect(notOwner).setMaxDeviationRatio(100)).revertedWithCustomError(
                pythPriceFeed,
                "Forbidden",
            );
        });
    });
});
