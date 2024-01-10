import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {expect} from "chai";
import {ethers} from "hardhat";
import {SIDE_LONG, SIDE_SHORT} from "./shared/Constants";

describe("OrderBook", function () {
    async function deployFixture() {
        const [owner, otherAccount1, otherAccount2] = await ethers.getSigners();
        const ERC20Test = await ethers.getContractFactory("ERC20Test");
        const USD = await ERC20Test.connect(otherAccount1).deploy("USD", "USD", 6, 100_000_000n);
        const ETH = await ERC20Test.connect(otherAccount1).deploy("ETH", "ETH", 18, 100_000_000n);
        await USD.waitForDeployment();
        await ETH.waitForDeployment();

        const router = await ethers.deployContract("MockRouter");
        await router.waitForDeployment();

        // a bad router that will drain the gas
        const gasRouter = await ethers.deployContract("GasDrainingMockRouter");
        await gasRouter.waitForDeployment();

        const marketManager = await ethers.deployContract("MockMarketManager");

        const OrderBook = await ethers.getContractFactory("OrderBook");
        const orderBook = await OrderBook.deploy(USD.target, router.target, marketManager.target, 3000);
        await orderBook.waitForDeployment();

        const orderBookWithBadRouter = await OrderBook.deploy(USD.target, gasRouter.target, marketManager.target, 3000);
        await orderBookWithBadRouter.waitForDeployment();

        await USD.connect(otherAccount1).approve(router.target, 100_000_000n);
        await USD.connect(otherAccount1).approve(gasRouter.target, 100_000_000n);

        const RevertedFeeReceiver = await ethers.getContractFactory("RevertedFeeReceiver");
        const revertedFeeReceiver = await RevertedFeeReceiver.deploy();
        await revertedFeeReceiver.waitForDeployment();

        const marketDescriptorDeployer = await ethers.deployContract("MarketDescriptorDeployer");
        await marketDescriptorDeployer.waitForDeployment();
        await marketDescriptorDeployer.deploy(await ETH.symbol());
        const market = await marketDescriptorDeployer.descriptors(await ETH.symbol());

        return {
            orderBook,
            orderBookWithBadRouter,
            owner,
            otherAccount1,
            otherAccount2,
            USD,
            ETH,
            router,
            marketManager,
            market,
            revertedFeeReceiver,
        };
    }

    describe("#updateMinExecutionFee", async () => {
        it("should revert with 'Forbidden' if caller is not gov", async () => {
            const {orderBook, otherAccount1} = await loadFixture(deployFixture);
            await expect(orderBook.connect(otherAccount1).updateMinExecutionFee(3000n)).to.be.revertedWithCustomError(
                orderBook,
                "Forbidden",
            );
        });

        it("should emit correct event and update params", async () => {
            const {orderBook} = await loadFixture(deployFixture);
            await expect(orderBook.updateMinExecutionFee(3000n))
                .to.emit(orderBook, "MinExecutionFeeUpdated")
                .withArgs(3000n);
            expect(await orderBook.minExecutionFee()).to.eq(3000n);
        });
    });

    describe("#updateOrderExecutor", async () => {
        it("should revert with 'Forbidden' if caller is not gov", async () => {
            const {otherAccount1, orderBook} = await loadFixture(deployFixture);
            await expect(
                orderBook.connect(otherAccount1).updateOrderExecutor(otherAccount1.address, true),
            ).to.be.revertedWithCustomError(orderBook, "Forbidden");
        });

        it("should emit correct event and update param", async () => {
            const {orderBook, otherAccount1} = await loadFixture(deployFixture);

            await expect(orderBook.updateOrderExecutor(otherAccount1.address, true))
                .to.emit(orderBook, "OrderExecutorUpdated")
                .withArgs(otherAccount1.address, true);
            expect(await orderBook.orderExecutors(otherAccount1.address)).to.eq(true);

            await expect(orderBook.updateOrderExecutor(otherAccount1.address, false))
                .to.emit(orderBook, "OrderExecutorUpdated")
                .withArgs(otherAccount1.address, false);
            expect(await orderBook.orderExecutors(otherAccount1.address)).to.eq(false);
        });
    });

    describe("#updateExecutionGasLimit", async () => {
        it("should revert with 'Forbidden' if caller is not gov", async () => {
            const {otherAccount1, orderBook} = await loadFixture(deployFixture);
            await expect(
                orderBook.connect(otherAccount1).updateExecutionGasLimit(2000000n),
            ).to.be.revertedWithCustomError(orderBook, "Forbidden");
        });

        it("should emit correct event and update param", async () => {
            const {orderBook} = await loadFixture(deployFixture);
            await orderBook.updateExecutionGasLimit(2000000n);
            expect(await orderBook.executionGasLimit()).to.eq(2000000n);
        });
    });

    describe("#createIncreaseOrder", async () => {
        it("should revert if insufficient execution fee", async () => {
            const {orderBook, market, otherAccount1} = await loadFixture(deployFixture);
            // executionFee is insufficient
            await expect(
                orderBook.connect(otherAccount1).createIncreaseOrder(market, SIDE_LONG, 100n, 1n, 1000n, true, 1100n, {
                    value: 2000,
                }),
            )
                .to.be.revertedWithCustomError(orderBook, "InsufficientExecutionFee")
                .withArgs(2000n, 3000n);
        });

        it("should pass", async () => {
            const {orderBook, market, otherAccount1, USD} = await loadFixture(deployFixture);
            let side = SIDE_LONG;
            for (let i = 0; i < 10; i++) {
                const tx = orderBook
                    .connect(otherAccount1)
                    .createIncreaseOrder(market, side, 100n, 100n, 1000n, true, 1100n, {
                        value: 3000,
                    });
                await expect(tx).to.changeEtherBalances([orderBook, otherAccount1], ["3000", "-3000"]);
                await expect(tx).to.changeTokenBalances(USD, [otherAccount1, orderBook], ["-100", "100"]);
                await expect(tx)
                    .to.emit(orderBook, "IncreaseOrderCreated")
                    .withArgs(otherAccount1.address, market, side, 100n, 100n, 1000n, true, 1100n, 3000n, i);

                expect(await orderBook.ordersIndexNext()).to.eq(i + 1);
                expect(await orderBook.increaseOrders(i)).to.deep.eq([
                    otherAccount1.address,
                    market,
                    side,
                    100n,
                    100n,
                    1000n,
                    true,
                    1100n,
                    3000n,
                ]);
                side = (side % 2) + 1;
            }
            expect(await orderBook.ordersIndexNext()).eq(10);
        });
    });

    describe("#updateIncreaseOrder", async () => {
        it("should revert with 'Forbidden' if caller is not request owner", async () => {
            const {orderBook, market, otherAccount1} = await loadFixture(deployFixture);

            await orderBook
                .connect(otherAccount1)
                .createIncreaseOrder(market, SIDE_LONG, 100n, 100n, 1000n, true, 1100n, {
                    value: 3000,
                });

            await expect(orderBook.updateIncreaseOrder(0n, 2n, 2n)).to.be.revertedWithCustomError(
                orderBook,
                "Forbidden",
            );
        });

        it("should pass", async () => {
            const {orderBook, market, otherAccount1} = await loadFixture(deployFixture);
            await orderBook
                .connect(otherAccount1)
                .createIncreaseOrder(market, SIDE_LONG, 100n, 100n, 1000n, true, 1100n, {
                    value: 3000,
                });
            await expect(orderBook.connect(otherAccount1).updateIncreaseOrder(0n, 1200n, 1300n))
                .to.emit(orderBook, "IncreaseOrderUpdated")
                .withArgs(0n, 1200n, 1300n);
            let order = await orderBook.increaseOrders(0n);
            expect(order.triggerMarketPriceX96).eq(1200n);
            expect(order.acceptableTradePriceX96).eq(1300n);
        });
    });

    describe("#cancelIncreaseOrder", async () => {
        it("should revert with 'Forbidden' if caller is not request owner", async () => {
            const {orderBook, market, owner, otherAccount1} = await loadFixture(deployFixture);
            await orderBook
                .connect(otherAccount1)
                .createIncreaseOrder(market, SIDE_LONG, 100n, 100n, 1000n, true, 1100n, {value: 3000});
            await expect(orderBook.cancelIncreaseOrder(0n, owner.address)).to.be.revertedWithCustomError(
                orderBook,
                "Forbidden",
            );
        });
        it("should pass", async () => {
            const {orderBook, market, USD, otherAccount1} = await loadFixture(deployFixture);
            await orderBook
                .connect(otherAccount1)
                .createIncreaseOrder(market, SIDE_LONG, 100n, 100n, 1000n, true, 1100n, {value: 3000});
            const tx = orderBook.connect(otherAccount1).cancelIncreaseOrder(0n, otherAccount1.address);
            await expect(tx).to.changeEtherBalances([orderBook, otherAccount1], ["-3000", "3000"]);
            await expect(tx).to.changeTokenBalances(USD, [orderBook, otherAccount1], ["-100", "100"]);
            await expect(tx).to.emit(orderBook, "IncreaseOrderCancelled").withArgs(0n, otherAccount1.address);
        });
    });

    describe("#executeIncreaseOrder", async () => {
        it("should revert with 'Forbidden' if caller is not order executor", async () => {
            const {owner, orderBook, market, otherAccount1} = await loadFixture(deployFixture);
            await orderBook
                .connect(otherAccount1)
                .createIncreaseOrder(market, SIDE_LONG, 100n, 100n, 1000n, true, 1100n, {
                    value: 3000,
                });
            await expect(orderBook.executeIncreaseOrder(0n, owner.address)).to.be.revertedWithCustomError(
                orderBook,
                "Forbidden",
            );
        });

        it("should revert if price is not met", async () => {
            const {owner, orderBook, marketManager, market, otherAccount1} = await loadFixture(deployFixture);
            // 1900n for long, 1800n for short
            await marketManager.setMarketPriceX96(1900n, 1800n);
            // short: use min price
            // triggerAbove: true
            // triggerPrice: 1850
            // should not trigger as 1800 < 1850
            await orderBook
                .connect(otherAccount1)
                .createIncreaseOrder(market, SIDE_SHORT, 100n, 100n, 1850n, true, 1850n, {
                    value: 3000,
                });
            await orderBook.updateOrderExecutor(owner.address, true);
            await expect(orderBook.executeIncreaseOrder(0n, owner.address))
                .to.be.revertedWithCustomError(orderBook, "InvalidMarketPriceToTrigger")
                .withArgs(1800n, 1850n);

            // long: use max price
            // triggerAbove: false
            // triggerPrice: 1850
            // should not trigger as 1900 > 1850
            await orderBook
                .connect(otherAccount1)
                .createIncreaseOrder(market, SIDE_LONG, 100n, 100n, 1850n, false, 1850n, {
                    value: 3000,
                });
            await expect(orderBook.executeIncreaseOrder(1n, owner.address))
                .to.be.revertedWithCustomError(orderBook, "InvalidMarketPriceToTrigger")
                .withArgs(1900n, 1850n);
        });

        it("should revert if trade price is not met", async () => {
            const {owner, orderBook, marketManager, market, otherAccount1, router} = await loadFixture(deployFixture);
            await orderBook.updateOrderExecutor(owner.address, true);
            // short when price is higher
            await orderBook
                .connect(otherAccount1)
                .createIncreaseOrder(market, SIDE_SHORT, 100n, 100n, 1850n, true, 1840n, {
                    value: 3000,
                });
            await marketManager.setMarketPriceX96(1849n, 1851n);
            await router.setTradePriceX96(1830n);
            await expect(orderBook.executeIncreaseOrder(0n, owner.address))
                .to.be.revertedWithCustomError(orderBook, "InvalidTradePrice")
                .withArgs(1830n, 1840n);

            // long when price is lower
            await orderBook
                .connect(otherAccount1)
                .createIncreaseOrder(market, SIDE_LONG, 100n, 100n, 1850n, false, 1860n, {
                    value: 3000,
                });
            await router.setTradePriceX96(1870n);
            await expect(orderBook.executeIncreaseOrder(1n, owner.address))
                .to.be.revertedWithCustomError(orderBook, "InvalidTradePrice")
                .withArgs(1870n, 1860n);
        });

        it("should revert if market is malformed and will drain all sent gas", async () => {
            const {owner, marketManager, market, otherAccount1, orderBookWithBadRouter} =
                await loadFixture(deployFixture);
            await orderBookWithBadRouter.updateOrderExecutor(owner.address, true);
            await marketManager.setMarketPriceX96(1900n, 1800n);
            // short when price is higher
            await orderBookWithBadRouter
                .connect(otherAccount1)
                .createIncreaseOrder(market, SIDE_SHORT, 100n, 100n, 1901n, false, 1920n, {
                    value: 3000,
                });
            // gas drained
            await expect(orderBookWithBadRouter.executeIncreaseOrder(0n, owner.address)).to.be.revertedWithoutReason();
        });

        it("should pass", async () => {
            const {orderBook, marketManager, market, owner, otherAccount1, USD, router} =
                await loadFixture(deployFixture);
            await orderBook.updateOrderExecutor(owner.address, true);
            await marketManager.setMarketPriceX96(1900n, 1800n);

            // long: use max price(1900)
            // triggerAbove: false
            // triggerPrice: 1901
            // acceptableTradePrice: 1920
            // should trigger
            // expect pass
            await orderBook
                .connect(otherAccount1)
                .createIncreaseOrder(market, SIDE_LONG, 100n, 100n, 1901n, false, 1920n, {
                    value: 3000,
                });

            await router.setTradePriceX96(1910n);
            const tx = orderBook.executeIncreaseOrder(0n, owner.address);
            await expect(tx).to.changeEtherBalances([orderBook, owner], ["-3000", "3000"]);
            await expect(tx).to.changeTokenBalances(USD, [orderBook, marketManager], ["-100", "100"]);
            await expect(tx).to.emit(orderBook, "IncreaseOrderExecuted").withArgs(0n, 1900n, owner.address);

            let order = await orderBook.increaseOrders(0n);
            expect(order.account).eq(ethers.ZeroAddress);
        });
    });

    describe("#createDecreaseOrder", async () => {
        it("should revert if insufficient or incorrect execution fee", async () => {
            const {orderBook, market, otherAccount1} = await loadFixture(deployFixture);
            // executionFee is insufficient
            await expect(
                orderBook
                    .connect(otherAccount1)
                    .createDecreaseOrder(market, SIDE_LONG, 100n, 100n, 1000n, true, 1000n, otherAccount1.address, {
                        value: 2000,
                    }),
            ).to.be.revertedWithCustomError(orderBook, "InsufficientExecutionFee");
        });

        it("should pass", async () => {
            const {orderBook, market, otherAccount1} = await loadFixture(deployFixture);
            let side = SIDE_LONG;
            for (let i = 0; i < 10; i++) {
                const tx = orderBook
                    .connect(otherAccount1)
                    .createDecreaseOrder(market, side, 100n, 100n, 1000n, true, 1000n, otherAccount1.address, {
                        value: 3000,
                    });
                await expect(tx).to.changeEtherBalances([orderBook, otherAccount1], ["3000", "-3000"]);
                await expect(tx)
                    .to.emit(orderBook, "DecreaseOrderCreated")
                    .withArgs(
                        otherAccount1.address,
                        market,
                        side,
                        100n,
                        100n,
                        1000n,
                        true,
                        1000n,
                        otherAccount1.address,
                        3000n,
                        i,
                    );

                expect(await orderBook.ordersIndexNext()).to.eq(i + 1);
                expect(await orderBook.decreaseOrders(i)).to.deep.eq([
                    otherAccount1.address,
                    market,
                    side,
                    100n,
                    100n,
                    1000n,
                    true,
                    1000n,
                    otherAccount1.address,
                    3000n,
                ]);
                side = (side % 2) + 1;
            }
            expect(await orderBook.ordersIndexNext()).eq(10);
        });
    });

    describe("#updateDecreaseOrder", async () => {
        it("should revert with 'Forbidden' if sender is not request owner", async () => {
            const {orderBook, market, otherAccount1} = await loadFixture(deployFixture);
            await orderBook
                .connect(otherAccount1)
                .createDecreaseOrder(market, SIDE_LONG, 100n, 100n, 1000n, true, 1000n, otherAccount1.address, {
                    value: 3000,
                });
            await expect(orderBook.updateDecreaseOrder(0n, 2000n, 300n)).to.be.revertedWithCustomError(
                orderBook,
                "Forbidden",
            );
        });

        it("should pass", async () => {
            const {orderBook, market, otherAccount1} = await loadFixture(deployFixture);
            await orderBook
                .connect(otherAccount1)
                .createDecreaseOrder(market, SIDE_LONG, 100n, 100n, 1000n, true, 1000n, otherAccount1.address, {
                    value: 3000,
                });
            await expect(orderBook.connect(otherAccount1).updateDecreaseOrder(0n, 2000n, 3000n))
                .to.emit(orderBook, "DecreaseOrderUpdated")
                .withArgs(0n, 2000n, 3000n);
            let order = await orderBook.decreaseOrders(0n);
            expect(order.triggerMarketPriceX96).eq(2000n);
            expect(order.acceptableTradePriceX96).eq(3000n);
        });
    });

    describe("#cancelDecreaseOrder", async () => {
        it("should revert with 'Forbidden' if caller is not request owner nor order executor", async () => {
            const {orderBook, market, otherAccount1, otherAccount2} = await loadFixture(deployFixture);
            await orderBook
                .connect(otherAccount1)
                .createDecreaseOrder(market, SIDE_LONG, 100n, 100n, 1000n, true, 1000n, otherAccount1.address, {
                    value: 3000,
                });
            await expect(
                orderBook.connect(otherAccount2).cancelDecreaseOrder(0n, otherAccount2.address),
            ).to.be.revertedWithCustomError(orderBook, "Forbidden");
        });

        it("should revert if order not exists", async () => {
            const {orderBook, otherAccount1} = await loadFixture(deployFixture);
            await expect(orderBook.cancelDecreaseOrder(0n, otherAccount1.address))
                .to.be.revertedWithCustomError(orderBook, "OrderNotExists")
                .withArgs(0n);
        });

        it("should pass", async () => {
            const {orderBook, market, otherAccount1, owner} = await loadFixture(deployFixture);
            await orderBook
                .connect(otherAccount1)
                .createDecreaseOrder(market, SIDE_LONG, 100n, 100n, 1000n, true, 1000n, otherAccount1.address, {
                    value: 3000,
                });
            const tx = orderBook.connect(otherAccount1).cancelDecreaseOrder(0n, otherAccount1.address);
            await expect(tx).to.changeEtherBalances([orderBook, otherAccount1], ["-3000", "3000"]);
            await expect(tx).to.emit(orderBook, "DecreaseOrderCancelled").withArgs(0n, otherAccount1.address);
            let order = await orderBook.decreaseOrders(0n);
            expect(order.account).to.eq(ethers.ZeroAddress);

            await orderBook
                .connect(otherAccount1)
                .createDecreaseOrder(market, SIDE_LONG, 100n, 100n, 1000n, true, 1000n, otherAccount1.address, {
                    value: 3000,
                });
            // executor is now able to cancel orders
            expect(await orderBook.updateOrderExecutor(owner.address, true));

            const tx2 = orderBook.cancelDecreaseOrder(1n, owner.address);
            await expect(tx2).to.changeEtherBalances([orderBook, owner], ["-3000", "3000"]);
            await expect(tx2).to.emit(orderBook, "DecreaseOrderCancelled").withArgs(1n, owner.address);
            order = await orderBook.decreaseOrders(1n);
            expect(order.account).to.eq(ethers.ZeroAddress);
        });
    });

    describe("#executeDecreaseOrder", async () => {
        it("should revert if trigger price is not met", async () => {
            const {orderBook, marketManager, market, owner, otherAccount1} = await loadFixture(deployFixture);
            expect(await orderBook.updateOrderExecutor(owner.address, true));
            // 1. long, take-profit order
            await orderBook
                .connect(otherAccount1)
                .createDecreaseOrder(market, SIDE_LONG, 100n, 100n, 1950n, true, 1950n, otherAccount1.address, {
                    value: 3000,
                });
            // expect not trigger since 1900n < 1950n
            await marketManager.setMarketPriceX96(2000n, 1900n);
            await expect(orderBook.executeDecreaseOrder(0n, owner.address))
                .to.be.revertedWithCustomError(orderBook, "InvalidMarketPriceToTrigger")
                .withArgs(1900n, 1950n);

            // 2. long, stop-loss order
            await orderBook
                .connect(otherAccount1)
                .createDecreaseOrder(market, SIDE_LONG, 100n, 100n, 1850n, false, 1850n, otherAccount1.address, {
                    value: 3000,
                });
            await marketManager.setMarketPriceX96(2000n, 1900n);
            await expect(orderBook.executeDecreaseOrder(1n, owner.address))
                .to.be.revertedWithCustomError(orderBook, "InvalidMarketPriceToTrigger")
                .withArgs(1900n, 1850n);

            // 3. short, take-profit order
            await orderBook
                .connect(otherAccount1)
                .createDecreaseOrder(market, SIDE_SHORT, 100n, 100n, 1950n, false, 1950n, otherAccount1.address, {
                    value: 3000,
                });
            await marketManager.setMarketPriceX96(2000n, 1900n);
            // expect not trigger since 2000n > 1950n
            await expect(orderBook.executeDecreaseOrder(2n, owner.address))
                .to.be.revertedWithCustomError(orderBook, "InvalidMarketPriceToTrigger")
                .withArgs(2000n, 1950n);

            // 4. short, stop-loss order
            await orderBook
                .connect(otherAccount1)
                .createDecreaseOrder(market, SIDE_SHORT, 100n, 100n, 2200n, true, 2200n, otherAccount1.address, {
                    value: 3000,
                });
            // 1930n < 2200n, should not trigger
            await marketManager.setMarketPriceX96(1930n, 1920n);
            await expect(orderBook.executeDecreaseOrder(3n, owner.address))
                .to.be.revertedWithCustomError(orderBook, "InvalidMarketPriceToTrigger")
                .withArgs(1930n, 2200n);
        });

        it("should revert if trade price is not met", async () => {
            const {orderBook, marketManager, market, owner, otherAccount1, router} = await loadFixture(deployFixture);
            expect(await orderBook.updateOrderExecutor(owner.address, true));
            // 1. long, take-profit order
            await orderBook
                .connect(otherAccount1)
                .createDecreaseOrder(market, SIDE_LONG, 100n, 100n, 1950n, true, 1940n, otherAccount1.address, {
                    value: 3000,
                });
            // 1960 > 1950, trigger
            await marketManager.setMarketPriceX96(1980n, 1960n);
            // Minimum acceptable trade price is 1940, but actual is 1930, should revert
            await router.setTradePriceX96(1930n);
            await expect(orderBook.executeDecreaseOrder(0n, owner.address))
                .to.be.revertedWithCustomError(orderBook, "InvalidTradePrice")
                .withArgs(1930n, 1940n);
            await router.setTradePriceX96(1945n);
            const tx = orderBook.executeDecreaseOrder(0n, owner.address);
            await expect(tx).to.changeEtherBalances([orderBook, owner], ["-3000", "3000"]);
            await expect(tx).to.emit(orderBook, "DecreaseOrderExecuted").withArgs(0n, 1960n, owner.address);

            // 2. long, stop-loss order
            await orderBook
                .connect(otherAccount1)
                .createDecreaseOrder(market, SIDE_LONG, 100n, 100n, 1850n, false, 1840n, otherAccount1.address, {
                    value: 3000,
                });
            // 1840 < 1850, trigger
            await marketManager.setMarketPriceX96(2000n, 1840n);
            // Minimum acceptable trade price is 1840, but actual is 1830, revert
            await router.setTradePriceX96(1830n);
            await expect(orderBook.executeDecreaseOrder(1n, owner.address))
                .to.be.revertedWithCustomError(orderBook, "InvalidTradePrice")
                .withArgs(1830n, 1840n);
            await router.setTradePriceX96(1845n);
            const tx2 = orderBook.executeDecreaseOrder(1n, owner.address);
            await expect(tx2).to.changeEtherBalances([orderBook, owner], ["-3000", "3000"]);
            await expect(tx2).to.emit(orderBook, "DecreaseOrderExecuted").withArgs(1n, 1840n, owner.address);

            // 3. short, take-profit order
            await orderBook
                .connect(otherAccount1)
                .createDecreaseOrder(market, SIDE_SHORT, 100n, 100n, 1950n, false, 1960n, otherAccount1.address, {
                    value: 3000,
                });
            // 1940 < 1950, trigger
            await marketManager.setMarketPriceX96(1940n, 1930n);
            await router.setTradePriceX96(1970n);
            await expect(orderBook.executeDecreaseOrder(2n, owner.address))
                .to.be.revertedWithCustomError(orderBook, "InvalidTradePrice")
                .withArgs(1970n, 1960n);

            await router.setTradePriceX96(1955n);
            const tx3 = orderBook.executeDecreaseOrder(2n, owner.address);
            await expect(tx3).to.changeEtherBalances([orderBook, owner], ["-3000", "3000"]);
            await expect(tx3).to.emit(orderBook, "DecreaseOrderExecuted").withArgs(2n, 1940n, owner.address);

            // 4. short, stop-loss order
            await orderBook
                .connect(otherAccount1)
                .createDecreaseOrder(market, SIDE_SHORT, 100n, 100n, 2200n, true, 2250n, otherAccount1.address, {
                    value: 3000,
                });
            // 2300 > 2200, trigger
            await marketManager.setMarketPriceX96(2300n, 2000n);
            await router.setTradePriceX96(2300n);
            await expect(orderBook.executeDecreaseOrder(3n, owner.address))
                .to.be.revertedWithCustomError(orderBook, "InvalidTradePrice")
                .withArgs(2300n, 2250n);

            await router.setTradePriceX96(2240n);
            const tx4 = orderBook.executeDecreaseOrder(3n, owner.address);
            await expect(tx4).to.changeEtherBalances([orderBook, owner], ["-3000", "3000"]);
            await expect(tx4).to.emit(orderBook, "DecreaseOrderExecuted").withArgs(3n, 2300n, owner.address);
        });
    });

    describe("#createTakeProfitAndStopLossOrders", async () => {
        it("should revert if execution fee is invalid", async () => {
            const {orderBook, market, owner} = await loadFixture(deployFixture);
            // fee0 is insufficient
            await expect(
                orderBook.createTakeProfitAndStopLossOrders(
                    market,
                    SIDE_LONG,
                    [2000n, 2000n],
                    [2000n, 2000n],
                    [2000n, 2000n],
                    [2000n, 2000n],
                    owner.address,
                    {value: 5000n},
                ),
            )
                .to.be.revertedWithCustomError(orderBook, "InsufficientExecutionFee")
                .withArgs(2500n, 3000n);

            await expect(
                orderBook.createTakeProfitAndStopLossOrders(
                    market,
                    SIDE_LONG,
                    [2000n, 2000n],
                    [2000n, 2000n],
                    [2000n, 2000n],
                    [2000n, 2000n],
                    owner.address,
                    {value: 5001n},
                ),
            )
                .to.be.revertedWithCustomError(orderBook, "InsufficientExecutionFee")
                .withArgs(2500n, 3000n);

            await expect(
                orderBook.createTakeProfitAndStopLossOrders(
                    market,
                    SIDE_LONG,
                    [2000n, 2000n],
                    [2000n, 2000n],
                    [2000n, 2000n],
                    [2000n, 2000n],
                    owner.address,
                    {value: 5003n},
                ),
            )
                .to.be.revertedWithCustomError(orderBook, "InsufficientExecutionFee")
                .withArgs(2501n, 3000n);
            await expect(
                orderBook.createTakeProfitAndStopLossOrders(
                    market,
                    SIDE_LONG,
                    [2000n, 2000n],
                    [2000n, 2000n],
                    [2000n, 2000n],
                    [2000n, 2000n],
                    owner.address,
                    {value: 1n},
                ),
            )
                .to.be.revertedWithCustomError(orderBook, "InsufficientExecutionFee")
                .withArgs(0n, 3000n);
        });

        it("should pass", async () => {
            const {orderBook, market, otherAccount1} = await loadFixture(deployFixture);

            for (let i = 0; i < 10; i++) {
                const tx = orderBook
                    .connect(otherAccount1)
                    .createTakeProfitAndStopLossOrders(
                        market,
                        SIDE_LONG,
                        [2000n, 2500n],
                        [2000n, 2500n],
                        [2000n, 2500n],
                        [2000n, 2500n],
                        otherAccount1.address,
                        {value: 6000n},
                    );
                await expect(tx).to.changeEtherBalances([orderBook, otherAccount1], ["6000", "-6000"]);
                await expect(tx)
                    .to.emit(orderBook, "DecreaseOrderCreated")
                    .withArgs(
                        otherAccount1.address,
                        market,
                        SIDE_LONG,
                        2000n,
                        2000n,
                        2000n,
                        true,
                        2000n,
                        otherAccount1.address,
                        3000n,
                        2 * i,
                    )
                    .to.emit(orderBook, "DecreaseOrderCreated")
                    .withArgs(
                        otherAccount1.address,
                        market,
                        SIDE_LONG,
                        2500n,
                        2500n,
                        2500n,
                        false,
                        2500n,
                        otherAccount1.address,
                        3000n,
                        2 * i + 1,
                    );

                expect(await orderBook.ordersIndexNext()).to.eq(2 * i + 2);

                expect(await orderBook.decreaseOrders(2 * i)).to.deep.eq([
                    otherAccount1.address,
                    market,
                    SIDE_LONG,
                    2000n,
                    2000n,
                    2000n,
                    true,
                    2000n,
                    otherAccount1.address,
                    3000n,
                ]);

                expect(await orderBook.decreaseOrders(2 * i + 1)).to.deep.eq([
                    otherAccount1.address,
                    market,
                    SIDE_LONG,
                    2500n,
                    2500n,
                    2500n,
                    false,
                    2500n,
                    otherAccount1.address,
                    3000n,
                ]);
            }

            expect(await orderBook.ordersIndexNext()).eq(20n);
        });
    });

    describe("#cancelIncreaseOrdersBatch", async () => {
        it("should revert if order not exists", async () => {
            const {orderBook} = await loadFixture(deployFixture);
            await expect(orderBook.cancelIncreaseOrdersBatch([0n]))
                .to.be.revertedWithCustomError(orderBook, "OrderNotExists")
                .withArgs(0n);
        });

        it("should revert with 'Forbidden' if caller is not request owner", async () => {
            const {orderBook, market, otherAccount1} = await loadFixture(deployFixture);
            await orderBook
                .connect(otherAccount1)
                .createIncreaseOrder(market, SIDE_LONG, 100n, 100n, 1000n, true, 1100n, {value: 3000});
            await expect(orderBook.cancelIncreaseOrdersBatch([0n])).to.be.revertedWithCustomError(
                orderBook,
                "Forbidden",
            );
        });

        it("should pass", async () => {
            const {orderBook, market, USD, otherAccount1} = await loadFixture(deployFixture);
            await orderBook
                .connect(otherAccount1)
                .createIncreaseOrder(market, SIDE_LONG, 100n, 100n, 1000n, true, 1100n, {value: 3000});
            await orderBook
                .connect(otherAccount1)
                .createIncreaseOrder(market, SIDE_LONG, 200n, 200n, 2000n, true, 2100n, {value: 3000});
            const tx = orderBook.connect(otherAccount1).cancelIncreaseOrdersBatch([0n, 1n]);
            await expect(tx).to.changeEtherBalances([orderBook, otherAccount1], ["-6000", "6000"]);
            await expect(tx).to.changeTokenBalances(USD, [orderBook, otherAccount1], ["-300", "300"]);
            await expect(tx).to.emit(orderBook, "IncreaseOrderCancelled").withArgs(0n, otherAccount1.address);
            expect((await orderBook.increaseOrders(0n)).account).to.eq(ethers.ZeroAddress);
            expect((await orderBook.increaseOrders(1n)).account).to.eq(ethers.ZeroAddress);
        });
    });

    describe("#cancelDecreaseOrdersBatch", async () => {
        it("should revert if order not exists", async () => {
            const {orderBook} = await loadFixture(deployFixture);
            await expect(orderBook.cancelDecreaseOrdersBatch([0n]))
                .to.be.revertedWithCustomError(orderBook, "OrderNotExists")
                .withArgs(0n);
        });

        it("should revert with 'Forbidden' if caller is not request owner nor order executor", async () => {
            const {orderBook, market, otherAccount1} = await loadFixture(deployFixture);
            await orderBook
                .connect(otherAccount1)
                .createDecreaseOrder(market, SIDE_LONG, 100n, 100n, 1000n, true, 1000n, otherAccount1.address, {
                    value: 3000,
                });
            await expect(orderBook.cancelDecreaseOrdersBatch([0n])).to.be.revertedWithCustomError(
                orderBook,
                "Forbidden",
            );
        });

        it("should pass", async () => {
            const {orderBook, market, USD, otherAccount1} = await loadFixture(deployFixture);
            await orderBook
                .connect(otherAccount1)
                .createDecreaseOrder(market, SIDE_LONG, 100n, 100n, 1000n, true, 1000n, otherAccount1.address, {
                    value: 3000,
                });
            await orderBook
                .connect(otherAccount1)
                .createDecreaseOrder(market, SIDE_LONG, 200n, 200n, 2000n, true, 2000n, otherAccount1.address, {
                    value: 3000,
                });
            const tx = orderBook.connect(otherAccount1).cancelDecreaseOrdersBatch([0n, 1n]);
            await expect(tx).to.changeEtherBalances([orderBook, otherAccount1], ["-6000", "6000"]);
            await expect(tx).to.emit(orderBook, "DecreaseOrderCancelled").withArgs(0n, otherAccount1.address);
            expect((await orderBook.decreaseOrders(0n)).account).to.eq(ethers.ZeroAddress);
            expect((await orderBook.decreaseOrders(1n)).account).to.eq(ethers.ZeroAddress);
        });
    });

    describe("#cancelOrdersBatch", async () => {
        it("should revert if order not exists", async () => {
            const {orderBook} = await loadFixture(deployFixture);
            await expect(orderBook.cancelOrdersBatch([0n], [1n]))
                .to.be.revertedWithCustomError(orderBook, "OrderNotExists")
                .withArgs(0n);
        });

        it("should revert with 'Forbidden' if caller is not request owner nor order executor", async () => {
            const {orderBook, market, otherAccount1} = await loadFixture(deployFixture);
            await orderBook
                .connect(otherAccount1)
                .createIncreaseOrder(market, SIDE_LONG, 100n, 100n, 1000n, true, 1000n, {
                    value: 3000,
                });
            await orderBook
                .connect(otherAccount1)
                .createDecreaseOrder(market, SIDE_LONG, 200n, 200n, 2000n, true, 2000n, otherAccount1.address, {
                    value: 3000,
                });
            await expect(orderBook.cancelOrdersBatch([0n], [1n])).to.be.revertedWithCustomError(orderBook, "Forbidden");
        });

        it("should pass", async () => {
            const {orderBook, market, USD, otherAccount1} = await loadFixture(deployFixture);
            await orderBook
                .connect(otherAccount1)
                .createIncreaseOrder(market, SIDE_LONG, 100n, 100n, 1000n, true, 1000n, {
                    value: 3000,
                });
            await orderBook
                .connect(otherAccount1)
                .createIncreaseOrder(market, SIDE_SHORT, 200n, 200n, 2000n, true, 2000n, {value: 3000});
            await orderBook
                .connect(otherAccount1)
                .createIncreaseOrder(market, SIDE_LONG, 300n, 300n, 3000n, true, 3100n, {value: 3000});
            await orderBook
                .connect(otherAccount1)
                .createDecreaseOrder(market, SIDE_SHORT, 500n, 500n, 5000n, true, 2000n, otherAccount1.address, {
                    value: 3000,
                });
            const tx = orderBook.connect(otherAccount1).cancelOrdersBatch([0n, 1n, 2n], [3n]);
            await expect(tx).to.changeEtherBalances([orderBook, otherAccount1], ["-12000", "12000"]);
            await expect(tx).to.changeTokenBalances(USD, [orderBook, otherAccount1], ["-600", "600"]);
            await expect(tx)
                .to.emit(orderBook, "IncreaseOrderCancelled")
                .withArgs(0n, otherAccount1.address)
                .to.emit(orderBook, "IncreaseOrderCancelled")
                .withArgs(1n, otherAccount1.address)
                .to.emit(orderBook, "IncreaseOrderCancelled")
                .withArgs(2n, otherAccount1.address)
                .to.emit(orderBook, "DecreaseOrderCancelled")
                .withArgs(3n, otherAccount1.address);
        });
    });
});
