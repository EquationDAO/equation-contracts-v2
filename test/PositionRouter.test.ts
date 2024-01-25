import {loadFixture, mine, time} from "@nomicfoundation/hardhat-network-helpers";
import {expect} from "chai";
import {ethers} from "hardhat";

import {SIDE_LONG, SIDE_SHORT} from "./shared/Constants";

describe("PositionRouter", function () {
    const defaultMinExecutionFee = 3000;

    async function deployFixture() {
        const [owner, otherAccount1, otherAccount2] = await ethers.getSigners();
        const ERC20Test = await ethers.getContractFactory("ERC20Test");
        const USD = await ERC20Test.connect(otherAccount1).deploy("USD", "USD", 6, 100_000_000n);
        const BTC = await ERC20Test.connect(otherAccount1).deploy("Bitcoin", "BTC", 18, 100_000_000);
        const ETH = await ERC20Test.connect(otherAccount1).deploy("ETHER", "ETH", 18, 100_000_000);
        await USD.waitForDeployment();
        await BTC.waitForDeployment();
        await ETH.waitForDeployment();

        const Router = await ethers.getContractFactory("MockRouter");
        const router = await Router.deploy();
        await router.waitForDeployment();

        const GasRouter = await ethers.getContractFactory("GasDrainingMockRouter");
        const gasRouter = await GasRouter.deploy();
        await gasRouter.waitForDeployment();

        const marketManager = await ethers.deployContract("MockMarketManager");

        // router can transfer owner's USD
        await USD.connect(otherAccount1).approve(router.target, 100_000_000n);
        await USD.connect(otherAccount1).approve(gasRouter.target, 100_000_000n);

        const PositionRouter = await ethers.getContractFactory("PositionRouter");
        const positionRouter = await PositionRouter.deploy(
            USD.target,
            router.target,
            marketManager.target,
            defaultMinExecutionFee,
        );
        await positionRouter.waitForDeployment();

        const positionRouterWithBadRouter = await PositionRouter.deploy(
            USD.target,
            gasRouter.target,
            marketManager.target,
            defaultMinExecutionFee,
        );
        await positionRouterWithBadRouter.waitForDeployment();

        const RevertedFeeReceiver = await ethers.getContractFactory("RevertedFeeReceiver");
        const revertedFeeReceiver = await RevertedFeeReceiver.deploy();
        await revertedFeeReceiver.waitForDeployment();

        const marketDescriptorDeployer = await ethers.deployContract("MarketDescriptorDeployer");
        await marketDescriptorDeployer.waitForDeployment();
        await marketDescriptorDeployer.deploy(await ETH.symbol());
        const market = await marketDescriptorDeployer.descriptors(await ETH.symbol());
        await marketDescriptorDeployer.deploy(await BTC.symbol());
        const market2 = await marketDescriptorDeployer.descriptors(await BTC.symbol());

        return {
            owner,
            otherAccount1,
            otherAccount2,
            router,
            positionRouter,
            positionRouterWithBadRouter,
            USD,
            ETH,
            marketManager,
            market,
            market2,
            revertedFeeReceiver,
        };
    }

    describe("#updatePositionExecutor", async () => {
        it("should revert with 'Forbidden' if caller is not gov", async () => {
            const {otherAccount1, positionRouter} = await loadFixture(deployFixture);
            await expect(
                positionRouter.connect(otherAccount1).updatePositionExecutor(otherAccount1.address, true),
            ).to.be.revertedWithCustomError(positionRouter, "Forbidden");
        });

        it("should emit correct event and update param", async () => {
            const {positionRouter, otherAccount1} = await loadFixture(deployFixture);

            await expect(positionRouter.updatePositionExecutor(otherAccount1.address, true))
                .to.emit(positionRouter, "PositionExecutorUpdated")
                .withArgs(otherAccount1.address, true);
            expect(await positionRouter.positionExecutors(otherAccount1.address)).to.eq(true);

            await expect(positionRouter.updatePositionExecutor(otherAccount1.address, false))
                .to.emit(positionRouter, "PositionExecutorUpdated")
                .withArgs(otherAccount1.address, false);
            expect(await positionRouter.positionExecutors(otherAccount1.address)).to.eq(false);
        });
    });

    describe("#updateDelayValues", async () => {
        it("should revert with 'Forbidden' if caller is not gov", async () => {
            const {otherAccount1, positionRouter} = await loadFixture(deployFixture);
            await expect(
                positionRouter.connect(otherAccount1).updateDelayValues(0n, 0n, 0n),
            ).to.be.revertedWithCustomError(positionRouter, "Forbidden");
        });

        it("should emit correct event and update param", async () => {
            const {positionRouter} = await loadFixture(deployFixture);
            await expect(positionRouter.updateDelayValues(10n, 20n, 30n))
                .to.emit(positionRouter, "DelayValuesUpdated")
                .withArgs(10n, 20n, 30n);
            expect(await positionRouter.minBlockDelayExecutor()).to.eq(10n);
            expect(await positionRouter.minTimeDelayPublic()).to.eq(20n);
            expect(await positionRouter.maxTimeDelay()).to.eq(30n);
        });
    });

    describe("#updateMinExecutionFee", async () => {
        it("should revert with 'Forbidden' if caller is not gov", async () => {
            const {otherAccount1, positionRouter} = await loadFixture(deployFixture);
            await expect(
                positionRouter.connect(otherAccount1).updateMinExecutionFee(3000n),
            ).to.be.revertedWithCustomError(positionRouter, "Forbidden");
        });

        it("should emit correct event and update params", async () => {
            const {positionRouter} = await loadFixture(deployFixture);
            await expect(positionRouter.updateMinExecutionFee(3000n))
                .to.emit(positionRouter, "MinExecutionFeeUpdated")
                .withArgs(3000n);
            expect(await positionRouter.minExecutionFee()).to.eq(3000n);
        });
    });

    describe("#updateExecutionGasLimit", async () => {
        it("should revert with 'Forbidden' if caller is not gov", async () => {
            const {otherAccount1, positionRouter} = await loadFixture(deployFixture);
            await expect(
                positionRouter.connect(otherAccount1).updateExecutionGasLimit(2000000n),
            ).to.be.revertedWithCustomError(positionRouter, "Forbidden");
        });

        it("should update param", async () => {
            const {positionRouter, otherAccount1} = await loadFixture(deployFixture);

            await positionRouter.updateExecutionGasLimit(2000000n);
            expect(await positionRouter.executionGasLimit()).to.eq(2000000n);
        });
    });

    describe("IncreaseLiquidityPosition", async () => {
        describe("#createIncreaseLiquidityPosition", async () => {
            it("should transfer correct execution fee to position router", async () => {
                const {positionRouter, market, otherAccount1} = await loadFixture(deployFixture);
                // insufficient execution fee
                await expect(
                    positionRouter
                        .connect(otherAccount1)
                        .createIncreaseLiquidityPosition(market, 10n, 100n, 10n, {value: 0}),
                )
                    .to.be.revertedWithCustomError(positionRouter, "InsufficientExecutionFee")
                    .withArgs(0n, 3000n);
            });

            it("should pass", async () => {
                const {positionRouter, USD, market, otherAccount1} = await loadFixture(deployFixture);
                for (let i = 0; i < 10; i++) {
                    const tx = await positionRouter
                        .connect(otherAccount1)
                        .createIncreaseLiquidityPosition(market, 100n, 1000n, 100n, {
                            value: 3000,
                        });
                    await expect(tx).to.changeEtherBalance(positionRouter, "3000");
                    await expect(tx).to.changeTokenBalance(USD, positionRouter, "100");
                    await expect(tx)
                        .to.emit(positionRouter, "IncreaseLiquidityPositionCreated")
                        .withArgs(otherAccount1.address, market, 100n, 1000n, 100n, 3000n, i);

                    expect(await positionRouter.increaseLiquidityPositionIndexNext()).to.eq(i + 1);
                    expect(await positionRouter.increaseLiquidityPositionRequests(i)).to.deep.eq([
                        otherAccount1.address,
                        market,
                        100n,
                        1000n,
                        100n,
                        3000n,
                        await time.latestBlock(),
                        await time.latest(),
                    ]);
                }
                expect(await positionRouter.increaseLiquidityPositionIndex()).to.eq(0n);
            });
        });

        describe("#cancelIncreaseLiquidityPosition", async () => {
            describe("shouldCancel/shouldExecuteOrCancel", async () => {
                it("should revert if caller is not request owner nor executor", async () => {
                    const {positionRouter, market, otherAccount1, owner} = await loadFixture(deployFixture);
                    // create a new request
                    await positionRouter
                        .connect(otherAccount1)
                        .createIncreaseLiquidityPosition(market, 100n, 1000n, 100n, {
                            value: 3000,
                        });

                    await expect(
                        positionRouter.cancelIncreaseLiquidityPosition(0n, owner.address),
                    ).to.be.revertedWithCustomError(positionRouter, "Forbidden");
                });

                it("should wait at least minBlockDelayExecutor until executors can cancel", async () => {
                    const {positionRouter, market, otherAccount1, otherAccount2} = await loadFixture(deployFixture);
                    // account2 is now executor
                    await positionRouter.updatePositionExecutor(otherAccount2.address, true);
                    // executor has to wait 10 blocks
                    await positionRouter.updateDelayValues(10n, 3000n, 6000n);
                    // create a new request
                    await positionRouter
                        .connect(otherAccount1)
                        .createIncreaseLiquidityPosition(market, 100n, 1000n, 100n, {
                            value: 3000,
                        });

                    // should fail to cancel
                    await positionRouter
                        .connect(otherAccount2)
                        .cancelIncreaseLiquidityPosition(0n, otherAccount2.address);
                    let [account] = await positionRouter.increaseLiquidityPositionRequests(0n);
                    expect(account).eq(otherAccount1.address);

                    // mine 10 blocks
                    await mine(10);

                    // should be cancelled
                    await positionRouter
                        .connect(otherAccount2)
                        .cancelIncreaseLiquidityPosition(0n, otherAccount2.address);
                    [account] = await positionRouter.increaseLiquidityPositionRequests(0n);
                    expect(account).eq(ethers.ZeroAddress);
                });

                it("should wait at least minTimeDelayPublic until public can cancel", async () => {
                    const {positionRouter, market, otherAccount1} = await loadFixture(deployFixture);
                    // public has to wait 3m
                    await expect(positionRouter.updateDelayValues(10n, 180n, 6000n)).not.to.be.reverted;
                    // create a new request
                    await positionRouter
                        .connect(otherAccount1)
                        .createIncreaseLiquidityPosition(market, 100n, 1000n, 100n, {
                            value: 3000,
                        });
                    const earliest = (await time.latest()) + 180;
                    await expect(
                        positionRouter
                            .connect(otherAccount1)
                            .cancelIncreaseLiquidityPosition(0n, otherAccount1.address),
                    )
                        .to.be.revertedWithCustomError(positionRouter, "TooEarly")
                        .withArgs(earliest);

                    // increase 3m
                    await time.increase(180n);

                    let [account] = await positionRouter.increaseLiquidityPositionRequests(0n);
                    expect(account).eq(otherAccount1.address);
                    await positionRouter
                        .connect(otherAccount1)
                        .cancelIncreaseLiquidityPosition(0n, otherAccount1.address);
                    [account] = await positionRouter.increaseLiquidityPositionRequests(0n);
                    expect(account).eq(ethers.ZeroAddress);
                });
            });

            it("should pass if request not exist", async () => {
                const {owner, positionRouter} = await loadFixture(deployFixture);
                await positionRouter.cancelIncreasePosition(1000n, owner.address);
            });

            it("should revert with 'Forbidden' if caller is not request owner", async () => {
                const {positionRouter, otherAccount1, otherAccount2, market} = await loadFixture(deployFixture);
                await positionRouter.connect(otherAccount1).createIncreaseLiquidityPosition(market, 100n, 1000n, 100n, {
                    value: 3000,
                });
                // _positionID 1 owner is `0x0`
                await expect(
                    positionRouter.connect(otherAccount2).cancelIncreaseLiquidityPosition(0n, otherAccount1.address),
                ).to.be.revertedWithCustomError(positionRouter, "Forbidden");
            });

            it("should be ok if executor cancel", async () => {
                const {positionRouter, market, USD, otherAccount1, otherAccount2} = await loadFixture(deployFixture);
                await positionRouter.connect(otherAccount1).createIncreaseLiquidityPosition(market, 100n, 1000n, 100n, {
                    value: 3000,
                });
                await positionRouter.updatePositionExecutor(otherAccount2.address, true);
                const tx = positionRouter
                    .connect(otherAccount2)
                    .cancelIncreaseLiquidityPosition(0n, otherAccount2.address);
                await expect(tx).to.changeEtherBalances([positionRouter, otherAccount2], ["-3000", "3000"]);
                await expect(tx).to.changeTokenBalances(USD, [positionRouter, otherAccount1], ["-100", "100"]);
                await expect(tx)
                    .to.emit(positionRouter, "IncreaseLiquidityPositionCancelled")
                    .withArgs(0n, otherAccount2.address);
                // validation
                let [account] = await positionRouter.increaseLiquidityPositionRequests(0n);
                expect(account).eq(ethers.ZeroAddress);
            });

            it("should be ok if request owner calls", async () => {
                const {positionRouter, market, USD, otherAccount1} = await loadFixture(deployFixture);
                await positionRouter.connect(otherAccount1).createIncreaseLiquidityPosition(market, 100n, 1000n, 100n, {
                    value: 3000,
                });
                await time.increase(180);
                const tx = positionRouter
                    .connect(otherAccount1)
                    .cancelIncreaseLiquidityPosition(0n, otherAccount1.address);
                await expect(tx).to.changeEtherBalances([positionRouter, otherAccount1], ["-3000", "3000"]);
                await expect(tx).to.changeTokenBalances(USD, [positionRouter, otherAccount1], ["-100", "100"]);
                await expect(tx)
                    .to.emit(positionRouter, "IncreaseLiquidityPositionCancelled")
                    .withArgs(0n, otherAccount1.address);
                // validation
                let [account] = await positionRouter.increaseLiquidityPositionRequests(0n);
                expect(account).eq(ethers.ZeroAddress);
            });
        });

        describe("#executeIncreaseLiquidityPosition", async () => {
            it("should pass if request is not exist", async () => {
                const {owner, positionRouter} = await loadFixture(deployFixture);
                await positionRouter.executeIncreaseLiquidityPosition(1000n, owner.address);
            });

            it("should revert with 'Forbidden' if caller is not executor nor request owner", async () => {
                const {owner, otherAccount1, otherAccount2, market, positionRouter} = await loadFixture(deployFixture);
                await positionRouter.connect(otherAccount1).createIncreaseLiquidityPosition(market, 100n, 1000n, 100n, {
                    value: 3000,
                });
                await positionRouter.updateDelayValues(0n, 0n, 600n);
                await expect(
                    positionRouter.connect(otherAccount2).executeIncreaseLiquidityPosition(0n, owner.address),
                ).to.be.revertedWithCustomError(positionRouter, "Forbidden");
            });

            it("should revert with 'Expired' if maxTimeDelay passed", async () => {
                const {positionRouter, market, otherAccount1, otherAccount2} = await loadFixture(deployFixture);
                await positionRouter.connect(otherAccount1).createIncreaseLiquidityPosition(market, 100n, 1000n, 100n, {
                    value: 3000,
                });
                const positionBlockTs = await time.latest();
                await positionRouter.updatePositionExecutor(otherAccount2.address, true);
                await positionRouter.updateDelayValues(0n, 0n, 600n);
                const expiredAt = positionBlockTs + 600;
                await time.increase(600n);
                await expect(
                    positionRouter.connect(otherAccount2).executeIncreaseLiquidityPosition(0n, otherAccount2.address),
                )
                    .to.be.revertedWithCustomError(positionRouter, "Expired")
                    .withArgs(expiredAt);
            });

            it("should revert with 'InvalidMargin' if marginAfter is less than acceptableMinMargin", async () => {
                const {positionRouter, market, otherAccount1, otherAccount2} = await loadFixture(deployFixture);
                await positionRouter.connect(otherAccount1).createIncreaseLiquidityPosition(market, 200n, 1000n, 200n, {
                    value: 3000,
                });
                // set a delay value to prevent expire
                await positionRouter.updateDelayValues(0n, 0n, 600n);
                await positionRouter.updatePositionExecutor(otherAccount2.address, true);
                const tx = positionRouter
                    .connect(otherAccount2)
                    .executeIncreaseLiquidityPosition(0n, otherAccount2.address);
                await expect(tx).to.be.revertedWithCustomError(positionRouter, "InvalidMargin").withArgs(100n, 200n);
            });

            it("should revert with 'TooEarly' if someone who are not the executor executes his own request and pass if sufficient time elapsed", async () => {
                const {positionRouter, market, USD, otherAccount1} = await loadFixture(deployFixture);
                await positionRouter.connect(otherAccount1).createIncreaseLiquidityPosition(market, 100n, 1000n, 100n, {
                    value: 3000,
                });
                const current = await time.latest();
                await expect(
                    positionRouter.connect(otherAccount1).executeIncreaseLiquidityPosition(0n, otherAccount1.address),
                )
                    .to.revertedWithCustomError(positionRouter, "TooEarly")
                    .withArgs(current + 180);
                await time.setNextBlockTimestamp(current + 180);
                await expect(
                    positionRouter.connect(otherAccount1).executeIncreaseLiquidityPosition(0n, otherAccount1.address),
                ).not.to.be.reverted;
            });

            it("should emit event and distribute funds", async () => {
                const {positionRouter, market, marketManager, USD, otherAccount1, otherAccount2} =
                    await loadFixture(deployFixture);
                await positionRouter.connect(otherAccount1).createIncreaseLiquidityPosition(market, 100n, 1000n, 100n, {
                    value: 3000,
                });
                // set a delay value to prevent expire
                await positionRouter.updateDelayValues(0n, 0n, 600n);
                await positionRouter.updatePositionExecutor(otherAccount2.address, true);
                const tx = positionRouter
                    .connect(otherAccount2)
                    .executeIncreaseLiquidityPosition(0n, otherAccount2.address);
                await expect(tx).to.changeEtherBalances([positionRouter, otherAccount2], ["-3000", "3000"]);
                await expect(tx).to.changeTokenBalances(USD, [positionRouter, marketManager], ["-100", "100"]);
                await expect(tx)
                    .to.emit(positionRouter, "IncreaseLiquidityPositionExecuted")
                    .withArgs(0n, otherAccount2.address);
                // delete request
                let [account] = await positionRouter.increaseLiquidityPositionRequests(0n);
                expect(account).eq(ethers.ZeroAddress);
            });
        });
    });

    describe("DecreaseLiquidityPosition", async () => {
        describe("#createDecreaseLiquidityPosition", async () => {
            it("should transfer correct execution fee to position router", async () => {
                const {positionRouter, market, otherAccount1} = await loadFixture(deployFixture);
                // insufficient execution fee
                await expect(
                    positionRouter
                        .connect(otherAccount1)
                        .createDecreaseLiquidityPosition(market, 10n, 100n, 10n, otherAccount1, {value: 0}),
                )
                    .to.be.revertedWithCustomError(positionRouter, "InsufficientExecutionFee")
                    .withArgs(0n, 3000n);
            });

            it("should pass", async () => {
                const {positionRouter, market, otherAccount1} = await loadFixture(deployFixture);
                for (let i = 0; i < 10; i++) {
                    await expect(
                        positionRouter
                            .connect(otherAccount1)
                            .createDecreaseLiquidityPosition(market, 10n, 100n, 10n, otherAccount1.address, {
                                value: 3000,
                            }),
                    )
                        .to.emit(positionRouter, "DecreaseLiquidityPositionCreated")
                        .withArgs(otherAccount1.address, market, 10n, 100n, 10n, otherAccount1.address, 3000n, i);
                    expect(await positionRouter.decreaseLiquidityPositionIndexNext()).to.eq(i + 1);
                    expect(await positionRouter.decreaseLiquidityPositionRequests(i)).to.deep.eq([
                        otherAccount1.address,
                        market,
                        10n,
                        100n,
                        10n,
                        3000n,
                        await time.latestBlock(),
                        await time.latest(),
                        otherAccount1.address,
                    ]);
                }
                expect(await positionRouter.increaseLiquidityPositionIndex()).to.eq(0n);
            });
        });

        describe("#cancelDecreaseLiquidityPosition", async () => {
            it("should pass if request not exist", async () => {
                const {owner, positionRouter} = await loadFixture(deployFixture);
                await positionRouter.cancelDecreaseLiquidityPosition(1000n, owner.address);
            });

            it("should revert with 'Forbidden' if caller is not executor nor request owner", async () => {
                const {positionRouter, market, otherAccount1, otherAccount2} = await loadFixture(deployFixture);
                await positionRouter
                    .connect(otherAccount1)
                    .createDecreaseLiquidityPosition(market, 100n, 1000n, 100n, otherAccount1.address, {value: 3000n});
                await time.increase(180);
                await expect(
                    positionRouter.connect(otherAccount2).cancelDecreaseLiquidityPosition(0n, otherAccount2.address),
                ).to.be.revertedWithCustomError(positionRouter, "Forbidden");
                // request owner should be able to cancel
                await positionRouter.connect(otherAccount1).cancelDecreaseLiquidityPosition(0n, otherAccount1.address);
            });

            it("should emit event and refund", async () => {
                const {positionRouter, market, otherAccount1, otherAccount2} = await loadFixture(deployFixture);
                await positionRouter
                    .connect(otherAccount1)
                    .createDecreaseLiquidityPosition(market, 100n, 1000n, 100n, otherAccount1.address, {
                        value: 3000,
                    });

                await positionRouter.updatePositionExecutor(otherAccount2.address, true);

                const tx = positionRouter
                    .connect(otherAccount2)
                    .cancelDecreaseLiquidityPosition(0n, otherAccount2.address);
                await expect(tx).to.changeEtherBalances([positionRouter, otherAccount2], ["-3000", "3000"]);
                await expect(tx)
                    .to.emit(positionRouter, "DecreaseLiquidityPositionCancelled")
                    .withArgs(0n, otherAccount2.address);

                // validation
                let [account] = await positionRouter.decreaseLiquidityPositionRequests(0n);
                expect(account).eq(ethers.ZeroAddress);
            });
        });

        describe("#executeDecreaseLiquidityPosition", async () => {
            it("should pass if request not exist", async () => {
                const {owner, positionRouter} = await loadFixture(deployFixture);
                await positionRouter.executeDecreaseLiquidityPosition(1000n, owner.address);
            });

            it("should revert with 'Forbidden' if caller is not executor nor request owner", async () => {
                const {positionRouter, market, otherAccount1, otherAccount2} = await loadFixture(deployFixture);
                await positionRouter
                    .connect(otherAccount1)
                    .createDecreaseLiquidityPosition(market, 100n, 1000n, 100n, otherAccount1.address, {
                        value: 3000,
                    });
                await positionRouter.updateDelayValues(0n, 0n, 600n);
                await expect(
                    positionRouter.connect(otherAccount2).executeDecreaseLiquidityPosition(0n, otherAccount2.address),
                ).to.be.revertedWithCustomError(positionRouter, "Forbidden");
            });

            it("should revert with 'TooEarly' if someone who are not the executor executes his own request and pass if sufficient time elapsed", async () => {
                const {positionRouter, market, otherAccount1, otherAccount2} = await loadFixture(deployFixture);
                await positionRouter
                    .connect(otherAccount1)
                    .createDecreaseLiquidityPosition(market, 100n, 1000n, 100n, otherAccount1.address, {
                        value: 3000,
                    });
                const current = await time.latest();
                await expect(
                    positionRouter.connect(otherAccount1).executeDecreaseLiquidityPosition(0n, otherAccount1.address),
                )
                    .to.be.revertedWithCustomError(positionRouter, "TooEarly")
                    .withArgs(current + 180);
                await time.setNextBlockTimestamp(current + 180);
                await expect(
                    positionRouter.connect(otherAccount1).executeDecreaseLiquidityPosition(0n, otherAccount1.address),
                ).not.to.be.reverted;
            });

            it("should emit event and transfer execution fee", async () => {
                const {positionRouter, market, otherAccount1, otherAccount2} = await loadFixture(deployFixture);
                await positionRouter
                    .connect(otherAccount1)
                    .createDecreaseLiquidityPosition(market, 100n, 1000n, 100n, otherAccount1.address, {
                        value: 3000,
                    });

                // set a delay value to prevent expire
                await positionRouter.updateDelayValues(0n, 0n, 600n);
                await positionRouter.updatePositionExecutor(otherAccount2.address, true);

                const tx = positionRouter
                    .connect(otherAccount2)
                    .executeDecreaseLiquidityPosition(0n, otherAccount2.address);
                await expect(tx).to.changeEtherBalances([positionRouter, otherAccount2], ["-3000", "3000"]);
                await expect(tx)
                    .to.emit(positionRouter, "DecreaseLiquidityPositionExecuted")
                    .withArgs(0n, otherAccount2.address);
                // delete request
                let [account] = await positionRouter.decreaseLiquidityPositionRequests(0n);
                expect(account).eq(ethers.ZeroAddress);
            });
        });
    });

    describe("IncreasePosition", async () => {
        describe("#createIncreasePosition", async () => {
            it("should transfer correct execution fee to position router", async () => {
                const {positionRouter, market, otherAccount1} = await loadFixture(deployFixture);
                // insufficient execution fee
                await expect(
                    positionRouter.connect(otherAccount1).createIncreasePosition(market, SIDE_LONG, 100n, 100n, 100n, {
                        value: 1000,
                    }),
                )
                    .to.be.revertedWithCustomError(positionRouter, "InsufficientExecutionFee")
                    .withArgs(1000n, 3000n);
            });

            it("should pass", async () => {
                const {positionRouter, market, USD, otherAccount1} = await loadFixture(deployFixture);
                for (let i = 0; i < 10; i++) {
                    const tx = positionRouter
                        .connect(otherAccount1)
                        .createIncreasePosition(market, SIDE_LONG, 100n, 100n, 100n, {
                            value: 3000,
                        });
                    await expect(tx).to.changeEtherBalance(positionRouter, "3000");
                    await expect(tx).to.changeTokenBalance(USD, positionRouter, "100");
                    await expect(tx)
                        .to.emit(positionRouter, "IncreasePositionCreated")
                        .withArgs(otherAccount1.address, market, SIDE_LONG, 100n, 100n, 100n, 3000n, i);
                    expect(await positionRouter.increasePositionIndexNext()).to.eq(i + 1);
                    expect(await positionRouter.increasePositionRequests(i)).to.deep.eq([
                        otherAccount1.address,
                        market,
                        SIDE_LONG,
                        100n,
                        100n,
                        100n,
                        3000n,
                        await time.latestBlock(),
                        await time.latest(),
                    ]);
                }
                expect(await positionRouter.increasePositionIndex()).to.eq(0n);
            });
        });

        describe("#cancelIncreasePosition", async () => {
            it("should pass if request not exist", async () => {
                const {owner, positionRouter} = await loadFixture(deployFixture);
                await positionRouter.cancelIncreasePosition(1000n, owner.address);
            });

            it("should revert with 'Forbidden' if caller is not executor nor request owner", async () => {
                const {otherAccount1, otherAccount2, market, positionRouter} = await loadFixture(deployFixture);
                await positionRouter
                    .connect(otherAccount1)
                    .createIncreasePosition(market, SIDE_LONG, 100n, 100n, 100n, {
                        value: 3000,
                    });
                await expect(
                    positionRouter.connect(otherAccount2).cancelIncreasePosition(0n, otherAccount2.address),
                ).to.be.revertedWithCustomError(positionRouter, "Forbidden");
            });
        });

        describe("#executeIncreasePosition", async () => {
            it("should return true if request not exist", async () => {
                const {owner, positionRouter} = await loadFixture(deployFixture);
                await positionRouter.executeIncreasePosition(1000n, owner.address);
            });

            it("should revert with 'InvalidTradePrice' if trade price is not met", async () => {
                const {positionRouter, router, market, marketManager, otherAccount1, USD} =
                    await loadFixture(deployFixture);
                await positionRouter.updateDelayValues(0n, 0n, 600n);

                await positionRouter
                    .connect(otherAccount1)
                    .createIncreasePosition(market, SIDE_LONG, 100n, 100n, 1900n, {
                        value: 3000,
                    });

                await router.setTradePriceX96(1910n);

                await expect(positionRouter.connect(otherAccount1).executeIncreasePosition(0n, otherAccount1.address))
                    .to.be.revertedWithCustomError(positionRouter, "InvalidTradePrice")
                    .withArgs(1910n, 1900n);

                await router.setTradePriceX96(1890);

                {
                    const tx = positionRouter.connect(otherAccount1).executeIncreasePosition(0n, otherAccount1.address);
                    await expect(tx).to.changeEtherBalances([positionRouter, otherAccount1], ["-3000", "3000"]);
                    await expect(tx).to.changeTokenBalances(USD, [positionRouter, marketManager], ["-100", "100"]);
                    await expect(tx)
                        .to.emit(positionRouter, "IncreasePositionExecuted")
                        .withArgs(0n, otherAccount1.address);
                }

                await positionRouter
                    .connect(otherAccount1)
                    .createIncreasePosition(market, SIDE_SHORT, 100n, 100n, 1790n, {
                        value: 3000,
                    });
                await router.setTradePriceX96(1750n);
                await expect(positionRouter.connect(otherAccount1).executeIncreasePosition(1n, otherAccount1.address))
                    .to.be.revertedWithCustomError(positionRouter, "InvalidTradePrice")
                    .withArgs(1750n, 1790n);
                await router.setTradePriceX96(1795n);

                {
                    const tx = positionRouter.connect(otherAccount1).executeIncreasePosition(1n, otherAccount1.address);
                    await expect(tx).to.changeEtherBalances([positionRouter, otherAccount1], ["-3000", "3000"]);
                    await expect(tx).to.changeTokenBalances(USD, [positionRouter, marketManager], ["-100", "100"]);
                    await expect(tx)
                        .to.emit(positionRouter, "IncreasePositionExecuted")
                        .withArgs(1n, otherAccount1.address);
                }
            });

            it("should not revert if acceptable trade price is zero", async () => {
                const {positionRouter, router, market, otherAccount1} = await loadFixture(deployFixture);
                await positionRouter.updateDelayValues(0n, 0n, 600n);
                await positionRouter.connect(otherAccount1).createIncreasePosition(market, SIDE_SHORT, 100n, 100n, 0n, {
                    value: 3000,
                });
                // trade price is very low for increasing short position, but still
                // expected to not revert
                await router.setTradePriceX96(1n);
                await expect(positionRouter.connect(otherAccount1).executeIncreasePosition(0n, otherAccount1.address))
                    .not.to.be.reverted;
            });

            it("should revert with 'TooEarly' if someone who are not the executor executes his own request and pass if sufficient time elapsed", async () => {
                const {positionRouter, market, router, otherAccount1} = await loadFixture(deployFixture);
                await positionRouter.connect(otherAccount1).createIncreasePosition(market, SIDE_SHORT, 100n, 100n, 0n, {
                    value: 3000,
                });
                const current = await time.latest();
                const earliest = (await time.latest()) + 180;
                await router.setTradePriceX96(1n);
                await time.setNextBlockTimestamp(current + 179);
                await expect(positionRouter.connect(otherAccount1).executeIncreasePosition(0n, otherAccount1.address))
                    .to.be.revertedWithCustomError(positionRouter, "TooEarly")
                    .withArgs(earliest);

                await time.setNextBlockTimestamp(current + 180);
                await expect(positionRouter.connect(otherAccount1).executeIncreasePosition(0n, otherAccount1.address))
                    .not.to.be.reverted;
            });
        });
    });

    describe("DecreasePosition", async () => {
        describe("#createDecreasePosition", async () => {
            it("should transfer correct execution fee to position router", async () => {
                const {positionRouter, market, otherAccount1} = await loadFixture(deployFixture);

                // insufficient execution fee
                await expect(
                    positionRouter
                        .connect(otherAccount1)
                        .createDecreasePosition(market, SIDE_LONG, 100n, 100n, 1800n, otherAccount1.address, {
                            value: 2000,
                        }),
                )
                    .to.be.revertedWithCustomError(positionRouter, "InsufficientExecutionFee")
                    .withArgs(2000n, 3000n);
            });

            it("should pass", async () => {
                const {positionRouter, market, otherAccount1} = await loadFixture(deployFixture);
                for (let i = 0; i < 10; i++) {
                    const tx = positionRouter
                        .connect(otherAccount1)
                        .createDecreasePosition(market, SIDE_LONG, 100n, 100n, 1800n, otherAccount1.address, {
                            value: 3000,
                        });
                    await expect(tx).to.changeEtherBalance(positionRouter, "3000");
                    await expect(tx)
                        .to.emit(positionRouter, "DecreasePositionCreated")
                        .withArgs(
                            otherAccount1.address,
                            market,
                            SIDE_LONG,
                            100n,
                            100n,
                            1800n,
                            otherAccount1.address,
                            3000n,
                            i,
                        );
                    expect(await positionRouter.decreasePositionIndexNext()).to.eq(i + 1);
                    expect(await positionRouter.decreasePositionRequests(i)).to.deep.eq([
                        otherAccount1.address,
                        market,
                        SIDE_LONG,
                        100n,
                        100n,
                        1800n,
                        3000n,
                        await time.latestBlock(),
                        await time.latest(),
                        otherAccount1.address,
                    ]);
                }
                expect(await positionRouter.decreasePositionIndex()).to.eq(0n);
            });
        });

        describe("#cancelDecreasePosition", async () => {
            it("should pass if request not exist", async () => {
                const {owner, positionRouter} = await loadFixture(deployFixture);
                await positionRouter.cancelDecreasePosition(1000n, owner.address);
            });

            it("should revert with 'Forbidden' if caller is not executor nor request owner", async () => {
                const {otherAccount1, otherAccount2, market, positionRouter} = await loadFixture(deployFixture);
                await positionRouter
                    .connect(otherAccount1)
                    .createDecreasePosition(market, SIDE_LONG, 1000n, 1000n, 1800n, otherAccount1.address, {
                        value: 3000,
                    });
                await expect(
                    positionRouter.connect(otherAccount2).cancelDecreasePosition(0n, otherAccount2.address),
                ).to.be.revertedWithCustomError(positionRouter, "Forbidden");
            });
        });

        describe("#executeDecreasePosition", async () => {
            it("should return true if request not exist", async () => {
                const {owner, positionRouter} = await loadFixture(deployFixture);
                await positionRouter.executeDecreasePosition(1000n, owner.address);
            });

            it("should revert with 'InvalidTradePrice' if trade price is not met", async () => {
                const {positionRouter, market, marketManager, otherAccount1, router} = await loadFixture(deployFixture);
                await positionRouter.updateDelayValues(0n, 0n, 600n);

                // decrease long, use min price,
                await positionRouter
                    .connect(otherAccount1)
                    .createDecreasePosition(market, SIDE_LONG, 100n, 100n, 1790n, otherAccount1.address, {
                        value: 3000,
                    });
                await marketManager.setMarketPriceX96(1800n, 1800n);
                await router.setTradePriceX96(1780n);
                await expect(positionRouter.connect(otherAccount1).executeDecreasePosition(0n, otherAccount1.address))
                    .to.be.revertedWithCustomError(positionRouter, "InvalidTradePrice")
                    .withArgs(1780n, 1790n);
                await router.setTradePriceX96(1795n);
                {
                    const tx = positionRouter.connect(otherAccount1).executeDecreasePosition(0n, otherAccount1.address);
                    await expect(tx).to.changeEtherBalances([positionRouter, otherAccount1], ["-3000", "3000"]);
                    await expect(tx)
                        .to.emit(positionRouter, "DecreasePositionExecuted")
                        .withArgs(0n, otherAccount1.address);
                }

                // short, use max price
                await positionRouter
                    .connect(otherAccount1)
                    .createDecreasePosition(market, SIDE_SHORT, 100n, 100n, 1820n, otherAccount1.address, {
                        value: 3000,
                    });
                await router.setTradePriceX96(1850n);
                await expect(positionRouter.connect(otherAccount1).executeDecreasePosition(1n, otherAccount1.address))
                    .to.be.revertedWithCustomError(positionRouter, "InvalidTradePrice")
                    .withArgs(1850n, 1820n);
                await router.setTradePriceX96(1810n);
                {
                    const tx = positionRouter.connect(otherAccount1).executeDecreasePosition(1n, otherAccount1.address);
                    await expect(tx).to.changeEtherBalances([positionRouter, otherAccount1], ["-3000", "3000"]);
                    await expect(tx)
                        .to.emit(positionRouter, "DecreasePositionExecuted")
                        .withArgs(1n, otherAccount1.address);
                }
            });

            it("should not revert if acceptable trade price is zero", async () => {
                const {positionRouter, otherAccount1, market, router} = await loadFixture(deployFixture);
                await positionRouter.updateDelayValues(0n, 0n, 600n);
                await positionRouter
                    .connect(otherAccount1)
                    .createDecreasePosition(market, SIDE_LONG, 100n, 100n, 0n, otherAccount1.address, {
                        value: 3000,
                    });
                // trade price is very low for decreasing long position, but still
                // expected to not revert
                await router.setTradePriceX96(1n);
                await expect(positionRouter.connect(otherAccount1).executeDecreasePosition(0n, otherAccount1.address))
                    .not.to.be.reverted;
            });
            it("should revert with 'TooEarly' if someone who are not the executor executes his own request and pass if sufficient time elapsed", async () => {
                const {positionRouter, market, router, otherAccount1} = await loadFixture(deployFixture);
                await positionRouter
                    .connect(otherAccount1)
                    .createDecreasePosition(market, SIDE_SHORT, 100n, 100n, 1820n, otherAccount1.address, {
                        value: 3000,
                    });
                const current = await time.latest();
                await router.setTradePriceX96(1810n);
                await time.setNextBlockTimestamp(current + 179);
                await expect(positionRouter.connect(otherAccount1).executeDecreasePosition(0n, otherAccount1.address))
                    .to.be.revertedWithCustomError(positionRouter, "TooEarly")
                    .withArgs(current + 180);
                await time.setNextBlockTimestamp(current + 180);
                await expect(positionRouter.connect(otherAccount1).executeDecreasePosition(0n, otherAccount1.address))
                    .not.to.be.reverted;
            });
        });
    });

    describe("#executeIncreaseLiquidityPositions", async () => {
        it("should revert with 'Forbidden' if caller is not executor", async () => {
            const {owner, positionRouter} = await loadFixture(deployFixture);
            await expect(
                positionRouter.executeIncreaseLiquidityPositions(100n, owner.address),
            ).to.be.revertedWithCustomError(positionRouter, "Forbidden");
        });
        it("should cancel request if expired", async () => {
            const {owner, positionRouter, market, otherAccount1} = await loadFixture(deployFixture);

            await positionRouter.updateDelayValues(0, 0, 180);
            await positionRouter.connect(otherAccount1).createIncreaseLiquidityPosition(market, 100n, 1000n, 100n, {
                value: 3000,
            });

            await time.increase(180);
            await positionRouter.updatePositionExecutor(owner.address, true);

            const tx = positionRouter.executeIncreaseLiquidityPositions(1n, owner.address);
            await expect(tx).to.emit(positionRouter, "ExecuteFailed").withArgs(0, 0, "0xf80dbaea");
            await expect(tx).to.changeEtherBalances([positionRouter, owner], ["-3000", "3000"]);
            await expect(tx).to.emit(positionRouter, "IncreaseLiquidityPositionCancelled").withArgs(0, owner.address);

            let [account] = await positionRouter.increaseLiquidityPositionRequests(0n);
            expect(account).eq(ethers.ZeroAddress);
            expect(await positionRouter.increaseLiquidityPositionIndex()).to.eq(1);
        });

        it("should not execute any requests if minBlockDelayExecutor is not met", async () => {
            const {owner, positionRouter, market, marketManager, otherAccount1, USD} = await loadFixture(deployFixture);
            await positionRouter.updateDelayValues(100, 0, 10000);
            await positionRouter.connect(otherAccount1).createIncreaseLiquidityPosition(market, 100n, 1000n, 100n, {
                value: 3000,
            });

            await mine(50);

            await positionRouter.connect(otherAccount1).createIncreaseLiquidityPosition(market, 100n, 1000n, 100n, {
                value: 3000,
            });

            await positionRouter.updatePositionExecutor(owner.address, true);
            await positionRouter.executeIncreaseLiquidityPositions(2n, owner.address);

            // no request executed
            expect(await positionRouter.increaseLiquidityPositionIndex()).to.eq(0n);
            let [account] = await positionRouter.increaseLiquidityPositionRequests(0n);
            expect(account).eq(otherAccount1.address);

            await mine(50);

            // expect first request executed while second not
            {
                const tx = positionRouter.executeIncreaseLiquidityPositions(2n, owner.address);
                await expect(tx).to.changeEtherBalances([positionRouter, owner], ["-3000", "3000"]);
                await expect(tx).to.changeTokenBalances(USD, [positionRouter, marketManager], ["-100", "100"]);
                await expect(tx)
                    .to.emit(positionRouter, "IncreaseLiquidityPositionExecuted")
                    .withArgs(0n, owner.address);
                expect(await positionRouter.increaseLiquidityPositionIndex()).to.eq(1n);
            }

            // expect send execute
            await mine(50);
            {
                const tx = positionRouter.executeIncreaseLiquidityPositions(2n, owner.address);
                await expect(tx).to.changeEtherBalances([positionRouter, owner], ["-3000", "3000"]);
                await expect(tx).to.changeTokenBalances(USD, [positionRouter, marketManager], ["-100", "100"]);
                await expect(tx)
                    .to.emit(positionRouter, "IncreaseLiquidityPositionExecuted")
                    .withArgs(1n, owner.address);
                expect(await positionRouter.increaseLiquidityPositionIndex()).to.eq(2n);
            }
        });

        it("should cancel if execution reverted and continue to execute", async () => {
            const {owner, positionRouter, market, otherAccount1} = await loadFixture(deployFixture);
            // _maxTimeDelay is 0, execution will revert immediately
            await positionRouter.updateDelayValues(0, 0, 0);

            // all requests should be cancelled because they reverted
            await positionRouter.connect(otherAccount1).createIncreaseLiquidityPosition(market, 100n, 1000n, 100n, {
                value: 3000,
            });
            await positionRouter.connect(otherAccount1).createIncreaseLiquidityPosition(market, 100n, 1000n, 100n, {
                value: 3000,
            });
            await positionRouter.connect(otherAccount1).createIncreaseLiquidityPosition(market, 100n, 1000n, 100n, {
                value: 3000,
            });

            await positionRouter.updatePositionExecutor(owner.address, true);
            const tx = positionRouter.executeIncreaseLiquidityPositions(3n, owner.address);
            await expect(tx)
                .to.emit(positionRouter, "ExecuteFailed").withArgs(0, 0, "0xf80dbaea")
                .to.emit(positionRouter, "IncreaseLiquidityPositionCancelled").withArgs(0n, owner.address)
                .to.emit(positionRouter, "ExecuteFailed").withArgs(0, 1, "0xf80dbaea")
                .to.emit(positionRouter, "IncreaseLiquidityPositionCancelled").withArgs(1n, owner.address)
                .to.emit(positionRouter, "ExecuteFailed").withArgs(0, 2, "0xf80dbaea")
                .to.emit(positionRouter, "IncreaseLiquidityPositionCancelled").withArgs(2n, owner.address);

            expect(await positionRouter.increaseLiquidityPositionIndex()).eq(3n);
        });

        it("should cancel request if execution reverted and continue to execute when pool is malformed which drain gas", async () => {
            const {owner, positionRouter, positionRouterWithBadRouter, market, otherAccount1} =
                await loadFixture(deployFixture);
            await positionRouterWithBadRouter.updateDelayValues(0, 0, 100);
            await positionRouter.updateDelayValues(0, 0, 100);
            await positionRouterWithBadRouter.updateExecutionGasLimit(50000);

            // all requests should be cancelled because they reverted
            await positionRouterWithBadRouter
                .connect(otherAccount1)
                .createIncreaseLiquidityPosition(market, 100n, 1000n, 100n, {
                    value: 3000,
                });

            await positionRouterWithBadRouter
                .connect(otherAccount1)
                .createIncreaseLiquidityPosition(market, 100n, 1000n, 100n, {
                    value: 3000,
                });

            await positionRouterWithBadRouter
                .connect(otherAccount1)
                .createIncreaseLiquidityPosition(market, 100n, 1000n, 100n, {
                    value: 3000,
                });

            await positionRouterWithBadRouter.updatePositionExecutor(owner.address, true);
            await positionRouter.updatePositionExecutor(owner.address, true);

            const tx = positionRouterWithBadRouter.executeIncreaseLiquidityPositions(300n, owner.address);
            await expect(tx)
                .to.emit(positionRouterWithBadRouter, "ExecuteFailed").withArgs(0, 0, "0x00000000")
                .to.emit(positionRouterWithBadRouter, "IncreaseLiquidityPositionCancelled").withArgs(0n, owner.address)
                .to.emit(positionRouterWithBadRouter, "ExecuteFailed").withArgs(0, 1, "0x00000000")
                .to.emit(positionRouterWithBadRouter, "IncreaseLiquidityPositionCancelled").withArgs(1n, owner.address)
                .to.emit(positionRouterWithBadRouter, "ExecuteFailed").withArgs(0, 2, "0x00000000")
                .to.emit(positionRouterWithBadRouter, "IncreaseLiquidityPositionCancelled").withArgs(2n, owner.address);

            expect(await positionRouterWithBadRouter.increaseLiquidityPositionIndex()).eq(3n);

            // as a control, use another position router which has a no-op router to try again
            // the only difference is the router
            // expect to emit executed event
            await positionRouter.connect(otherAccount1).createIncreaseLiquidityPosition(market, 100n, 1000n, 100n, {
                value: 3000,
            });
            await expect(await positionRouter.executeIncreaseLiquidityPositions(3n, owner.address))
                .to.emit(positionRouter, "IncreaseLiquidityPositionExecuted")
                .withArgs(0n, owner.address);
        });

        it("should continue to execute if cancellation reverted", async () => {
            const {owner, positionRouter, market, otherAccount1, revertedFeeReceiver} =
                await loadFixture(deployFixture);
            await positionRouter.updateDelayValues(0, 0, 0);

            await positionRouter.connect(otherAccount1).createIncreaseLiquidityPosition(market, 100n, 1000n, 100n, {
                value: 3000,
            });
            await positionRouter.connect(otherAccount1).createIncreaseLiquidityPosition(market, 100n, 1000n, 100n, {
                value: 3000,
            });

            await positionRouter.updatePositionExecutor(owner.address, true);

            // execution will revert with `Expired`
            // cancellation will revert with `Reverted`
            // expect index still increases
            await positionRouter.executeIncreaseLiquidityPositions(3n, revertedFeeReceiver.target);

            // requests still there
            let [account] = await positionRouter.increaseLiquidityPositionRequests(0n);
            expect(account).eq(otherAccount1.address);

            [account] = await positionRouter.increaseLiquidityPositionRequests(1n);
            expect(account).eq(otherAccount1.address);

            expect(await positionRouter.increaseLiquidityPositionIndex()).eq(2n);
        });
    });

    describe("#executeDecreaseLiquidityPositions", async () => {
        it("should revert with 'Forbidden' if caller is not executor", async () => {
            const {owner, positionRouter} = await loadFixture(deployFixture);
            await expect(
                positionRouter.executeDecreaseLiquidityPositions(100n, owner.address),
            ).to.be.revertedWithCustomError(positionRouter, "Forbidden");
        });
        it("should cancel if execution reverted and continue to execute next", async () => {
            const {owner, positionRouter, market, otherAccount1} = await loadFixture(deployFixture);
            // _maxTimeDelay is 0, execution will revert immediately
            await positionRouter.updateDelayValues(0, 0, 0);

            // all requests should be cancelled because they reverted
            await positionRouter
                .connect(otherAccount1)
                .createDecreaseLiquidityPosition(market, 100n, 1000n, 100n, otherAccount1.address, {
                    value: 3000,
                });
            await positionRouter
                .connect(otherAccount1)
                .createDecreaseLiquidityPosition(market, 100n, 1000n, 100n, otherAccount1.address, {
                    value: 3000,
                });
            await positionRouter
                .connect(otherAccount1)
                .createDecreaseLiquidityPosition(market, 100n, 1000n, 100n, otherAccount1.address, {
                    value: 3000,
                });

            await positionRouter.updatePositionExecutor(owner.address, true);
            const tx = positionRouter.executeDecreaseLiquidityPositions(3n, owner.address);
            await expect(tx)
                .to.emit(positionRouter, "ExecuteFailed").withArgs(1, 0, "0xf80dbaea")
                .to.emit(positionRouter, "DecreaseLiquidityPositionCancelled").withArgs(0n, owner.address)
                .to.emit(positionRouter, "ExecuteFailed").withArgs(1, 1, "0xf80dbaea")
                .to.emit(positionRouter, "DecreaseLiquidityPositionCancelled").withArgs(1n, owner.address)
                .to.emit(positionRouter, "ExecuteFailed").withArgs(1, 2, "0xf80dbaea")
                .to.emit(positionRouter, "DecreaseLiquidityPositionCancelled").withArgs(2n, owner.address);

            expect(await positionRouter.decreaseLiquidityPositionIndex()).eq(3n);
        });

        it("should cancel if execution reverted and continue to execute next when pool is malformed which will drain gas", async () => {
            const {owner, positionRouter, positionRouterWithBadRouter, market, otherAccount1} =
                await loadFixture(deployFixture);
            await positionRouter.updateDelayValues(0, 0, 100);
            await positionRouterWithBadRouter.updateDelayValues(0, 0, 100);
            await positionRouterWithBadRouter.updateExecutionGasLimit(50000);

            // all requests should be cancelled because they reverted
            await positionRouterWithBadRouter
                .connect(otherAccount1)
                .createDecreaseLiquidityPosition(market, 10n, 100n, 10n, otherAccount1.address, {
                    value: 3000,
                });
            await positionRouterWithBadRouter
                .connect(otherAccount1)
                .createDecreaseLiquidityPosition(market, 10n, 100n, 10n, otherAccount1.address, {
                    value: 3000,
                });
            await positionRouterWithBadRouter
                .connect(otherAccount1)
                .createDecreaseLiquidityPosition(market, 10n, 100n, 10n, otherAccount1.address, {
                    value: 3000,
                });

            await positionRouterWithBadRouter.updatePositionExecutor(owner.address, true);
            await positionRouter.updatePositionExecutor(owner.address, true);

            const tx = positionRouterWithBadRouter.executeDecreaseLiquidityPositions(3n, owner.address);
            await expect(tx)
                .to.emit(positionRouterWithBadRouter, "ExecuteFailed").withArgs(1, 0, "0x00000000")
                .to.emit(positionRouterWithBadRouter, "DecreaseLiquidityPositionCancelled").withArgs(0n, owner.address)
                .to.emit(positionRouterWithBadRouter, "ExecuteFailed").withArgs(1, 1, "0x00000000")
                .to.emit(positionRouterWithBadRouter, "DecreaseLiquidityPositionCancelled").withArgs(1n, owner.address)
                .to.emit(positionRouterWithBadRouter, "ExecuteFailed").withArgs(1, 2, "0x00000000")
                .to.emit(positionRouterWithBadRouter, "DecreaseLiquidityPositionCancelled").withArgs(2n, owner.address);

            expect(await positionRouterWithBadRouter.decreaseLiquidityPositionIndex()).eq(3n);

            await positionRouter
                .connect(otherAccount1)
                .createDecreaseLiquidityPosition(market, 10n, 100n, 10n, otherAccount1.address, {
                    value: 3000,
                });
            await expect(positionRouter.executeDecreaseLiquidityPositions(300n, owner.address))
                .to.emit(positionRouter, "DecreaseLiquidityPositionExecuted")
                .withArgs(0n, owner.address);
        });

        it("should continue to execute next if cancellation reverted", async () => {
            const {owner, positionRouter, market, otherAccount1, revertedFeeReceiver} =
                await loadFixture(deployFixture);
            await positionRouter.updateDelayValues(0, 0, 0);

            await positionRouter
                .connect(otherAccount1)
                .createDecreaseLiquidityPosition(market, 10n, 100n, 10n, otherAccount1.address, {
                    value: 3000,
                });
            await positionRouter
                .connect(otherAccount1)
                .createDecreaseLiquidityPosition(market, 10n, 100n, 10n, otherAccount1.address, {
                    value: 3000,
                });

            await positionRouter.updatePositionExecutor(owner.address, true);
            // execution will revert with `Expired`
            // cancellation will revert with `Reverted`
            // expect index still increases
            await positionRouter.executeDecreaseLiquidityPositions(2n, revertedFeeReceiver.target);

            // requests still there
            let [account] = await positionRouter.decreaseLiquidityPositionRequests(0n);
            expect(account).eq(otherAccount1.address);

            [account] = await positionRouter.decreaseLiquidityPositionRequests(1n);
            expect(account).eq(otherAccount1.address);

            expect(await positionRouter.decreaseLiquidityPositionIndex()).eq(2n);
        });
    });

    describe("#executeIncreasePositions", async () => {
        it("should revert with 'Forbidden' if caller is not executor", async () => {
            const {owner, positionRouter} = await loadFixture(deployFixture);
            await expect(positionRouter.executeIncreasePositions(100n, owner.address)).to.be.revertedWithCustomError(
                positionRouter,
                "Forbidden",
            );
        });
        it("should cancel request if execution reverted and continue to execute", async () => {
            const {owner, positionRouter, market, otherAccount1} = await loadFixture(deployFixture);
            // _maxTimeDelay is 0, execution will revert immediately
            await positionRouter.updateDelayValues(0, 0, 0);

            // all requests should be cancelled because they reverted
            await positionRouter.connect(otherAccount1).createIncreasePosition(market, SIDE_LONG, 1000n, 1000n, 100n, {
                value: 3000,
            });

            await positionRouter.connect(otherAccount1).createIncreasePosition(market, SIDE_LONG, 1000n, 1000n, 100n, {
                value: 3000,
            });

            await positionRouter.connect(otherAccount1).createIncreasePosition(market, SIDE_LONG, 1000n, 1000n, 100n, {
                value: 3000,
            });

            await positionRouter.updatePositionExecutor(owner.address, true);

            const tx = positionRouter.executeIncreasePositions(300n, owner.address);
            await expect(tx)
                .to.emit(positionRouter, "ExecuteFailed").withArgs(2, 0, "0xf80dbaea")
                .to.emit(positionRouter, "IncreasePositionCancelled").withArgs(0n, owner.address)
                .to.emit(positionRouter, "ExecuteFailed").withArgs(2, 1, "0xf80dbaea")
                .to.emit(positionRouter, "IncreasePositionCancelled").withArgs(1n, owner.address)
                .to.emit(positionRouter, "ExecuteFailed").withArgs(2, 2, "0xf80dbaea")
                .to.emit(positionRouter, "IncreasePositionCancelled").withArgs(2n, owner.address);

            expect(await positionRouter.increasePositionIndex()).eq(3n);
        });

        it("should cancel request if execution reverted and continue to execute when pool is malformed which will drain gas", async () => {
            const {owner, positionRouter, positionRouterWithBadRouter, market, otherAccount1} =
                await loadFixture(deployFixture);
            await positionRouterWithBadRouter.updateDelayValues(0, 0, 100);
            await positionRouterWithBadRouter.updateExecutionGasLimit(50000);
            await positionRouter.updateDelayValues(0, 0, 100);

            // all requests should be cancelled because they reverted
            await positionRouterWithBadRouter
                .connect(otherAccount1)
                .createIncreasePosition(market, SIDE_LONG, 1000n, 1000n, 100n, {
                    value: 3000,
                });

            await positionRouterWithBadRouter
                .connect(otherAccount1)
                .createIncreasePosition(market, SIDE_LONG, 1000n, 1000n, 100n, {
                    value: 3000,
                });

            await positionRouterWithBadRouter
                .connect(otherAccount1)
                .createIncreasePosition(market, SIDE_LONG, 1000n, 1000n, 100n, {
                    value: 3000,
                });

            await positionRouterWithBadRouter.updatePositionExecutor(owner.address, true);
            await positionRouter.updatePositionExecutor(owner.address, true);

            const tx = positionRouterWithBadRouter.executeIncreasePositions(300n, owner.address);
            await expect(tx)
                .to.emit(positionRouterWithBadRouter, "ExecuteFailed").withArgs(2, 0, "0x00000000")
                .to.emit(positionRouterWithBadRouter, "IncreasePositionCancelled").withArgs(0n, owner.address)
                .to.emit(positionRouterWithBadRouter, "ExecuteFailed").withArgs(2, 1, "0x00000000")
                .to.emit(positionRouterWithBadRouter, "IncreasePositionCancelled").withArgs(1n, owner.address)
                .to.emit(positionRouterWithBadRouter, "ExecuteFailed").withArgs(2, 2, "0x00000000")
                .to.emit(positionRouterWithBadRouter, "IncreasePositionCancelled").withArgs(2n, owner.address);

            expect(await positionRouterWithBadRouter.increasePositionIndex()).eq(3n);

            await positionRouter.connect(otherAccount1).createIncreasePosition(market, SIDE_LONG, 1000n, 1000n, 100n, {
                value: 3000,
            });

            await expect(positionRouter.executeIncreasePositions(300n, owner.address))
                .to.emit(positionRouter, "IncreasePositionExecuted")
                .withArgs(0n, owner.address);

            // note that the gas specified in the code is just an upper limit.
            // when the gas left is lower than this value, code can still be executed
            await positionRouter.connect(otherAccount1).createIncreasePosition(market, SIDE_LONG, 1000n, 1000n, 100n, {
                value: 3000,
            });
            await expect(await positionRouter.executeIncreasePositions(300n, owner.address, {gasLimit: 990000}))
                .to.emit(positionRouter, "IncreasePositionExecuted")
                .withArgs(1n, owner.address);
        });

        it("should continue to execute next request if cancellation reverted", async () => {
            const {owner, positionRouter, market, otherAccount1, revertedFeeReceiver} =
                await loadFixture(deployFixture);
            await positionRouter.updateDelayValues(0, 0, 0);

            await positionRouter.connect(otherAccount1).createIncreasePosition(market, SIDE_LONG, 1000n, 1000n, 100n, {
                value: 3000,
            });

            await positionRouter.connect(otherAccount1).createIncreasePosition(market, SIDE_LONG, 1000n, 1000n, 100n, {
                value: 3000,
            });

            await positionRouter.updatePositionExecutor(owner.address, true);
            // execution will revert with `Expired`
            // cancellation will revert with `Reverted`
            // expect index still increases
            await positionRouter.executeIncreasePositions(1000n, revertedFeeReceiver.target);

            // requests still there
            let [account] = await positionRouter.increasePositionRequests(0n);
            expect(account).eq(otherAccount1.address);

            [account] = await positionRouter.increasePositionRequests(1n);
            expect(account).eq(otherAccount1.address);

            expect(await positionRouter.increasePositionIndex()).eq(2n);
        });
    });

    describe("#executeDecreasePositions", async () => {
        it("should revert with 'Forbidden' if caller is not executor", async () => {
            const {owner, positionRouter} = await loadFixture(deployFixture);
            await expect(positionRouter.executeDecreasePositions(100n, owner.address)).to.be.revertedWithCustomError(
                positionRouter,
                "Forbidden",
            );
        });

        it("should cancel request if execution reverted and continue to execute", async () => {
            const {owner, positionRouter, market, otherAccount1} = await loadFixture(deployFixture);
            // _maxTimeDelay is 0, execution will revert immediately
            await positionRouter.updateDelayValues(0, 0, 0);

            // all requests should be cancelled because they reverted
            await positionRouter
                .connect(otherAccount1)
                .createDecreasePosition(market, SIDE_LONG, 100n, 100n, 1000n, otherAccount1.address, {
                    value: 3000,
                });
            await positionRouter
                .connect(otherAccount1)
                .createDecreasePosition(market, SIDE_LONG, 100n, 100n, 1000n, otherAccount1.address, {
                    value: 3000,
                });
            await positionRouter
                .connect(otherAccount1)
                .createDecreasePosition(market, SIDE_LONG, 100n, 100n, 1000n, otherAccount1.address, {
                    value: 3000,
                });

            await positionRouter.updatePositionExecutor(owner.address, true);

            const tx = positionRouter.executeDecreasePositions(300n, owner.address);
            await expect(tx)
                .to.emit(positionRouter, "ExecuteFailed").withArgs(3, 0, "0xf80dbaea")
                .to.emit(positionRouter, "DecreasePositionCancelled").withArgs(0n, owner.address)
                .to.emit(positionRouter, "ExecuteFailed").withArgs(3, 1, "0xf80dbaea")
                .to.emit(positionRouter, "DecreasePositionCancelled").withArgs(1n, owner.address)
                .to.emit(positionRouter, "ExecuteFailed").withArgs(3, 2, "0xf80dbaea")
                .to.emit(positionRouter, "DecreasePositionCancelled").withArgs(2n, owner.address);

            expect(await positionRouter.decreasePositionIndex()).eq(3n);
        });

        it("should cancel request if execution reverted and continue to execute when pool is malformed which will drain gas", async () => {
            const {owner, positionRouter, positionRouterWithBadRouter, market, otherAccount1} =
                await loadFixture(deployFixture);
            await positionRouterWithBadRouter.updateDelayValues(0, 0, 100);
            await positionRouterWithBadRouter.updateExecutionGasLimit(50000);
            await positionRouter.updateDelayValues(0, 0, 100);

            // all requests should be cancelled because they reverted
            await positionRouterWithBadRouter
                .connect(otherAccount1)
                .createDecreasePosition(market, SIDE_LONG, 100n, 100n, 0n, otherAccount1.address, {
                    value: 3000,
                });
            await positionRouterWithBadRouter
                .connect(otherAccount1)
                .createDecreasePosition(market, SIDE_LONG, 100n, 100n, 0n, otherAccount1.address, {
                    value: 3000,
                });
            await positionRouterWithBadRouter
                .connect(otherAccount1)
                .createDecreasePosition(market, SIDE_LONG, 100n, 100n, 0n, otherAccount1.address, {
                    value: 3000,
                });

            await positionRouterWithBadRouter.updatePositionExecutor(owner.address, true);
            await positionRouter.updatePositionExecutor(owner.address, true);

            const tx = positionRouterWithBadRouter.executeDecreasePositions(300n, owner.address);
            await expect(tx)
                .to.emit(positionRouterWithBadRouter, "ExecuteFailed").withArgs(3, 0, "0x00000000")
                .to.emit(positionRouterWithBadRouter, "DecreasePositionCancelled").withArgs(0n, owner.address)
                .to.emit(positionRouterWithBadRouter, "ExecuteFailed").withArgs(3, 1, "0x00000000")
                .to.emit(positionRouterWithBadRouter, "DecreasePositionCancelled").withArgs(1n, owner.address)
                .to.emit(positionRouterWithBadRouter, "ExecuteFailed").withArgs(3, 2, "0x00000000")
                .to.emit(positionRouterWithBadRouter, "DecreasePositionCancelled").withArgs(2n, owner.address);

            expect(await positionRouterWithBadRouter.decreasePositionIndex()).eq(3n);

            await positionRouter
                .connect(otherAccount1)
                .createDecreasePosition(market, SIDE_LONG, 100n, 100n, 0n, otherAccount1.address, {
                    value: 3000,
                });

            await expect(positionRouter.executeDecreasePositions(300n, owner.address))
                .to.emit(positionRouter, "DecreasePositionExecuted")
                .withArgs(0n, owner.address);
        });

        it("should continue to execute next request if cancellation reverted", async () => {
            const {owner, positionRouter, market, otherAccount1, revertedFeeReceiver} =
                await loadFixture(deployFixture);
            await positionRouter.updateDelayValues(0, 0, 0);

            await positionRouter
                .connect(otherAccount1)
                .createDecreasePosition(market, SIDE_LONG, 100n, 100n, 1000n, otherAccount1.address, {
                    value: 3000,
                });
            await positionRouter
                .connect(otherAccount1)
                .createDecreasePosition(market, SIDE_LONG, 100n, 100n, 1000n, otherAccount1.address, {
                    value: 3000,
                });

            await positionRouter.updatePositionExecutor(owner.address, true);
            // execution will revert with `Expired`
            // cancellation will revert with `Reverted`
            // expect index still increases
            await positionRouter.executeDecreasePositions(1000n, revertedFeeReceiver.target);

            // requests still there
            let [account] = await positionRouter.decreasePositionRequests(0n);
            expect(account).eq(otherAccount1.address);

            [account] = await positionRouter.decreasePositionRequests(1n);
            expect(account).eq(otherAccount1.address);

            expect(await positionRouter.decreasePositionIndex()).eq(2n);
        });
    });

    describe("#createCloseLiquidityPositionsBatch", async () => {
        it("should not create decrease liquidity positions", async () => {
            const {positionRouter, otherAccount1} = await loadFixture(deployFixture);
            await positionRouter.createCloseLiquidityPositionsBatch([], otherAccount1.address);
            expect(await positionRouter.decreaseLiquidityPositionIndexNext()).to.eq(0n);
        });
        it("should revert with 'InsufficientExecutionFee' if insufficient execution fee", async () => {
            const {positionRouter, market, market2, otherAccount1} = await loadFixture(deployFixture);
            await expect(
                positionRouter.createCloseLiquidityPositionsBatch([market, market2], otherAccount1.address, {
                    value: 1000,
                }),
            )
                .to.be.revertedWithCustomError(positionRouter, "InsufficientExecutionFee")
                .withArgs(500n, 3000n);
        });
        it("should revert with 'InvalidExecutionFee' if invalid execution fee", async () => {
            const {positionRouter, market, market2, otherAccount1} = await loadFixture(deployFixture);
            await expect(
                positionRouter.createCloseLiquidityPositionsBatch([market, market2], otherAccount1.address, {
                    value: 6001,
                }),
            )
                .to.be.revertedWithCustomError(positionRouter, "InvalidExecutionFee")
                .withArgs(6001n, 6000n);
        });
        it("should revert with 'LiquidityNotFound' if position liquidity is zero", async () => {
            const {positionRouter, market, market2, otherAccount1} = await loadFixture(deployFixture);
            await expect(
                positionRouter
                    .connect(otherAccount1)
                    .createCloseLiquidityPositionsBatch([market, market2], otherAccount1.address, {value: 6000}),
            )
                .to.be.revertedWithCustomError(positionRouter, "LiquidityNotFound")
                .withArgs(market, otherAccount1.address);
        });
        it("should create decrease liquidity positions successfully", async () => {
            const {owner, positionRouter, marketManager, market, market2, otherAccount1} =
                await loadFixture(deployFixture);
            await positionRouter.updatePositionExecutor(owner.address, true);
            await positionRouter.updateDelayValues(100, 0, 600);
            await positionRouter.connect(otherAccount1).createIncreaseLiquidityPosition(market, 100n, 1000n, 100n, {
                value: 3000,
            });
            await positionRouter.connect(otherAccount1).createIncreaseLiquidityPosition(market2, 100n, 1000n, 100n, {
                value: 3000,
            });
            await mine(100);
            await positionRouter.executeIncreaseLiquidityPosition(0n, owner.address);
            await positionRouter.executeIncreaseLiquidityPosition(1n, owner.address);
            await marketManager.setLiquidityPosition(market, otherAccount1.address, {
                margin: 100n,
                liquidity: 1000n,
                entryUnrealizedPnLGrowthX64: 1n << 64n,
            });
            await marketManager.setLiquidityPosition(market2, otherAccount1.address, {
                margin: 100n,
                liquidity: 1000n,
                entryUnrealizedPnLGrowthX64: 1n << 64n,
            });
            const tx = positionRouter
                .connect(otherAccount1)
                .createCloseLiquidityPositionsBatch([market, market2], otherAccount1.address, {value: 6000});
            await expect(tx)
                .to.emit(positionRouter, "DecreaseLiquidityPositionCreated")
                .withArgs(otherAccount1.address, market, 0n, 1000n, 0n, otherAccount1.address, 3000n, 0)
                .to.emit(positionRouter, "DecreaseLiquidityPositionCreated")
                .withArgs(otherAccount1.address, market2, 0n, 1000n, 0n, otherAccount1.address, 3000n, 1);
            expect(await positionRouter.decreaseLiquidityPositionRequests(0)).to.deep.eq([
                otherAccount1.address,
                market,
                0n,
                1000n,
                0n,
                3000n,
                await time.latestBlock(),
                await time.latest(),
                otherAccount1.address,
            ]);
            expect(await positionRouter.decreaseLiquidityPositionRequests(1)).to.deep.eq([
                otherAccount1.address,
                market2,
                0n,
                1000n,
                0n,
                3000n,
                await time.latestBlock(),
                await time.latest(),
                otherAccount1.address,
            ]);
            expect(await positionRouter.decreaseLiquidityPositionIndexNext()).to.eq(2n);
        });
    });

    describe("#createClosePositionsBatch", async () => {
        it("should not create decrease positions", async () => {
            const {positionRouter, otherAccount1} = await loadFixture(deployFixture);
            await positionRouter.createClosePositionsBatch([], otherAccount1.address);
            expect(await positionRouter.decreasePositionIndexNext()).to.eq(0n);
        });
        it("should revert with 'InsufficientExecutionFee' if insufficient execution fee", async () => {
            const {positionRouter, market, market2, otherAccount1} = await loadFixture(deployFixture);
            await expect(
                positionRouter.createClosePositionsBatch(
                    [
                        {market, side: SIDE_LONG},
                        {market: market2, side: SIDE_SHORT},
                    ],
                    otherAccount1.address,
                    {
                        value: 1000,
                    },
                ),
            )
                .to.be.revertedWithCustomError(positionRouter, "InsufficientExecutionFee")
                .withArgs(500n, 3000n);
        });
        it("should revert with 'InvalidExecutionFee' if invalid execution fee", async () => {
            const {positionRouter, market, market2, otherAccount1} = await loadFixture(deployFixture);
            await expect(
                positionRouter.createClosePositionsBatch(
                    [
                        {market, side: SIDE_LONG},
                        {market: market2, side: SIDE_SHORT},
                    ],
                    otherAccount1.address,
                    {
                        value: 6001,
                    },
                ),
            )
                .to.be.revertedWithCustomError(positionRouter, "InvalidExecutionFee")
                .withArgs(6001n, 6000n);
        });
        it("should revert with 'PositionNotFound' if position is zero", async () => {
            const {positionRouter, market, market2, otherAccount1} = await loadFixture(deployFixture);
            await expect(
                positionRouter.connect(otherAccount1).createClosePositionsBatch(
                    [
                        {market, side: SIDE_LONG},
                        {market: market2, side: SIDE_SHORT},
                    ],
                    otherAccount1.address,
                    {value: 6000},
                ),
            )
                .to.be.revertedWithCustomError(positionRouter, "PositionNotFound")
                .withArgs(market, otherAccount1.address, SIDE_LONG);
        });
        it("should create decrease positions successfully", async () => {
            const {owner, positionRouter, marketManager, market, market2, otherAccount1} =
                await loadFixture(deployFixture);
            await positionRouter.updatePositionExecutor(owner.address, true);
            await positionRouter.updateDelayValues(100, 0, 600);
            await positionRouter.connect(otherAccount1).createIncreasePosition(market, SIDE_LONG, 1000n, 1000n, 100n, {
                value: 3000,
            });
            await positionRouter
                .connect(otherAccount1)
                .createIncreasePosition(market2, SIDE_SHORT, 1000n, 1000n, 100n, {
                    value: 3000,
                });
            await mine(100);
            await positionRouter.executeIncreasePositions(0n, owner.address);
            await marketManager.setPosition(market, otherAccount1.address, SIDE_LONG, {
                margin: 100n,
                size: 1n,
                entryPriceX96: 1000n << 96n,
                entryFundingRateGrowthX96: 1n << 96n,
            });
            await marketManager.setPosition(market2, otherAccount1.address, SIDE_SHORT, {
                margin: 100n,
                size: 1n,
                entryPriceX96: 1000n << 96n,
                entryFundingRateGrowthX96: 1n << 96n,
            });
            const tx = positionRouter.connect(otherAccount1).createClosePositionsBatch(
                [
                    {market, side: SIDE_LONG},
                    {market: market2, side: SIDE_SHORT},
                ],
                otherAccount1.address,
                {value: 6000},
            );
            await expect(tx)
                .to.emit(positionRouter, "DecreasePositionCreated")
                .withArgs(otherAccount1.address, market, SIDE_LONG, 0n, 1n, 0n, otherAccount1.address, 3000n, 0)
                .to.emit(positionRouter, "DecreasePositionCreated")
                .withArgs(otherAccount1.address, market2, SIDE_SHORT, 0n, 1n, 0n, otherAccount1.address, 3000n, 1);
            expect(await positionRouter.decreasePositionRequests(0)).to.deep.eq([
                otherAccount1.address,
                market,
                SIDE_LONG,
                0n,
                1n,
                0n,
                3000n,
                await time.latestBlock(),
                await time.latest(),
                otherAccount1.address,
            ]);
            expect(await positionRouter.decreasePositionRequests(1)).to.deep.eq([
                otherAccount1.address,
                market2,
                SIDE_SHORT,
                0n,
                1n,
                0n,
                3000n,
                await time.latestBlock(),
                await time.latest(),
                otherAccount1.address,
            ]);
            expect(await positionRouter.decreasePositionIndexNext()).to.deep.eq(2n);
        });
    });
});
