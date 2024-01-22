// SPDX-License-Identifier: UNLICENSED
pragma solidity =0.8.23;

import "forge-std/Test.sol";
import "../../contracts/types/Side.sol";
import "../../contracts/test/PriceUtilHarness.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";

contract PriceUtilTest is Test {
    using SafeCast for *;

    IMarketDescriptor private constant market = IMarketDescriptor(address(0));
    PriceUtilHarness private priceUtil;
    IMarketManager.PriceState private priceState;
    IMarketManager.GlobalLiquidityPosition private globalPosition;
    uint8 private liquidationVertexIndex;

    struct CalculateAX248AndBX96Params {
        Side globalSide;
        IMarketManager.PriceVertex from;
        IMarketManager.PriceVertex to;
        uint256 aX248;
        int256 bX96;
    }

    struct CalculateReachedAndSizeUsedParams {
        bool improveBalance;
        uint128 sizeCurrent;
        uint128 sizeTo;
        uint128 sizeLeft;
        bool reached;
        uint256 sizeUsed;
    }

    struct CalculatePremiumRateAfterX96Params {
        IMarketManager.PriceVertex from;
        IMarketManager.PriceVertex to;
        Side side;
        bool improveBalance;
        uint128 sizeCurrent;
        bool reached;
        uint128 sizeUsed;
        uint128 premiumRateAfterX96;
    }

    struct SimulateMoveParams {
        // Inputs
        Side side;
        uint128 sizeLeft;
        uint160 indexPriceX96;
        bool improveBalance;
        IMarketManager.PriceVertex from;
        IMarketManager.PriceVertex current;
        IMarketManager.PriceVertex to;
        uint160 basisIndexPriceX96;
        // Outputs
        int160 tradePriceX96;
        uint128 sizeUsed;
        bool reached;
        uint128 premiumRateAfterX96;
    }

    struct UpdatePriceStateCase {
        uint256 id;
        // Inputs
        Side side;
        uint128 sizeDelta;
        uint160 indexPriceX96;
        // Outputs
        Side globalSideExpect;
        uint160 tradePriceX96Expect;
        uint128 netSizeExpect;
        uint128 bufferSizeExpect;
        uint128 prX96Expect;
        uint8 pendingVertexIndexExpect;
        uint8 currentVertexIndexExpect;
    }

    function setUp() public {
        priceUtil = new PriceUtilHarness();
        globalPosition.liquidity = 3923892901;
        liquidationVertexIndex = 4;
        priceState.priceVertices = [
            IMarketManager.PriceVertex(0, 0), // v0 (0, 0)
            // (aX248, bX96) = (5763572808880626331515210718947783038064955043708290426, 0)
            IMarketManager.PriceVertex(39238929010000000, Math.mulDiv(5, Constants.Q96, 10000).toUint128()), // v1 (2%, 0.05%) 39614081257132168796771975
            // (aX248, bX96) = (11527145617761252663030421437895566076129910087416580852, -39614081257132168796771975)
            IMarketManager.PriceVertex(58858393515000000, Math.mulDiv(10, Constants.Q96, 10000).toUint128()), // v2 (3%, 0.1%) 79228162514264337593543950
            // (aX248, bX96) = (11527145617761252663030421437895566076129910087416580852, -39614081257132168796771975)
            IMarketManager.PriceVertex(78477858020000000, Math.mulDiv(15, Constants.Q96, 10000).toUint128()), // v3 (4%, 0.15%) 118842243771396506390315925
            // (aX248, bX96) = (11527145617761252663030421437895566076129910087416580852, -39614081257132168796771975)
            IMarketManager.PriceVertex(98097322525000000, Math.mulDiv(20, Constants.Q96, 10000).toUint128()), // v4 (5%, 0.2%) 158456325028528675187087900
            // (aX248, bX96) = (36886865976836008521697348775857450355133685666942299822, -475368975085586025561263703)
            IMarketManager.PriceVertex(196194645050000000, Math.mulDiv(100, Constants.Q96, 10000).toUint128()), // v5 (10%, 1%) 792281625142643375935439503
            // (aX248, bX96) = (23054291235522505326060842963086951608018806868437782252, 0)
            IMarketManager.PriceVertex(392389290100000000, Math.mulDiv(200, Constants.Q96, 10000).toUint128()), // v6 (20%, 2%) 1584563250285286751870879006
            // (aX248, bX96) = (23054291235522505326060842972786487103103138723282740090, 0)
            IMarketManager.PriceVertex(980973225250000000, Math.mulDiv(500, Constants.Q96, 10000).toUint128()), // v7 (50%, 5%) 3961408125713216879677197516
            // (aX248, bX96) = (57635728088806263315152107436815985505300012735629329144, -5942112188569825319515796276)
            IMarketManager.PriceVertex(1373362515350000000, Math.mulDiv(1000, Constants.Q96, 10000).toUint128()), // v8 (70%, 10%) 7922816251426433759354395033
            // (aX248, bX96) = (76847637451741684420202809915754647340400016980839105526, -10563755001901911679139193379)
            IMarketManager.PriceVertex(1961946450500000000, Math.mulDiv(2000, Constants.Q96, 10000).toUint128()) // v9 (100%, 20%) 15845632502852867518708790067
        ];
    }

    // Test update price state, the index price fluctuates
    function test_updatePriceState_FluctuantIndexPrice() public {
        uint160 tradePriceX96;
        // Assume that current index price is 2000
        uint160 currentIndexPriceX96 = Math.mulDiv(2000, Constants.Q96, 1e12).toUint160();
        uint128 sizeDelta = priceState.priceVertices[1].size;

        // Trader longs and moves the price to v1
        expectEmitGlobalLiquidityPositionChangedEvent(market, SHORT, sizeDelta, 0);
        expectEmitBasisIndexPriceX96ChangedEvent(currentIndexPriceX96);
        expectEmitPremiumChangedEvent(priceState.priceVertices[1].premiumRateX96);
        (tradePriceX96, priceState, globalPosition) = priceUtil.updatePriceState(
            globalPosition,
            priceState,
            packUpdatePriceStateParam(market, LONG, sizeDelta, currentIndexPriceX96, liquidationVertexIndex, false)
        );
        assertEq(tradePriceX96, 158495939109785807356);

        // Index price up by 10%
        currentIndexPriceX96 = Math.mulDiv(2200, Constants.Q96, 1e12).toUint160();

        // Trader closed the position
        expectEmitGlobalLiquidityPositionChangedEvent(market, SHORT, 0, 0);
        expectEmitPremiumChangedEvent(0);
        (tradePriceX96, priceState, globalPosition) = priceUtil.updatePriceState(
            globalPosition,
            priceState,
            packUpdatePriceStateParam(market, SHORT, sizeDelta, currentIndexPriceX96, liquidationVertexIndex, false)
        );
        assertEq(tradePriceX96, 174341571612638674873); // trade price is up by 10%
        assertEq(globalPosition.netSize | globalPosition.liquidationBufferNetSize, 0);

        // Trader shorts
        expectEmitGlobalLiquidityPositionChangedEvent(market, LONG, sizeDelta, 0);
        expectEmitBasisIndexPriceX96ChangedEvent(currentIndexPriceX96);
        expectEmitPremiumChangedEvent(priceState.priceVertices[1].premiumRateX96);
        (tradePriceX96, priceState, globalPosition) = priceUtil.updatePriceState(
            globalPosition,
            priceState,
            packUpdatePriceStateParam(market, SHORT, sizeDelta, currentIndexPriceX96, liquidationVertexIndex, false)
        );
        assertEq(tradePriceX96, 174258382041998697319);
        assertEq(priceState.basisIndexPriceX96, currentIndexPriceX96);

        // Index price dropped heavily
        currentIndexPriceX96 = Math.mulDiv(1, Constants.Q96, 1e15).toUint160();

        // Trader try to close the position
        vm.expectRevert(
            abi.encodeWithSelector(IMarketErrors.InvalidTradePrice.selector, -1706746706224988825612720210000000)
        );
        priceUtil.updatePriceState(
            globalPosition,
            priceState,
            packUpdatePriceStateParam(market, LONG, sizeDelta, currentIndexPriceX96, liquidationVertexIndex, false)
        );

        // Index price up and position can be decreased now
        currentIndexPriceX96 = Math.mulDiv(2090, Constants.Q96, 1e12).toUint160();
        (tradePriceX96, priceState, globalPosition) = priceUtil.updatePriceState(
            globalPosition,
            priceState,
            packUpdatePriceStateParam(market, LONG, sizeDelta, currentIndexPriceX96, liquidationVertexIndex, false)
        );
        assertEq(tradePriceX96, 165543284165429620185); // trade price is down by 10%
        assertEq(globalPosition.liquidationBufferNetSize | globalPosition.netSize, 0);

        // Test that the trader can save the negative trade price by opening more size
        // Shorts to the top (v9)
        currentIndexPriceX96 = Math.mulDiv(2000, Constants.Q96, 1e12).toUint160();
        sizeDelta = priceState.priceVertices[9].size;
        expectEmitGlobalLiquidityPositionChangedEvent(market, LONG, sizeDelta, 0);
        expectEmitBasisIndexPriceX96ChangedEvent(currentIndexPriceX96);
        expectEmitPremiumChangedEvent(priceState.priceVertices[9].premiumRateX96);
        (tradePriceX96, priceState, globalPosition) = priceUtil.updatePriceState(
            globalPosition,
            priceState,
            packUpdatePriceStateParam(market, SHORT, sizeDelta, currentIndexPriceX96, liquidationVertexIndex, false)
        );
        assertEq(tradePriceX96, 146993198335152339501);
        assertEq(globalPosition.netSize, priceState.priceVertices[9].size);
        assertEq(priceState.currentVertexIndex, 9);

        // Next step will move the price to v8
        // To ensure that the trade price x96 calculation result is -1, let the index price drop
        currentIndexPriceX96 = 23768448754279301277;
        sizeDelta = priceState.priceVertices[9].size - priceState.priceVertices[8].size;
        vm.expectRevert(abi.encodeWithSelector(IMarketErrors.InvalidTradePrice.selector, -int256(uint256(sizeDelta))));
        priceUtil.updatePriceState(
            globalPosition,
            priceState,
            packUpdatePriceStateParam(market, LONG, sizeDelta, currentIndexPriceX96, liquidationVertexIndex, false)
        );
        // If price keeps this low, trader can long more size, the trade price will be valid again
        priceUtil.updatePriceState(
            globalPosition,
            priceState,
            packUpdatePriceStateParam(market, LONG, sizeDelta + 1, currentIndexPriceX96, liquidationVertexIndex, false)
        );
    }

    // Test update price state, starting from opening long positions, each op moves pr exactly on a certain vertex
    // Index price is stable
    function test_updatePriceState_FromLongMoveOnVertex() public {
        uint160 tradePriceX96;
        uint160 currentIndexPriceX96 = Math.mulDiv(2000, Constants.Q96, 1e12).toUint160(); // 2000
        // ----------------------------------------------------------------
        // Move until the limit reached
        // ----------------------------------------------------------------
        UpdatePriceStateCase[6] memory longCases = [
            UpdatePriceStateCase({
                id: 1,
                side: LONG,
                sizeDelta: priceState.priceVertices[1].size, // move exactly to v[1] by longing
                indexPriceX96: currentIndexPriceX96,
                globalSideExpect: SHORT,
                tradePriceX96Expect: 158495939109785807356,
                netSizeExpect: priceState.priceVertices[1].size,
                bufferSizeExpect: 0,
                prX96Expect: priceState.priceVertices[1].premiumRateX96,
                pendingVertexIndexExpect: 0,
                currentVertexIndexExpect: 1
            }),
            UpdatePriceStateCase({
                id: 2,
                side: LONG,
                sizeDelta: priceState.priceVertices[2].size - priceState.priceVertices[1].size, // continue moving to v2
                indexPriceX96: currentIndexPriceX96,
                globalSideExpect: SHORT,
                tradePriceX96Expect: 158575167272300071694,
                netSizeExpect: priceState.priceVertices[2].size,
                bufferSizeExpect: 0,
                prX96Expect: priceState.priceVertices[2].premiumRateX96,
                pendingVertexIndexExpect: 0,
                currentVertexIndexExpect: 2
            }),
            UpdatePriceStateCase({
                id: 3,
                side: LONG,
                sizeDelta: priceState.priceVertices[3].size - priceState.priceVertices[2].size, // continue moving to v3
                indexPriceX96: currentIndexPriceX96,
                globalSideExpect: SHORT,
                tradePriceX96Expect: 158654395434814336031,
                netSizeExpect: priceState.priceVertices[3].size,
                bufferSizeExpect: 0,
                prX96Expect: priceState.priceVertices[3].premiumRateX96,
                pendingVertexIndexExpect: 0,
                currentVertexIndexExpect: 3
            }),
            UpdatePriceStateCase({
                id: 4,
                side: LONG,
                sizeDelta: priceState.priceVertices[4].size - priceState.priceVertices[3].size, // continue moving to v4
                indexPriceX96: currentIndexPriceX96,
                globalSideExpect: SHORT,
                tradePriceX96Expect: 158733623597328600369,
                netSizeExpect: priceState.priceVertices[4].size,
                bufferSizeExpect: 0,
                prX96Expect: priceState.priceVertices[4].premiumRateX96,
                pendingVertexIndexExpect: 0,
                currentVertexIndexExpect: 4
            }),
            UpdatePriceStateCase({
                id: 5,
                side: LONG,
                sizeDelta: priceState.priceVertices[5].size - priceState.priceVertices[4].size, // continue moving to v5
                indexPriceX96: currentIndexPriceX96,
                globalSideExpect: SHORT,
                tradePriceX96Expect: 159407062978699847239,
                netSizeExpect: priceState.priceVertices[5].size,
                bufferSizeExpect: 0,
                prX96Expect: priceState.priceVertices[5].premiumRateX96,
                pendingVertexIndexExpect: 0,
                currentVertexIndexExpect: 5
            }),
            UpdatePriceStateCase({
                id: 6,
                side: LONG,
                sizeDelta: priceState.priceVertices[9].size - priceState.priceVertices[5].size, // move directly to v9
                indexPriceX96: currentIndexPriceX96,
                globalSideExpect: SHORT,
                tradePriceX96Expect: 171132831030810969203,
                netSizeExpect: priceState.priceVertices[9].size,
                bufferSizeExpect: 0,
                prX96Expect: priceState.priceVertices[9].premiumRateX96,
                pendingVertexIndexExpect: 0,
                currentVertexIndexExpect: 9
            })
        ];

        uint256 snapshotAtV4;
        for (uint i = 0; i < longCases.length; ++i) {
            expectEmitGlobalLiquidityPositionChangedEvent(market, longCases[i]);
            // Basis index price gets updated if crosses the origin with the index price used
            if (i == 0) expectEmitBasisIndexPriceX96ChangedEvent(longCases[i].indexPriceX96);
            expectEmitPremiumChangedEvent(longCases[i].prX96Expect);
            (tradePriceX96, priceState, globalPosition) = priceUtil.updatePriceState(
                globalPosition,
                priceState,
                packUpdatePriceStateParam(
                    market,
                    longCases[i].side,
                    longCases[i].sizeDelta,
                    longCases[i].indexPriceX96,
                    liquidationVertexIndex,
                    false
                )
            );
            checkResult(longCases[i], tradePriceX96);
            if (i == 3) snapshotAtV4 = vm.snapshot(); // choose a point to take snapshot for later liquidation tests
        }

        // ----------------------------------------------------------------
        // Continue to long, expect to revert
        // ----------------------------------------------------------------
        vm.expectRevert(IMarketErrors.MaxPremiumRateExceeded.selector);
        priceUtil.updatePriceState(
            globalPosition,
            priceState,
            packUpdatePriceStateParam(market, LONG, 1, currentIndexPriceX96, liquidationVertexIndex, false)
        );

        // ----------------------------------------------------------------
        // Move back to the origin step by step
        // Expecting price a bit worse
        // ----------------------------------------------------------------
        UpdatePriceStateCase[6] memory shortCases = [
            UpdatePriceStateCase({
                id: 7,
                side: SHORT,
                sizeDelta: priceState.priceVertices[9].size - priceState.priceVertices[5].size,
                indexPriceX96: currentIndexPriceX96,
                globalSideExpect: SHORT,
                tradePriceX96Expect: 171132831030810969201,
                netSizeExpect: priceState.priceVertices[5].size,
                bufferSizeExpect: 0,
                prX96Expect: priceState.priceVertices[5].premiumRateX96,
                pendingVertexIndexExpect: 0,
                currentVertexIndexExpect: 5
            }),
            UpdatePriceStateCase({
                id: 8,
                side: SHORT,
                sizeDelta: priceState.priceVertices[5].size - priceState.priceVertices[4].size,
                indexPriceX96: currentIndexPriceX96,
                globalSideExpect: SHORT,
                tradePriceX96Expect: 159407062978699847238,
                netSizeExpect: priceState.priceVertices[4].size,
                bufferSizeExpect: 0,
                prX96Expect: priceState.priceVertices[4].premiumRateX96,
                pendingVertexIndexExpect: 0,
                currentVertexIndexExpect: 4
            }),
            UpdatePriceStateCase({
                id: 9,
                side: SHORT,
                sizeDelta: priceState.priceVertices[4].size - priceState.priceVertices[3].size,
                indexPriceX96: currentIndexPriceX96,
                globalSideExpect: SHORT,
                tradePriceX96Expect: 158733623597328600368,
                netSizeExpect: priceState.priceVertices[3].size,
                bufferSizeExpect: 0,
                prX96Expect: priceState.priceVertices[3].premiumRateX96,
                pendingVertexIndexExpect: 0,
                currentVertexIndexExpect: 3
            }),
            UpdatePriceStateCase({
                id: 10,
                side: SHORT,
                sizeDelta: priceState.priceVertices[3].size - priceState.priceVertices[2].size,
                indexPriceX96: currentIndexPriceX96,
                globalSideExpect: SHORT,
                tradePriceX96Expect: 158654395434814336030,
                netSizeExpect: priceState.priceVertices[2].size,
                bufferSizeExpect: 0,
                prX96Expect: priceState.priceVertices[2].premiumRateX96,
                pendingVertexIndexExpect: 0,
                currentVertexIndexExpect: 2
            }),
            UpdatePriceStateCase({
                id: 11,
                side: SHORT,
                sizeDelta: priceState.priceVertices[2].size - priceState.priceVertices[1].size,
                indexPriceX96: currentIndexPriceX96,
                globalSideExpect: SHORT,
                tradePriceX96Expect: 158575167272300071693,
                netSizeExpect: priceState.priceVertices[1].size,
                bufferSizeExpect: 0,
                prX96Expect: priceState.priceVertices[1].premiumRateX96,
                pendingVertexIndexExpect: 0,
                currentVertexIndexExpect: 1
            }),
            UpdatePriceStateCase({
                id: 12,
                side: SHORT,
                sizeDelta: priceState.priceVertices[1].size - priceState.priceVertices[0].size,
                indexPriceX96: currentIndexPriceX96,
                globalSideExpect: SHORT, // lp would have no position, but side wont be updated
                tradePriceX96Expect: 158495939109785807355,
                netSizeExpect: 0,
                bufferSizeExpect: 0,
                prX96Expect: priceState.priceVertices[0].premiumRateX96,
                pendingVertexIndexExpect: 0,
                currentVertexIndexExpect: 0
            })
        ];

        for (uint i = 0; i < shortCases.length; ++i) {
            expectEmitGlobalLiquidityPositionChangedEvent(market, shortCases[i]);
            expectEmitPremiumChangedEvent(shortCases[i].prX96Expect);
            (tradePriceX96, priceState, globalPosition) = priceUtil.updatePriceState(
                globalPosition,
                priceState,
                packUpdatePriceStateParam(
                    market,
                    shortCases[i].side,
                    shortCases[i].sizeDelta,
                    shortCases[i].indexPriceX96,
                    liquidationVertexIndex,
                    false
                )
            );
            checkResult(shortCases[i], tradePriceX96);
        }
        assertEq(globalPosition.netSize | globalPosition.liquidationBufferNetSize, 0);

        // ----------------------------------------------------------------
        // Now move across the origin to another side
        // ----------------------------------------------------------------
        expectEmitBasisIndexPriceX96ChangedEvent(currentIndexPriceX96);
        (tradePriceX96, priceState, globalPosition) = priceUtil.updatePriceState(
            globalPosition,
            priceState,
            packUpdatePriceStateParam(market, SHORT, 1, currentIndexPriceX96, liquidationVertexIndex, false)
        );
        assertEq(Side.unwrap(globalPosition.side), Side.unwrap(LONG), "side");
        assertEq(globalPosition.netSize, 1, "netSize");
        assertEq(priceState.currentVertexIndex, 1, "currentVertexIndex");
        assertEq(priceState.pendingVertexIndex, 0, "pendingVertexIndex");

        // ----------------------------------------------------------------
        // Revert to snapshot
        // Move a single step and cross the origin to the limit
        // ----------------------------------------------------------------
        vm.revertTo(snapshotAtV4);
        UpdatePriceStateCase memory crossAndRevertCase = UpdatePriceStateCase({
            id: 290,
            side: SHORT,
            sizeDelta: priceState.priceVertices[4].size + priceState.priceVertices[9].size,
            indexPriceX96: currentIndexPriceX96,
            globalSideExpect: LONG,
            tradePriceX96Expect: 147545475219421414980,
            netSizeExpect: priceState.priceVertices[9].size,
            bufferSizeExpect: 0,
            prX96Expect: priceState.priceVertices[9].premiumRateX96,
            pendingVertexIndexExpect: 0,
            currentVertexIndexExpect: 9
        });

        expectEmitGlobalLiquidityPositionChangedEvent(market, crossAndRevertCase);
        expectEmitPremiumChangedEvent(crossAndRevertCase.prX96Expect);
        (tradePriceX96, priceState, globalPosition) = priceUtil.updatePriceState(
            globalPosition,
            priceState,
            packUpdatePriceStateParam(
                market,
                crossAndRevertCase.side,
                crossAndRevertCase.sizeDelta,
                crossAndRevertCase.indexPriceX96,
                liquidationVertexIndex,
                false
            )
        );
        checkResult(crossAndRevertCase, tradePriceX96);

        vm.expectRevert(IMarketErrors.MaxPremiumRateExceeded.selector);
        priceUtil.updatePriceState(
            globalPosition,
            priceState,
            packUpdatePriceStateParam(market, SHORT, 1, currentIndexPriceX96, liquidationVertexIndex, false)
        );

        // ----------------------------------------------------------------
        // Liquidation tests
        // Now price is in v4 and lp has a short position
        // Test liquidations that should use the liquidation buffer
        // The price returned should also be checked
        // ----------------------------------------------------------------
        vm.revertTo(snapshotAtV4);
        UpdatePriceStateCase[2] memory liquidationCases = [
            UpdatePriceStateCase({
                id: 100,
                side: LONG,
                sizeDelta: 100,
                indexPriceX96: currentIndexPriceX96,
                globalSideExpect: SHORT,
                tradePriceX96Expect: 158773237678585732538,
                netSizeExpect: priceState.priceVertices[4].size,
                bufferSizeExpect: 100,
                prX96Expect: priceState.priceVertices[4].premiumRateX96,
                pendingVertexIndexExpect: 0,
                currentVertexIndexExpect: 4
            }),
            UpdatePriceStateCase({
                id: 110,
                side: LONG,
                sizeDelta: 100,
                indexPriceX96: currentIndexPriceX96,
                globalSideExpect: SHORT,
                tradePriceX96Expect: 158773237678585732538,
                netSizeExpect: priceState.priceVertices[4].size,
                bufferSizeExpect: 200,
                prX96Expect: priceState.priceVertices[4].premiumRateX96,
                pendingVertexIndexExpect: 0,
                currentVertexIndexExpect: 4
            })
        ];

        for (uint i; i < liquidationCases.length; ++i) {
            expectEmitLiquidationBufferNetSizeChangedEvent(4, liquidationCases[i].bufferSizeExpect);
            expectEmitGlobalLiquidityPositionChangedEvent(market, liquidationCases[i]);
            expectEmitPremiumChangedEvent(liquidationCases[i].prX96Expect);
            (tradePriceX96, priceState, globalPosition) = priceUtil.updatePriceState(
                globalPosition,
                priceState,
                packUpdatePriceStateParam(
                    market,
                    liquidationCases[i].side,
                    liquidationCases[i].sizeDelta,
                    liquidationCases[i].indexPriceX96,
                    liquidationVertexIndex,
                    true
                )
            );
            checkResult(liquidationCases[i], tradePriceX96);
        }

        uint256 snapshotWithBuffer = vm.snapshot();

        // ----------------------------------------------------------------
        // Use buffer size when open new position or liquidation
        // ----------------------------------------------------------------
        UpdatePriceStateCase[4] memory useBufferCases = [
            UpdatePriceStateCase({
                id: 120,
                side: SHORT,
                sizeDelta: 50,
                indexPriceX96: currentIndexPriceX96,
                globalSideExpect: SHORT,
                tradePriceX96Expect: 158773237678585732537,
                netSizeExpect: priceState.priceVertices[4].size,
                bufferSizeExpect: 150,
                prX96Expect: priceState.priceVertices[4].premiumRateX96,
                pendingVertexIndexExpect: 0,
                currentVertexIndexExpect: 4
            }),
            UpdatePriceStateCase({
                id: 121,
                side: SHORT,
                sizeDelta: 50,
                indexPriceX96: currentIndexPriceX96,
                globalSideExpect: SHORT,
                tradePriceX96Expect: 158773237678585732537,
                netSizeExpect: priceState.priceVertices[4].size,
                bufferSizeExpect: 100,
                prX96Expect: priceState.priceVertices[4].premiumRateX96,
                pendingVertexIndexExpect: 0,
                currentVertexIndexExpect: 4
            }),
            UpdatePriceStateCase({
                id: 123,
                side: SHORT,
                sizeDelta: 100,
                indexPriceX96: currentIndexPriceX96,
                globalSideExpect: SHORT,
                tradePriceX96Expect: 158773237678585732537,
                netSizeExpect: priceState.priceVertices[4].size,
                bufferSizeExpect: 0,
                prX96Expect: priceState.priceVertices[4].premiumRateX96,
                pendingVertexIndexExpect: 0,
                currentVertexIndexExpect: 4
            }),
            UpdatePriceStateCase({
                id: 124,
                side: SHORT,
                sizeDelta: priceState.priceVertices[4].size,
                indexPriceX96: currentIndexPriceX96,
                globalSideExpect: SHORT,
                tradePriceX96Expect: 158591012904802924560,
                netSizeExpect: 0,
                bufferSizeExpect: 0,
                prX96Expect: 0,
                pendingVertexIndexExpect: 0,
                currentVertexIndexExpect: 0
            })
        ];
        for (uint i; i < useBufferCases.length; ++i) {
            if (i < 3) expectEmitLiquidationBufferNetSizeChangedEvent(4, useBufferCases[i].bufferSizeExpect);
            expectEmitGlobalLiquidityPositionChangedEvent(market, useBufferCases[i]);
            expectEmitPremiumChangedEvent(useBufferCases[i].prX96Expect);
            (tradePriceX96, priceState, globalPosition) = priceUtil.updatePriceState(
                globalPosition,
                priceState,
                packUpdatePriceStateParam(
                    market,
                    useBufferCases[i].side,
                    useBufferCases[i].sizeDelta,
                    useBufferCases[i].indexPriceX96,
                    liquidationVertexIndex,
                    false
                )
            );
            checkResult(useBufferCases[i], tradePriceX96);
        }

        // ----------------------------------------------------------------
        // Use buffer cases run again, but treat as liquidation
        // ----------------------------------------------------------------
        vm.revertTo(snapshotWithBuffer);

        for (uint i; i < useBufferCases.length; ++i) {
            useBufferCases[i].id += 100;
            if (i < 3) expectEmitLiquidationBufferNetSizeChangedEvent(4, useBufferCases[i].bufferSizeExpect);
            expectEmitGlobalLiquidityPositionChangedEvent(market, useBufferCases[i]);
            expectEmitPremiumChangedEvent(useBufferCases[i].prX96Expect);
            (tradePriceX96, priceState, globalPosition) = priceUtil.updatePriceState(
                globalPosition,
                priceState,
                packUpdatePriceStateParam(
                    market,
                    useBufferCases[i].side,
                    useBufferCases[i].sizeDelta,
                    useBufferCases[i].indexPriceX96,
                    liquidationVertexIndex,
                    true
                )
            );
            checkResult(useBufferCases[i], tradePriceX96);
        }

        // ----------------------------------------------------------------
        // LP has short position
        // Use buffer size and cross the origin
        // ----------------------------------------------------------------
        vm.revertTo(snapshotWithBuffer);
        UpdatePriceStateCase memory useBufferCase2 = UpdatePriceStateCase({
            id: 160,
            side: SHORT,
            sizeDelta: priceState.priceVertices[4].size + priceState.priceVertices[1].size + 200,
            indexPriceX96: currentIndexPriceX96,
            globalSideExpect: LONG,
            tradePriceX96Expect: 158541212345508244457,
            netSizeExpect: priceState.priceVertices[1].size,
            bufferSizeExpect: 0,
            prX96Expect: priceState.priceVertices[1].premiumRateX96,
            pendingVertexIndexExpect: 0,
            currentVertexIndexExpect: 1
        });
        expectEmitLiquidationBufferNetSizeChangedEvent(4, 0);
        expectEmitGlobalLiquidityPositionChangedEvent(market, useBufferCase2);
        expectEmitBasisIndexPriceX96ChangedEvent(currentIndexPriceX96);
        expectEmitPremiumChangedEvent(useBufferCase2.prX96Expect);
        (tradePriceX96, priceState, globalPosition) = priceUtil.updatePriceState(
            globalPosition,
            priceState,
            packUpdatePriceStateParam(
                market,
                useBufferCase2.side,
                useBufferCase2.sizeDelta,
                useBufferCase2.indexPriceX96,
                liquidationVertexIndex,
                false
            )
        );
        checkResult(useBufferCase2, tradePriceX96);

        // ----------------------------------------------------------------
        // LP has short position
        // Price continues to move by liquidation
        // and when back, two buffers should all be used
        // ----------------------------------------------------------------
        vm.revertTo(snapshotWithBuffer);
        liquidationVertexIndex = 5;
        expectEmitLiquidationBufferNetSizeChangedEvent(5, 100);
        expectEmitPremiumChangedEvent(priceState.priceVertices[5].premiumRateX96);
        (tradePriceX96, priceState, globalPosition) = priceUtil.updatePriceState(
            globalPosition,
            priceState,
            packUpdatePriceStateParam(
                market,
                LONG,
                priceState.priceVertices[5].size - priceState.priceVertices[4].size + 100,
                currentIndexPriceX96,
                liquidationVertexIndex,
                true
            )
        );
        assertEq(priceState.premiumRateX96, priceState.priceVertices[5].premiumRateX96, "priceState.premiumRateX96");
        assertEq(priceState.liquidationBufferNetSizes[4], 200, "priceState.liquidationBufferNetSizes[4]");
        assertEq(priceState.liquidationBufferNetSizes[5], 100, "priceState.liquidationBufferNetSizes[5]");
        assertEq(globalPosition.liquidationBufferNetSize, 300, "globalPosition.liquidationBufferNetSize");
        assertEq(globalPosition.netSize, priceState.priceVertices[5].size, "globalPosition.netSize");

        UpdatePriceStateCase memory useBufferCase3 = UpdatePriceStateCase({
            id: 170,
            side: SHORT,
            sizeDelta: priceState.priceVertices[5].size - priceState.priceVertices[3].size + 300,
            indexPriceX96: currentIndexPriceX96,
            globalSideExpect: SHORT,
            tradePriceX96Expect: 159294823081804639173,
            netSizeExpect: priceState.priceVertices[3].size,
            bufferSizeExpect: 0,
            prX96Expect: priceState.priceVertices[3].premiumRateX96,
            pendingVertexIndexExpect: 0,
            currentVertexIndexExpect: 3
        });
        expectEmitLiquidationBufferNetSizeChangedEvent(5, 0);
        expectEmitLiquidationBufferNetSizeChangedEvent(4, 0);
        expectEmitGlobalLiquidityPositionChangedEvent(market, useBufferCase3);
        expectEmitPremiumChangedEvent(useBufferCase3.prX96Expect);
        (tradePriceX96, priceState, globalPosition) = priceUtil.updatePriceState(
            globalPosition,
            priceState,
            packUpdatePriceStateParam(
                market,
                useBufferCase3.side,
                useBufferCase3.sizeDelta,
                useBufferCase3.indexPriceX96,
                liquidationVertexIndex,
                false
            )
        );
        checkResult(useBufferCase3, tradePriceX96);
        assertEq(priceState.liquidationBufferNetSizes[4], 0, "priceState.liquidationBufferNetSizes[4]");
        assertEq(priceState.liquidationBufferNetSizes[5], 0, "priceState.liquidationBufferNetSizes[5]");
    }

    // Test update price state, starting from opening short positions, each op moves pr exactly on certain vertex
    // Index price is stable
    function test_updatePriceState_FromShortMoveOnVertex() public {
        uint160 tradePriceX96;
        uint160 currentIndexPriceX96 = Math.mulDiv(2000, Constants.Q96, 1e12).toUint160(); // 2000

        // ----------------------------------------------------------------
        // Move until the limit reached
        // ----------------------------------------------------------------
        UpdatePriceStateCase[6] memory shortCases = [
            UpdatePriceStateCase({
                id: 1,
                side: SHORT,
                sizeDelta: priceState.priceVertices[1].size, // move exactly to v[1] by longing
                indexPriceX96: currentIndexPriceX96,
                globalSideExpect: LONG,
                tradePriceX96Expect: 158416710947271543018,
                netSizeExpect: priceState.priceVertices[1].size,
                bufferSizeExpect: 0,
                prX96Expect: priceState.priceVertices[1].premiumRateX96,
                pendingVertexIndexExpect: 0,
                currentVertexIndexExpect: 1
            }),
            UpdatePriceStateCase({
                id: 2,
                side: SHORT,
                sizeDelta: priceState.priceVertices[2].size - priceState.priceVertices[1].size, // continue moving to v2
                indexPriceX96: currentIndexPriceX96,
                globalSideExpect: LONG,
                tradePriceX96Expect: 158337482784757278680,
                netSizeExpect: priceState.priceVertices[2].size,
                bufferSizeExpect: 0,
                prX96Expect: priceState.priceVertices[2].premiumRateX96,
                pendingVertexIndexExpect: 0,
                currentVertexIndexExpect: 2
            }),
            UpdatePriceStateCase({
                id: 3,
                side: SHORT,
                sizeDelta: priceState.priceVertices[3].size - priceState.priceVertices[2].size, // continue moving to v3
                indexPriceX96: currentIndexPriceX96,
                globalSideExpect: LONG,
                tradePriceX96Expect: 158258254622243014343,
                netSizeExpect: priceState.priceVertices[3].size,
                bufferSizeExpect: 0,
                prX96Expect: priceState.priceVertices[3].premiumRateX96,
                pendingVertexIndexExpect: 0,
                currentVertexIndexExpect: 3
            }),
            UpdatePriceStateCase({
                id: 4,
                side: SHORT,
                sizeDelta: priceState.priceVertices[4].size - priceState.priceVertices[3].size, // continue moving to v4
                indexPriceX96: currentIndexPriceX96,
                globalSideExpect: LONG,
                tradePriceX96Expect: 158179026459728750005,
                netSizeExpect: priceState.priceVertices[4].size,
                bufferSizeExpect: 0,
                prX96Expect: priceState.priceVertices[4].premiumRateX96,
                pendingVertexIndexExpect: 0,
                currentVertexIndexExpect: 4
            }),
            UpdatePriceStateCase({
                id: 5,
                side: SHORT,
                sizeDelta: priceState.priceVertices[5].size - priceState.priceVertices[4].size, // continue moving to v5
                indexPriceX96: currentIndexPriceX96,
                globalSideExpect: LONG,
                tradePriceX96Expect: 157505587078357503135,
                netSizeExpect: priceState.priceVertices[5].size,
                bufferSizeExpect: 0,
                prX96Expect: priceState.priceVertices[5].premiumRateX96,
                pendingVertexIndexExpect: 0,
                currentVertexIndexExpect: 5
            }),
            UpdatePriceStateCase({
                id: 6,
                side: SHORT,
                sizeDelta: priceState.priceVertices[9].size - priceState.priceVertices[5].size, // move directly to v9
                indexPriceX96: currentIndexPriceX96,
                globalSideExpect: LONG,
                tradePriceX96Expect: 145779819026246381171,
                netSizeExpect: priceState.priceVertices[9].size,
                bufferSizeExpect: 0,
                prX96Expect: priceState.priceVertices[9].premiumRateX96,
                pendingVertexIndexExpect: 0,
                currentVertexIndexExpect: 9
            })
        ];

        uint256 snapshotAtV4;
        for (uint i = 0; i < shortCases.length; ++i) {
            expectEmitGlobalLiquidityPositionChangedEvent(market, shortCases[i]);
            if (i == 0) expectEmitBasisIndexPriceX96ChangedEvent(currentIndexPriceX96);
            expectEmitPremiumChangedEvent(shortCases[i].prX96Expect);
            (tradePriceX96, priceState, globalPosition) = priceUtil.updatePriceState(
                globalPosition,
                priceState,
                packUpdatePriceStateParam(
                    market,
                    shortCases[i].side,
                    shortCases[i].sizeDelta,
                    shortCases[i].indexPriceX96,
                    liquidationVertexIndex,
                    false
                )
            );
            checkResult(shortCases[i], tradePriceX96);
            if (i == 3) snapshotAtV4 = vm.snapshot(); // choose a point to take snapshot for later liquidation tests
        }
        uint256 snapshotAtV9 = vm.snapshot();

        // ----------------------------------------------------------------
        // Continue to short, expect to revert
        // ----------------------------------------------------------------
        vm.expectRevert(IMarketErrors.MaxPremiumRateExceeded.selector);
        priceUtil.updatePriceState(
            globalPosition,
            priceState,
            packUpdatePriceStateParam(market, SHORT, 1, currentIndexPriceX96, liquidationVertexIndex, false)
        );

        // ----------------------------------------------------------------
        // Move back to the origin step by step
        // ----------------------------------------------------------------
        UpdatePriceStateCase[6] memory longCases = [
            UpdatePriceStateCase({
                id: 97,
                side: LONG,
                sizeDelta: priceState.priceVertices[9].size - priceState.priceVertices[5].size,
                indexPriceX96: currentIndexPriceX96,
                globalSideExpect: LONG,
                tradePriceX96Expect: 145779819026246381173,
                netSizeExpect: priceState.priceVertices[5].size,
                bufferSizeExpect: 0,
                prX96Expect: priceState.priceVertices[5].premiumRateX96,
                pendingVertexIndexExpect: 0,
                currentVertexIndexExpect: 5
            }),
            UpdatePriceStateCase({
                id: 98,
                side: LONG,
                sizeDelta: priceState.priceVertices[5].size - priceState.priceVertices[4].size,
                indexPriceX96: currentIndexPriceX96,
                globalSideExpect: LONG,
                tradePriceX96Expect: 157505587078357503136,
                netSizeExpect: priceState.priceVertices[4].size,
                bufferSizeExpect: 0,
                prX96Expect: priceState.priceVertices[4].premiumRateX96,
                pendingVertexIndexExpect: 0,
                currentVertexIndexExpect: 4
            }),
            UpdatePriceStateCase({
                id: 99,
                side: LONG,
                sizeDelta: priceState.priceVertices[4].size - priceState.priceVertices[3].size,
                indexPriceX96: currentIndexPriceX96,
                globalSideExpect: LONG,
                tradePriceX96Expect: 158179026459728750006,
                netSizeExpect: priceState.priceVertices[3].size,
                bufferSizeExpect: 0,
                prX96Expect: priceState.priceVertices[3].premiumRateX96,
                pendingVertexIndexExpect: 0,
                currentVertexIndexExpect: 3
            }),
            UpdatePriceStateCase({
                id: 197,
                side: LONG,
                sizeDelta: priceState.priceVertices[3].size - priceState.priceVertices[2].size,
                indexPriceX96: currentIndexPriceX96,
                globalSideExpect: LONG,
                tradePriceX96Expect: 158258254622243014344,
                netSizeExpect: priceState.priceVertices[2].size,
                bufferSizeExpect: 0,
                prX96Expect: priceState.priceVertices[2].premiumRateX96,
                pendingVertexIndexExpect: 0,
                currentVertexIndexExpect: 2
            }),
            UpdatePriceStateCase({
                id: 198,
                side: LONG,
                sizeDelta: priceState.priceVertices[2].size - priceState.priceVertices[1].size,
                indexPriceX96: currentIndexPriceX96,
                globalSideExpect: LONG,
                tradePriceX96Expect: 158337482784757278681,
                netSizeExpect: priceState.priceVertices[1].size,
                bufferSizeExpect: 0,
                prX96Expect: priceState.priceVertices[1].premiumRateX96,
                pendingVertexIndexExpect: 0,
                currentVertexIndexExpect: 1
            }),
            UpdatePriceStateCase({
                id: 199,
                side: LONG,
                sizeDelta: priceState.priceVertices[1].size - priceState.priceVertices[0].size,
                indexPriceX96: currentIndexPriceX96,
                globalSideExpect: LONG,
                tradePriceX96Expect: 158416710947271543019,
                netSizeExpect: priceState.priceVertices[0].size,
                bufferSizeExpect: 0,
                prX96Expect: priceState.priceVertices[0].premiumRateX96,
                pendingVertexIndexExpect: 0,
                currentVertexIndexExpect: 0
            })
        ];

        for (uint i = 0; i < longCases.length; ++i) {
            expectEmitGlobalLiquidityPositionChangedEvent(market, longCases[i]);
            expectEmitPremiumChangedEvent(longCases[i].prX96Expect);
            (tradePriceX96, priceState, globalPosition) = priceUtil.updatePriceState(
                globalPosition,
                priceState,
                packUpdatePriceStateParam(
                    market,
                    longCases[i].side,
                    longCases[i].sizeDelta,
                    longCases[i].indexPriceX96,
                    liquidationVertexIndex,
                    false
                )
            );
            checkResult(longCases[i], tradePriceX96);
        }

        // ----------------------------------------------------------------
        // Move cross the origin to another side
        // ----------------------------------------------------------------
        expectEmitBasisIndexPriceX96ChangedEvent(currentIndexPriceX96);
        (, priceState, globalPosition) = priceUtil.updatePriceState(
            globalPosition,
            priceState,
            packUpdatePriceStateParam(market, LONG, 1, currentIndexPriceX96, liquidationVertexIndex, false)
        );
        assertEq(Side.unwrap(globalPosition.side), Side.unwrap(SHORT), "side");
        assertEq(globalPosition.netSize, 1, "netSize");
        assertEq(priceState.currentVertexIndex, 1, "currentVertexIndex");
        assertEq(priceState.pendingVertexIndex, 0, "pendingVertexIndex");

        // ----------------------------------------------------------------
        // Move a single step and cross the origin without using liquidation buffer
        // ----------------------------------------------------------------
        vm.revertTo(snapshotAtV4);
        UpdatePriceStateCase memory crossCase = UpdatePriceStateCase({
            id: 9,
            side: LONG,
            sizeDelta: priceState.priceVertices[4].size + priceState.priceVertices[1].size,
            indexPriceX96: currentIndexPriceX96,
            globalSideExpect: SHORT, // lp should have an opposite position which is short
            tradePriceX96Expect: 158371437711549106255,
            netSizeExpect: priceState.priceVertices[1].size,
            bufferSizeExpect: 0,
            prX96Expect: priceState.priceVertices[1].premiumRateX96,
            pendingVertexIndexExpect: 0,
            currentVertexIndexExpect: 1
        });
        expectEmitGlobalLiquidityPositionChangedEvent(market, crossCase);
        expectEmitBasisIndexPriceX96ChangedEvent(crossCase.indexPriceX96);
        expectEmitPremiumChangedEvent(crossCase.prX96Expect);
        (tradePriceX96, priceState, globalPosition) = priceUtil.updatePriceState(
            globalPosition,
            priceState,
            packUpdatePriceStateParam(
                market,
                crossCase.side,
                crossCase.sizeDelta,
                crossCase.indexPriceX96,
                liquidationVertexIndex,
                false
            )
        );
        checkResult(crossCase, tradePriceX96);

        // ----------------------------------------------------------------
        // Move a single step and cross the origin to the limit
        // ----------------------------------------------------------------
        vm.revertTo(snapshotAtV4);
        UpdatePriceStateCase memory crossAndRevertCase = UpdatePriceStateCase({
            id: 290,
            side: LONG,
            sizeDelta: priceState.priceVertices[4].size + priceState.priceVertices[9].size,
            indexPriceX96: currentIndexPriceX96,
            globalSideExpect: SHORT,
            tradePriceX96Expect: 169367174837635935394,
            netSizeExpect: priceState.priceVertices[9].size,
            bufferSizeExpect: 0,
            prX96Expect: priceState.priceVertices[9].premiumRateX96,
            pendingVertexIndexExpect: 0,
            currentVertexIndexExpect: 9
        });

        expectEmitGlobalLiquidityPositionChangedEvent(market, crossAndRevertCase);
        expectEmitBasisIndexPriceX96ChangedEvent(crossAndRevertCase.indexPriceX96);
        expectEmitPremiumChangedEvent(crossAndRevertCase.prX96Expect);
        (tradePriceX96, priceState, globalPosition) = priceUtil.updatePriceState(
            globalPosition,
            priceState,
            packUpdatePriceStateParam(
                market,
                crossAndRevertCase.side,
                crossAndRevertCase.sizeDelta,
                crossAndRevertCase.indexPriceX96,
                liquidationVertexIndex,
                false
            )
        );
        checkResult(crossAndRevertCase, tradePriceX96);

        vm.expectRevert(IMarketErrors.MaxPremiumRateExceeded.selector);
        priceUtil.updatePriceState(
            globalPosition,
            priceState,
            packUpdatePriceStateParam(market, LONG, 1, currentIndexPriceX96, liquidationVertexIndex, false)
        );

        // ----------------------------------------------------------------
        // Liquidation tests
        // Now price is in v4 and lp has a long position
        // Liquidation that should use the liquidation buffer
        // The liquidation price should also be checked
        // ----------------------------------------------------------------
        vm.revertTo(snapshotAtV4);
        UpdatePriceStateCase[2] memory liquidationCases = [
            UpdatePriceStateCase({
                id: 10,
                side: SHORT,
                sizeDelta: 100,
                indexPriceX96: currentIndexPriceX96,
                globalSideExpect: LONG,
                tradePriceX96Expect: 158139412378471617836,
                netSizeExpect: priceState.priceVertices[4].size,
                bufferSizeExpect: 100,
                prX96Expect: priceState.priceVertices[4].premiumRateX96,
                pendingVertexIndexExpect: 0,
                currentVertexIndexExpect: 4
            }),
            UpdatePriceStateCase({
                id: 11,
                side: SHORT,
                sizeDelta: 100,
                indexPriceX96: currentIndexPriceX96,
                globalSideExpect: LONG,
                tradePriceX96Expect: 158139412378471617836,
                netSizeExpect: priceState.priceVertices[4].size,
                bufferSizeExpect: 200,
                prX96Expect: priceState.priceVertices[4].premiumRateX96,
                pendingVertexIndexExpect: 0,
                currentVertexIndexExpect: 4
            })
        ];
        for (uint i; i < liquidationCases.length; ++i) {
            expectEmitLiquidationBufferNetSizeChangedEvent(4, liquidationCases[i].bufferSizeExpect);
            expectEmitGlobalLiquidityPositionChangedEvent(market, liquidationCases[i]);
            expectEmitPremiumChangedEvent(liquidationCases[i].prX96Expect);
            (tradePriceX96, priceState, globalPosition) = priceUtil.updatePriceState(
                globalPosition,
                priceState,
                packUpdatePriceStateParam(
                    market,
                    liquidationCases[i].side,
                    liquidationCases[i].sizeDelta,
                    liquidationCases[i].indexPriceX96,
                    liquidationVertexIndex,
                    true
                )
            );
            checkResult(liquidationCases[i], tradePriceX96);
        }

        uint256 snapshotWithBuffer = vm.snapshot();

        // ----------------------------------------------------------------
        // Use buffer size when open new position or liquidation
        // ----------------------------------------------------------------
        UpdatePriceStateCase[4] memory useBufferCases = [
            UpdatePriceStateCase({
                id: 1201,
                side: LONG,
                sizeDelta: 50,
                indexPriceX96: currentIndexPriceX96,
                globalSideExpect: LONG,
                tradePriceX96Expect: 158139412378471617837,
                netSizeExpect: priceState.priceVertices[4].size,
                bufferSizeExpect: 150,
                prX96Expect: priceState.priceVertices[4].premiumRateX96,
                pendingVertexIndexExpect: 0,
                currentVertexIndexExpect: 4
            }),
            UpdatePriceStateCase({
                id: 1301,
                side: LONG,
                sizeDelta: 50,
                indexPriceX96: currentIndexPriceX96,
                globalSideExpect: LONG,
                tradePriceX96Expect: 158139412378471617837,
                netSizeExpect: priceState.priceVertices[4].size,
                bufferSizeExpect: 100,
                prX96Expect: priceState.priceVertices[4].premiumRateX96,
                pendingVertexIndexExpect: 0,
                currentVertexIndexExpect: 4
            }),
            UpdatePriceStateCase({
                id: 1401,
                side: LONG,
                sizeDelta: 100,
                indexPriceX96: currentIndexPriceX96,
                globalSideExpect: LONG,
                tradePriceX96Expect: 158139412378471617837,
                netSizeExpect: priceState.priceVertices[4].size,
                bufferSizeExpect: 0,
                prX96Expect: priceState.priceVertices[4].premiumRateX96,
                pendingVertexIndexExpect: 0,
                currentVertexIndexExpect: 4
            }),
            UpdatePriceStateCase({
                id: 1501,
                side: LONG,
                sizeDelta: priceState.priceVertices[4].size,
                indexPriceX96: currentIndexPriceX96,
                globalSideExpect: LONG,
                tradePriceX96Expect: 158321637152254425814,
                netSizeExpect: 0,
                bufferSizeExpect: 0,
                prX96Expect: 0,
                pendingVertexIndexExpect: 0,
                currentVertexIndexExpect: 0
            })
        ];

        for (uint i; i < useBufferCases.length; ++i) {
            if (i < 3) expectEmitLiquidationBufferNetSizeChangedEvent(4, useBufferCases[i].bufferSizeExpect);
            expectEmitGlobalLiquidityPositionChangedEvent(market, useBufferCases[i]);
            expectEmitPremiumChangedEvent(useBufferCases[i].prX96Expect);
            (tradePriceX96, priceState, globalPosition) = priceUtil.updatePriceState(
                globalPosition,
                priceState,
                packUpdatePriceStateParam(
                    market,
                    useBufferCases[i].side,
                    useBufferCases[i].sizeDelta,
                    useBufferCases[i].indexPriceX96,
                    liquidationVertexIndex,
                    false
                )
            );
            checkResult(useBufferCases[i], tradePriceX96);
        }

        // ----------------------------------------------------------------
        // Use buffer cases run again, but treat as liquidation
        // ----------------------------------------------------------------
        vm.revertTo(snapshotWithBuffer);
        for (uint i; i < useBufferCases.length; ++i) {
            if (i < 3) expectEmitLiquidationBufferNetSizeChangedEvent(4, useBufferCases[i].bufferSizeExpect);
            expectEmitGlobalLiquidityPositionChangedEvent(market, useBufferCases[i]);
            expectEmitPremiumChangedEvent(useBufferCases[i].prX96Expect);
            (tradePriceX96, priceState, globalPosition) = priceUtil.updatePriceState(
                globalPosition,
                priceState,
                packUpdatePriceStateParam(
                    market,
                    useBufferCases[i].side,
                    useBufferCases[i].sizeDelta,
                    useBufferCases[i].indexPriceX96,
                    liquidationVertexIndex,
                    true
                )
            );
            checkResult(useBufferCases[i], tradePriceX96);
        }

        // ----------------------------------------------------------------
        // Use buffer size and cross the origin
        // ----------------------------------------------------------------
        vm.revertTo(snapshotWithBuffer);
        UpdatePriceStateCase memory useBufferCase2 = UpdatePriceStateCase({
            id: 16,
            side: LONG,
            sizeDelta: priceState.priceVertices[4].size + priceState.priceVertices[1].size + 200,
            indexPriceX96: currentIndexPriceX96,
            globalSideExpect: SHORT,
            tradePriceX96Expect: 158371437711549105917,
            netSizeExpect: priceState.priceVertices[1].size,
            bufferSizeExpect: 0,
            prX96Expect: priceState.priceVertices[1].premiumRateX96,
            pendingVertexIndexExpect: 0,
            currentVertexIndexExpect: 1
        });

        expectEmitLiquidationBufferNetSizeChangedEvent(4, 0);
        expectEmitGlobalLiquidityPositionChangedEvent(market, useBufferCase2);
        expectEmitBasisIndexPriceX96ChangedEvent(useBufferCase2.indexPriceX96);
        expectEmitPremiumChangedEvent(useBufferCase2.prX96Expect);
        (tradePriceX96, priceState, globalPosition) = priceUtil.updatePriceState(
            globalPosition,
            priceState,
            packUpdatePriceStateParam(
                market,
                useBufferCase2.side,
                useBufferCase2.sizeDelta,
                useBufferCase2.indexPriceX96,
                liquidationVertexIndex,
                true
            )
        );
        checkResult(useBufferCase2, tradePriceX96);

        // ----------------------------------------------------------------
        // Revert to v4 which has buffer size, update liquidation buffer index
        // Price continues to move by liquidation and when back, two buffers should all be consumed
        // ----------------------------------------------------------------
        vm.revertTo(snapshotWithBuffer);
        liquidationVertexIndex = 6;
        expectEmitLiquidationBufferNetSizeChangedEvent(6, 1500);
        expectEmitPremiumChangedEvent(priceState.priceVertices[6].premiumRateX96);
        (tradePriceX96, priceState, globalPosition) = priceUtil.updatePriceState(
            globalPosition,
            priceState,
            packUpdatePriceStateParam(
                market,
                SHORT,
                priceState.priceVertices[6].size - priceState.priceVertices[4].size + 1500,
                currentIndexPriceX96,
                liquidationVertexIndex,
                true
            )
        );
        assertEq(tradePriceX96, 156554849128186324623, "trade price x96");
        assertEq(priceState.premiumRateX96, priceState.priceVertices[6].premiumRateX96, "priceState.premiumRateX96");
        assertEq(priceState.liquidationBufferNetSizes[4], 200, "priceState.liquidationBufferNetSizes[4]");
        assertEq(priceState.liquidationBufferNetSizes[5], 0, "priceState.liquidationBufferNetSizes[5]");
        assertEq(priceState.liquidationBufferNetSizes[6], 1500, "priceState.liquidationBufferNetSizes[6]");
        assertEq(globalPosition.liquidationBufferNetSize, 1700, "globalPosition.liquidationBufferNetSize");
        assertEq(globalPosition.netSize, priceState.priceVertices[6].size, "globalPosition.netSize");

        // Move to v5 first
        UpdatePriceStateCase memory useBufferCase3 = UpdatePriceStateCase({
            id: 1700,
            side: LONG,
            sizeDelta: priceState.priceVertices[6].size - priceState.priceVertices[5].size + 1500,
            indexPriceX96: currentIndexPriceX96,
            globalSideExpect: LONG,
            tradePriceX96Expect: 156079480153100739003,
            netSizeExpect: priceState.priceVertices[5].size,
            bufferSizeExpect: 200,
            prX96Expect: priceState.priceVertices[5].premiumRateX96,
            pendingVertexIndexExpect: 0,
            currentVertexIndexExpect: 5
        });
        expectEmitLiquidationBufferNetSizeChangedEvent(6, 0);
        expectEmitGlobalLiquidityPositionChangedEvent(market, useBufferCase3);
        expectEmitPremiumChangedEvent(useBufferCase3.prX96Expect);
        (tradePriceX96, priceState, globalPosition) = priceUtil.updatePriceState(
            globalPosition,
            priceState,
            packUpdatePriceStateParam(
                market,
                useBufferCase3.side,
                useBufferCase3.sizeDelta,
                useBufferCase3.indexPriceX96,
                liquidationVertexIndex,
                false
            )
        );
        checkResult(useBufferCase3, tradePriceX96);
        assertEq(priceState.liquidationBufferNetSizes[6], 0, "priceState.liquidationBufferNetSizes[4]");
        assertEq(priceState.liquidationBufferNetSizes[5], 0, "priceState.liquidationBufferNetSizes[5]");
        assertEq(priceState.liquidationBufferNetSizes[4], 200, "priceState.liquidationBufferNetSizes[4]");

        // Move to v3 from v5
        UpdatePriceStateCase memory useBufferCase4 = UpdatePriceStateCase({
            id: 171,
            side: LONG,
            sizeDelta: priceState.priceVertices[5].size - priceState.priceVertices[3].size + 200,
            indexPriceX96: currentIndexPriceX96,
            globalSideExpect: LONG,
            tradePriceX96Expect: 157617826975252711834,
            netSizeExpect: priceState.priceVertices[3].size,
            bufferSizeExpect: 0,
            prX96Expect: priceState.priceVertices[3].premiumRateX96,
            pendingVertexIndexExpect: 0,
            currentVertexIndexExpect: 3
        });
        expectEmitLiquidationBufferNetSizeChangedEvent(4, 0);
        expectEmitGlobalLiquidityPositionChangedEvent(market, useBufferCase4);
        expectEmitPremiumChangedEvent(useBufferCase4.prX96Expect);
        (tradePriceX96, priceState, globalPosition) = priceUtil.updatePriceState(
            globalPosition,
            priceState,
            packUpdatePriceStateParam(
                market,
                useBufferCase4.side,
                useBufferCase4.sizeDelta,
                useBufferCase4.indexPriceX96,
                liquidationVertexIndex,
                false
            )
        );
        checkResult(useBufferCase4, tradePriceX96);

        for (uint i; i < priceState.liquidationBufferNetSizes.length; ++i) {
            assertEq(priceState.liquidationBufferNetSizes[i], 0, "liquidation buffer");
        }

        // ----------------------------------------------------------------
        // Liquidation, current vertex index > liquidation vertex index
        // should not update the current vertex index
        // ----------------------------------------------------------------
        vm.revertTo(snapshotAtV9);
        expectEmitLiquidationBufferNetSizeChangedEvent(4, 100);
        expectEmitPremiumChangedEvent(priceState.priceVertices[9].premiumRateX96);
        (tradePriceX96, priceState, globalPosition) = priceUtil.updatePriceState(
            globalPosition,
            priceState,
            packUpdatePriceStateParam(market, SHORT, 100, currentIndexPriceX96, liquidationVertexIndex, true)
        );
        assertEq(tradePriceX96, 158139412378471617836, "trade price x96");
        assertEq(priceState.currentVertexIndex, 9, "current vertex index");
        assertEq(priceState.liquidationBufferNetSizes[4], 100);
    }

    // Test update price state, starting from opening long positions, each op moves pr to a random position
    // Index price is stable
    function test_updatePriceState_FromLongMoveRandom() public {
        uint160 tradePriceX96;
        uint160 currentIndexPriceX96 = Math.mulDiv(2000, Constants.Q96, 1e12).toUint160(); // 158456325028528675187
        UpdatePriceStateCase[6] memory longCases = [
            UpdatePriceStateCase({
                id: 1,
                side: LONG,
                sizeDelta: 38138929010007018, // move to somewhere between v0 and v1
                indexPriceX96: currentIndexPriceX96,
                globalSideExpect: SHORT,
                tradePriceX96Expect: 158494828592998474496,
                netSizeExpect: 38138929010007018,
                bufferSizeExpect: 0,
                prX96Expect: 38503564469799308458487564,
                pendingVertexIndexExpect: 0,
                currentVertexIndexExpect: 1
            }),
            UpdatePriceStateCase({
                id: 2,
                side: LONG,
                sizeDelta: 19719274506993885, // between v1 and v2
                indexPriceX96: currentIndexPriceX96,
                globalSideExpect: SHORT,
                tradePriceX96Expect: 158570988681606472471,
                netSizeExpect: 57858203517000903,
                bufferSizeExpect: 0,
                prX96Expect: 77208657453705240041395759,
                pendingVertexIndexExpect: 0,
                currentVertexIndexExpect: 2
            }),
            UpdatePriceStateCase({
                id: 3,
                side: LONG,
                sizeDelta: 17619643503099099, // between v2 and v3
                indexPriceX96: currentIndexPriceX96,
                globalSideExpect: SHORT,
                tradePriceX96Expect: 158646318543249061583,
                netSizeExpect: 75477847020100002,
                bufferSizeExpect: 0,
                prX96Expect: 112784857266681155216142940,
                pendingVertexIndexExpect: 0,
                currentVertexIndexExpect: 3
            }),
            UpdatePriceStateCase({
                id: 4,
                side: LONG,
                sizeDelta: 15619476506910376, // between v3 and v4
                indexPriceX96: currentIndexPriceX96,
                globalSideExpect: SHORT,
                tradePriceX96Expect: 158713432362826375432,
                netSizeExpect: 91097323527010378,
                bufferSizeExpect: 0,
                prX96Expect: 144322477031019089387325820,
                pendingVertexIndexExpect: 0,
                currentVertexIndexExpect: 4
            }),
            UpdatePriceStateCase({
                id: 5,
                side: LONG,
                sizeDelta: 95097321523069629, // between v4 and v5
                indexPriceX96: currentIndexPriceX96,
                globalSideExpect: SHORT,
                tradePriceX96Expect: 159299511605362266026,
                netSizeExpect: 186194645050080007,
                bufferSizeExpect: 0,
                prX96Expect: 727669739334290763645858707,
                pendingVertexIndexExpect: 0,
                currentVertexIndexExpect: 5
            }),
            UpdatePriceStateCase({
                id: 6,
                side: LONG,
                sizeDelta: 1665751805449927001, // between v8 and v9
                indexPriceX96: currentIndexPriceX96,
                globalSideExpect: SHORT,
                tradePriceX96Expect: 169907970739738972461,
                netSizeExpect: 1851946450500007008,
                bufferSizeExpect: 0,
                prX96Expect: 14364943453066367938211883505,
                pendingVertexIndexExpect: 0,
                currentVertexIndexExpect: 9
            })
        ];

        for (uint i = 0; i < longCases.length; ++i) {
            (tradePriceX96, priceState, globalPosition) = priceUtil.updatePriceState(
                globalPosition,
                priceState,
                packUpdatePriceStateParam(
                    market,
                    longCases[i].side,
                    longCases[i].sizeDelta,
                    longCases[i].indexPriceX96,
                    liquidationVertexIndex,
                    false
                )
            );
            checkResult(longCases[i], tradePriceX96);
        }

        // Step back
        // Trade price got worse due to precision fault
        // Cases are run in a reverse order
        UpdatePriceStateCase[6] memory shortCases = [
            UpdatePriceStateCase({
                id: 11,
                side: SHORT,
                sizeDelta: 38138929010007018,
                indexPriceX96: currentIndexPriceX96,
                globalSideExpect: SHORT,
                tradePriceX96Expect: 158494828592998474495,
                netSizeExpect: 0,
                bufferSizeExpect: 0,
                prX96Expect: 0,
                pendingVertexIndexExpect: 0,
                currentVertexIndexExpect: 0
            }),
            UpdatePriceStateCase({
                id: 12,
                side: SHORT,
                sizeDelta: 19719274506993885,
                indexPriceX96: currentIndexPriceX96,
                globalSideExpect: SHORT,
                tradePriceX96Expect: 158570988681606472469,
                netSizeExpect: 38138929010007018, // v0..v1
                bufferSizeExpect: 0,
                prX96Expect: 38503564469799308458487564,
                pendingVertexIndexExpect: 0,
                currentVertexIndexExpect: 1
            }),
            UpdatePriceStateCase({
                id: 13,
                side: SHORT,
                sizeDelta: 17619643503099099,
                indexPriceX96: currentIndexPriceX96,
                globalSideExpect: SHORT,
                tradePriceX96Expect: 158646318543249061581,
                netSizeExpect: 57858203517000903, // v1..v2
                bufferSizeExpect: 0,
                prX96Expect: 77208657453705240041395759,
                pendingVertexIndexExpect: 0,
                currentVertexIndexExpect: 2
            }),
            UpdatePriceStateCase({
                id: 14,
                side: SHORT,
                sizeDelta: 15619476506910376,
                indexPriceX96: currentIndexPriceX96,
                globalSideExpect: SHORT,
                tradePriceX96Expect: 158713432362826375430,
                netSizeExpect: 75477847020100002, // v2..v3
                bufferSizeExpect: 0,
                prX96Expect: 112784857266681155216142940,
                pendingVertexIndexExpect: 0,
                currentVertexIndexExpect: 3
            }),
            UpdatePriceStateCase({
                id: 15,
                side: SHORT,
                sizeDelta: 95097321523069629,
                indexPriceX96: currentIndexPriceX96,
                globalSideExpect: SHORT,
                tradePriceX96Expect: 159299511605362266024,
                netSizeExpect: 91097323527010378, // v3..v4
                bufferSizeExpect: 0,
                prX96Expect: 144322477031019089387325820,
                pendingVertexIndexExpect: 0,
                currentVertexIndexExpect: 4
            }),
            UpdatePriceStateCase({
                id: 16,
                side: SHORT,
                sizeDelta: 1665751805449927001,
                indexPriceX96: currentIndexPriceX96,
                globalSideExpect: SHORT,
                tradePriceX96Expect: 169907970739738972459,
                netSizeExpect: 186194645050080007, // v4..v5
                bufferSizeExpect: 0,
                prX96Expect: 727669739334290763645858707,
                pendingVertexIndexExpect: 0,
                currentVertexIndexExpect: 5
            })
        ];

        for (uint i = shortCases.length - 1; i >= 0; --i) {
            (tradePriceX96, priceState, globalPosition) = priceUtil.updatePriceState(
                globalPosition,
                priceState,
                packUpdatePriceStateParam(
                    market,
                    shortCases[i].side,
                    shortCases[i].sizeDelta,
                    shortCases[i].indexPriceX96,
                    liquidationVertexIndex,
                    false
                )
            );
            checkResult(shortCases[i], tradePriceX96);
            if (i == 0) break;
        }
    }

    // Test update price state, starting from opening short positions, each op moves pr to a random position
    // Index price is stable
    function test_updatePriceState_FromShortMoveRandom() public {
        uint160 tradePriceX96;
        uint160 currentIndexPriceX96 = Math.mulDiv(2000, Constants.Q96, 1e12).toUint160(); // 2000
        UpdatePriceStateCase[6] memory shortCases = [
            UpdatePriceStateCase({
                id: 1,
                side: SHORT,
                sizeDelta: 38138929010007018, // move to somewhere between v0 and v1
                indexPriceX96: currentIndexPriceX96,
                globalSideExpect: LONG,
                tradePriceX96Expect: 158417821464058875878,
                netSizeExpect: 38138929010007018,
                bufferSizeExpect: 0,
                prX96Expect: 38503564469799308458487564,
                pendingVertexIndexExpect: 0,
                currentVertexIndexExpect: 1
            }),
            UpdatePriceStateCase({
                id: 2,
                side: SHORT,
                sizeDelta: 19719274506993885, // between v1 and v2
                indexPriceX96: currentIndexPriceX96,
                globalSideExpect: LONG,
                tradePriceX96Expect: 158341661375450877903,
                netSizeExpect: 57858203517000903,
                bufferSizeExpect: 0,
                prX96Expect: 77208657453705240041395759,
                pendingVertexIndexExpect: 0,
                currentVertexIndexExpect: 2
            }),
            UpdatePriceStateCase({
                id: 3,
                side: SHORT,
                sizeDelta: 17619643503099099, // between v2 and v3
                indexPriceX96: currentIndexPriceX96,
                globalSideExpect: LONG,
                tradePriceX96Expect: 158266331513808288791,
                netSizeExpect: 75477847020100002,
                bufferSizeExpect: 0,
                prX96Expect: 112784857266681155216142940,
                pendingVertexIndexExpect: 0,
                currentVertexIndexExpect: 3
            }),
            UpdatePriceStateCase({
                id: 4,
                side: SHORT,
                sizeDelta: 15619476506910376, // between v3 and v4
                indexPriceX96: currentIndexPriceX96,
                globalSideExpect: LONG,
                tradePriceX96Expect: 158199217694230974942,
                netSizeExpect: 91097323527010378,
                bufferSizeExpect: 0,
                prX96Expect: 144322477031019089387325820,
                pendingVertexIndexExpect: 0,
                currentVertexIndexExpect: 4
            }),
            UpdatePriceStateCase({
                id: 5,
                side: SHORT,
                sizeDelta: 95097321523069629, // between v4 and v5
                indexPriceX96: currentIndexPriceX96,
                globalSideExpect: LONG,
                tradePriceX96Expect: 157613138451695084348,
                netSizeExpect: 186194645050080007,
                bufferSizeExpect: 0,
                prX96Expect: 727669739334290763645858707,
                pendingVertexIndexExpect: 0,
                currentVertexIndexExpect: 5
            }),
            UpdatePriceStateCase({
                id: 6,
                side: SHORT,
                sizeDelta: 1665751805449927001, // between v8 and v9
                indexPriceX96: currentIndexPriceX96,
                globalSideExpect: LONG,
                tradePriceX96Expect: 147004679317318377913,
                netSizeExpect: 1851946450500007008,
                bufferSizeExpect: 0,
                prX96Expect: 14364943453066367938211883505,
                pendingVertexIndexExpect: 0,
                currentVertexIndexExpect: 9
            })
        ];

        for (uint i = 0; i < shortCases.length; ++i) {
            (tradePriceX96, priceState, globalPosition) = priceUtil.updatePriceState(
                globalPosition,
                priceState,
                packUpdatePriceStateParam(
                    market,
                    shortCases[i].side,
                    shortCases[i].sizeDelta,
                    shortCases[i].indexPriceX96,
                    liquidationVertexIndex,
                    false
                )
            );
            checkResult(shortCases[i], tradePriceX96);
        }

        // Step back
        // Trade price got worse due to precision fault
        // Cases are run in a reverse order
        UpdatePriceStateCase[6] memory longCases = [
            UpdatePriceStateCase({
                id: 11,
                side: LONG,
                sizeDelta: 38138929010007018,
                indexPriceX96: currentIndexPriceX96,
                globalSideExpect: LONG,
                tradePriceX96Expect: 158417821464058875879,
                netSizeExpect: 0,
                bufferSizeExpect: 0,
                prX96Expect: 0,
                pendingVertexIndexExpect: 0,
                currentVertexIndexExpect: 0
            }),
            UpdatePriceStateCase({
                id: 12,
                side: LONG,
                sizeDelta: 19719274506993885,
                indexPriceX96: currentIndexPriceX96,
                globalSideExpect: LONG,
                tradePriceX96Expect: 158341661375450877905,
                netSizeExpect: 38138929010007018, // v0..v1
                bufferSizeExpect: 0,
                prX96Expect: 38503564469799308458487564,
                pendingVertexIndexExpect: 0,
                currentVertexIndexExpect: 1
            }),
            UpdatePriceStateCase({
                id: 13,
                side: LONG,
                sizeDelta: 17619643503099099,
                indexPriceX96: currentIndexPriceX96,
                globalSideExpect: LONG,
                tradePriceX96Expect: 158266331513808288793,
                netSizeExpect: 57858203517000903, // v1..v2
                bufferSizeExpect: 0,
                prX96Expect: 77208657453705240041395759,
                pendingVertexIndexExpect: 0,
                currentVertexIndexExpect: 2
            }),
            UpdatePriceStateCase({
                id: 14,
                side: LONG,
                sizeDelta: 15619476506910376,
                indexPriceX96: currentIndexPriceX96,
                globalSideExpect: LONG,
                tradePriceX96Expect: 158199217694230974944,
                netSizeExpect: 75477847020100002, // v2..v3
                bufferSizeExpect: 0,
                prX96Expect: 112784857266681155216142940,
                pendingVertexIndexExpect: 0,
                currentVertexIndexExpect: 3
            }),
            UpdatePriceStateCase({
                id: 15,
                side: LONG,
                sizeDelta: 95097321523069629,
                indexPriceX96: currentIndexPriceX96,
                globalSideExpect: LONG,
                tradePriceX96Expect: 157613138451695084350,
                netSizeExpect: 91097323527010378, // v3..v4
                bufferSizeExpect: 0,
                prX96Expect: 144322477031019089387325820,
                pendingVertexIndexExpect: 0,
                currentVertexIndexExpect: 4
            }),
            UpdatePriceStateCase({
                id: 16,
                side: LONG,
                sizeDelta: 1665751805449927001,
                indexPriceX96: currentIndexPriceX96,
                globalSideExpect: LONG,
                tradePriceX96Expect: 147004679317318377915,
                netSizeExpect: 186194645050080007, // v4..v5
                bufferSizeExpect: 0,
                prX96Expect: 727669739334290763645858707,
                pendingVertexIndexExpect: 0,
                currentVertexIndexExpect: 5
            })
        ];

        for (uint i = longCases.length - 1; i >= 0; --i) {
            (tradePriceX96, priceState, globalPosition) = priceUtil.updatePriceState(
                globalPosition,
                priceState,
                packUpdatePriceStateParam(
                    market,
                    longCases[i].side,
                    longCases[i].sizeDelta,
                    longCases[i].indexPriceX96,
                    liquidationVertexIndex,
                    false
                )
            );
            checkResult(longCases[i], tradePriceX96);
            if (i == 0) break;
        }
    }

    function packUpdatePriceStateParam(
        IMarketDescriptor _market,
        Side _side,
        uint128 _sizeDelta,
        uint160 _indexPriceX96,
        uint8 _liquidationVertexIndex,
        bool _liquidation
    ) internal pure returns (PriceUtil.UpdatePriceStateParameter memory) {
        return
            PriceUtil.UpdatePriceStateParameter({
                market: _market,
                side: _side,
                sizeDelta: _sizeDelta,
                indexPriceX96: _indexPriceX96,
                liquidationVertexIndex: _liquidationVertexIndex,
                liquidation: _liquidation
            });
    }

    function expectEmitPremiumChangedEvent(uint128 _prAfterX96) internal {
        vm.expectEmit();
        emit IMarketManager.PremiumRateChanged(market, _prAfterX96);
    }

    function expectEmitBasisIndexPriceX96ChangedEvent(uint160 _basisIndexPriceX96After) internal {
        vm.expectEmit();
        emit IMarketManager.BasisIndexPriceChanged(market, _basisIndexPriceX96After);
    }

    function expectEmitLiquidationBufferNetSizeChangedEvent(uint8 _index, uint128 _netSizeAfter) internal {
        vm.expectEmit();
        emit IMarketManager.LiquidationBufferNetSizeChanged(market, _index, _netSizeAfter);
    }

    function expectEmitGlobalLiquidityPositionChangedEvent(
        IMarketDescriptor _market,
        UpdatePriceStateCase memory _case
    ) internal {
        vm.expectEmit();
        emit IMarketLiquidityPosition.GlobalLiquidityPositionNetPositionChanged(
            _market,
            _case.globalSideExpect,
            _case.netSizeExpect,
            _case.bufferSizeExpect
        );
    }

    function expectEmitGlobalLiquidityPositionChangedEvent(
        IMarketDescriptor _market,
        Side _globalSideExpect,
        uint128 _netSizeExpect,
        uint128 _bufferSizeExpect
    ) internal {
        vm.expectEmit();
        emit IMarketLiquidityPosition.GlobalLiquidityPositionNetPositionChanged(
            _market,
            _globalSideExpect,
            _netSizeExpect,
            _bufferSizeExpect
        );
    }

    function checkResult(UpdatePriceStateCase memory _case, uint160 tradePriceX96) internal {
        console.log("[CHECK] case %d", _case.id);
        assertEq(tradePriceX96, _case.tradePriceX96Expect, "tradePriceX96");
        assertEq(priceState.premiumRateX96, _case.prX96Expect, "prX96");
        assertEq(globalPosition.netSize, _case.netSizeExpect, "netSize");
        assertEq(globalPosition.liquidationBufferNetSize, _case.bufferSizeExpect, "bufferSize");
        assertEq(priceState.pendingVertexIndex, _case.pendingVertexIndexExpect, "pendingVertexIndex");
        assertEq(priceState.currentVertexIndex, _case.currentVertexIndexExpect, "currentVertexIndex");
        assertEq(Side.unwrap(globalPosition.side), Side.unwrap(_case.globalSideExpect), "side");
    }

    function test_CalculateAX248AndBX96() public {
        uint256 length = 18;
        CalculateAX248AndBX96Params[] memory items = new CalculateAX248AndBX96Params[](length);
        // global short && a > 0 && b = 0
        items[0] = CalculateAX248AndBX96Params(
            SHORT,
            IMarketManager.PriceVertex(0, 0),
            IMarketManager.PriceVertex(1, uint128(2 * Constants.Q96)),
            2 * Constants.Q96 * Constants.Q152,
            0
        );
        // global long && a > 0 && b = 0
        items[1] = CalculateAX248AndBX96Params(
            LONG,
            IMarketManager.PriceVertex(0, 0),
            IMarketManager.PriceVertex(1, uint128(2 * Constants.Q96)),
            2 * Constants.Q96 * Constants.Q152,
            0
        );
        // global short && a > 0 && b > 0
        items[2] = CalculateAX248AndBX96Params(
            SHORT,
            IMarketManager.PriceVertex(1, uint128(3 * Constants.Q96)),
            IMarketManager.PriceVertex(2, uint128(5 * Constants.Q96)),
            2 * Constants.Q96 * Constants.Q152,
            1 * int256(Constants.Q96)
        );
        // global long && a > 0 && b < 0
        items[3] = CalculateAX248AndBX96Params(
            LONG,
            IMarketManager.PriceVertex(1, uint128(3 * Constants.Q96)),
            IMarketManager.PriceVertex(2, uint128(5 * Constants.Q96)),
            2 * Constants.Q96 * Constants.Q152,
            -1 * int256(Constants.Q96)
        );
        // global short && a > 0 && b < 0
        items[4] = CalculateAX248AndBX96Params(
            SHORT,
            IMarketManager.PriceVertex(1, uint128(1 * Constants.Q96)),
            IMarketManager.PriceVertex(2, uint128(3 * Constants.Q96)),
            2 * Constants.Q96 * Constants.Q152,
            -1 * int256(Constants.Q96)
        );
        // global long && a > 0 && b > 0
        items[5] = CalculateAX248AndBX96Params(
            LONG,
            IMarketManager.PriceVertex(1, uint128(1 * Constants.Q96)),
            IMarketManager.PriceVertex(2, uint128(3 * Constants.Q96)),
            2 * Constants.Q96 * Constants.Q152,
            1 * int256(Constants.Q96)
        );
        // global short && a > 0 && b > 0 (aX248 round up, bX96 round down)
        items[6] = CalculateAX248AndBX96Params(
            SHORT,
            IMarketManager.PriceVertex(1, uint128(1 * Constants.Q96)),
            IMarketManager.PriceVertex(4, uint128(3 * Constants.Q96) - 1),
            301541899055510925582216106791555096444282638558694587560154798172096779606, // (2 * Constants.Q96-1) * Constants.Q152 / 3 + 1
            26409387504754779197847983445 // (2 * Constants.Q96 + 1) / 3
        );
        // global long && a > 0 && b < 0 (aX248 round up, bX96 round down)
        items[7] = CalculateAX248AndBX96Params(
            LONG,
            IMarketManager.PriceVertex(1, uint128(1 * Constants.Q96)),
            IMarketManager.PriceVertex(4, uint128(3 * Constants.Q96) - 1),
            301541899055510925582216106791555096444282638558694587560154798172096779606, // (2 * Constants.Q96-1) * Constants.Q152 / 3 + 1
            -26409387504754779197847983445 // -(2 * Constants.Q96 + 1) / 3
        );
        // global short && a = 0 && b > 0
        items[8] = CalculateAX248AndBX96Params(
            SHORT,
            IMarketManager.PriceVertex(1, uint128(10 * Constants.Q96)),
            IMarketManager.PriceVertex(2, uint128(10 * Constants.Q96)),
            0,
            10 * int256(Constants.Q96)
        );
        // global long && a = 0 && b < 0
        items[9] = CalculateAX248AndBX96Params(
            LONG,
            IMarketManager.PriceVertex(1, uint128(10 * Constants.Q96)),
            IMarketManager.PriceVertex(2, uint128(10 * Constants.Q96)),
            0,
            -10 * int256(Constants.Q96)
        );
        // global short && a > 0 && b = 0 (0 <= premiumRateX96 <= Constants.Q96)
        items[10] = CalculateAX248AndBX96Params(
            SHORT,
            IMarketManager.PriceVertex(1, uint128(Constants.Q96 / 4)),
            IMarketManager.PriceVertex(2, uint128(Constants.Q96 / 2)),
            113078212145816597093331040047546785012958969400039613319782796882727665664, // Constants.Q96 * Constants.Q152 / 4
            0
        );
        // global long && a > 0 && b = 0 (0 <= premiumRateX96 <= Constants.Q96)
        items[11] = CalculateAX248AndBX96Params(
            LONG,
            IMarketManager.PriceVertex(1, uint128(Constants.Q96 / 4)),
            IMarketManager.PriceVertex(2, uint128(Constants.Q96 / 2)),
            113078212145816597093331040047546785012958969400039613319782796882727665664, // Constants.Q96 * Constants.Q152 / 4
            0
        );
        // global short && a > 0 && b < 0 (0 <= premiumRateX96 <= Constants.Q96)
        items[12] = CalculateAX248AndBX96Params(
            SHORT,
            IMarketManager.PriceVertex(1, uint128(Constants.Q96 / 5)),
            IMarketManager.PriceVertex(2, uint128(Constants.Q96 / 2)),
            135693854574979916511997248058197940169715531184894164759298952368379396096, // 3 * Constants.Q96 * Constants.Q152 / 10 + 1141798154164767904846628775559596109106197300
            -7922816251426433759354395034 // -(Constants.Q96 / 10 + 1)
        );
        // global long && a > 0 && b > 0 (0 <= premiumRateX96 <= Constants.Q96)
        items[13] = CalculateAX248AndBX96Params(
            LONG,
            IMarketManager.PriceVertex(1, uint128(Constants.Q96 / 5)),
            IMarketManager.PriceVertex(2, uint128(Constants.Q96 / 2)),
            135693854574979916511997248058197940169715531184894164759298952368379396096, // 3 * Constants.Q96 * Constants.Q152 / 10 + 1141798154164767904846628775559596109106197300
            7922816251426433759354395034 // Constants.Q96 / 10 + 1
        );
        // global short && a > 0 && b > 0 (0 <= premiumRateX96 <= Constants.Q96)
        items[14] = CalculateAX248AndBX96Params(
            SHORT,
            IMarketManager.PriceVertex(uint128(Constants.Q96 / 8), uint128(Constants.Q96 / 5)),
            IMarketManager.PriceVertex(uint128(Constants.Q96 / 3), uint128(Constants.Q96 / 2)),
            8220946709986328914895727184264287972504417338, // 36 * Constants.Q152/ 25 + 235195986939796784
            1584563250285286751870879006 // uint128(Constants.Q96) / 50
        );
        // global long && a > 0 && b < 0 (0 <= premiumRateX96 <= Constants.Q96)
        items[15] = CalculateAX248AndBX96Params(
            LONG,
            IMarketManager.PriceVertex(uint128(Constants.Q96 / 8), uint128(Constants.Q96 / 5)),
            IMarketManager.PriceVertex(uint128(Constants.Q96 / 3), uint128(Constants.Q96 / 2)),
            8220946709986328914895727184264287972504417338, // 36 * Constants.Q152/ 25 + 235195986939796784
            -1584563250285286751870879006 // -uint128(Constants.Q96) / 50
        );
        // global short && a = 0 && b > 0 (0 <= premiumRateX96 <= Constants.Q96)
        items[16] = CalculateAX248AndBX96Params(
            SHORT,
            IMarketManager.PriceVertex(1, uint128(Constants.Q96 / 2)),
            IMarketManager.PriceVertex(2, uint128(Constants.Q96 / 2)),
            0,
            int256(Constants.Q96) / 2
        );
        // global long && a = 0 && b < 0 (0 <= premiumRateX96 <= Constants.Q96)
        items[17] = CalculateAX248AndBX96Params(
            LONG,
            IMarketManager.PriceVertex(1, uint128(Constants.Q96 / 2)),
            IMarketManager.PriceVertex(2, uint128(Constants.Q96 / 2)),
            0,
            -int256(Constants.Q96) / 2
        );
        for (uint256 i = 0; i < length; i++) {
            CalculateAX248AndBX96Params memory item = items[i];
            (uint256 aX248, int256 bX96) = PriceUtil.calculateAX248AndBX96(item.globalSide, item.from, item.to);
            assertEq(aX248, item.aX248, string.concat("aX248: test case: ", vm.toString(i)));
            assertEq(bX96, item.bX96, string.concat("bX96: test case: ", vm.toString(i)));
        }
    }

    function testFuzz_CalculateAX248AndBX96(
        Side _globalSide,
        IMarketManager.PriceVertex memory _from,
        IMarketManager.PriceVertex memory _to
    ) public pure {
        _assumeForCalculateAX248AndBX96(_globalSide, _from, _to);
        PriceUtil.calculateAX248AndBX96(_globalSide, _from, _to);
    }

    function _assumeForCalculateAX248AndBX96(
        Side _globalSide,
        IMarketManager.PriceVertex memory _from,
        IMarketManager.PriceVertex memory _to
    ) private pure {
        vm.assume(_globalSide.isLong() || _globalSide.isShort());
        vm.assume(_from.size != _to.size);
        uint128 sizeDelta;
        if (_from.size > _to.size) {
            sizeDelta = _from.size - _to.size;
            vm.assume(_from.premiumRateX96 >= _to.premiumRateX96);
            vm.assume(_from.premiumRateX96 <= Constants.Q96);
        } else {
            sizeDelta = _to.size - _from.size;
            vm.assume(_from.premiumRateX96 <= _to.premiumRateX96);
            vm.assume(_to.premiumRateX96 <= Constants.Q96);
        }
    }

    function test_CalculateReachedAndSizeUsed() public {
        uint256 length = 6;
        CalculateReachedAndSizeUsedParams[] memory items = new CalculateReachedAndSizeUsedParams[](length);
        // improveBalance && sizeLeft < sizeCurrent - sizeTo
        items[0] = CalculateReachedAndSizeUsedParams({
            improveBalance: true,
            sizeCurrent: 50,
            sizeTo: 20,
            sizeLeft: 20,
            reached: false,
            sizeUsed: 20
        });
        // improveBalance && sizeLeft = sizeCurrent - sizeTo
        items[1] = CalculateReachedAndSizeUsedParams({
            improveBalance: true,
            sizeCurrent: 50,
            sizeTo: 20,
            sizeLeft: 30,
            reached: true,
            sizeUsed: 30
        });
        // improveBalance && sizeLeft > sizeCurrent - sizeTo
        items[2] = CalculateReachedAndSizeUsedParams({
            improveBalance: true,
            sizeCurrent: 50,
            sizeTo: 20,
            sizeLeft: 31,
            reached: true,
            sizeUsed: 30
        });
        // !improveBalance && sizeLeft < sizeTo - sizeCurrent
        items[3] = CalculateReachedAndSizeUsedParams({
            improveBalance: false,
            sizeCurrent: 50,
            sizeTo: 70,
            sizeLeft: 10,
            reached: false,
            sizeUsed: 10
        });
        // !improveBalance && sizeLeft = sizeTo - sizeCurrent
        items[4] = CalculateReachedAndSizeUsedParams({
            improveBalance: false,
            sizeCurrent: 50,
            sizeTo: 70,
            sizeLeft: 20,
            reached: true,
            sizeUsed: 20
        });
        // !improveBalance && sizeLeft > sizeTo - sizeCurrent
        items[5] = CalculateReachedAndSizeUsedParams({
            improveBalance: false,
            sizeCurrent: 50,
            sizeTo: 70,
            sizeLeft: 21,
            reached: true,
            sizeUsed: 20
        });

        for (uint256 i = 0; i < length; i++) {
            CalculateReachedAndSizeUsedParams memory item = items[i];
            PriceUtil.SimulateMoveStep memory _step;
            _step.improveBalance = item.improveBalance;
            _step.current.size = item.sizeCurrent;
            _step.to.size = item.sizeTo;
            _step.sizeLeft = item.sizeLeft;
            (bool reached, uint128 sizeUsed) = PriceUtil.calculateReachedAndSizeUsed(_step);
            assertEq(reached, item.reached, string.concat("reached: test case: ", vm.toString(i)));
            assertEq(sizeUsed, item.sizeUsed, string.concat("sizeUsed: test case: ", vm.toString(i)));
        }
    }

    function testFuzz_CalculateReachedAndSizeUsed(PriceUtil.SimulateMoveStep memory _step) public pure {
        _assumeCalculateReachedAndSizeUsed(_step);
        PriceUtil.calculateReachedAndSizeUsed(_step);
    }

    function _assumeCalculateReachedAndSizeUsed(PriceUtil.SimulateMoveStep memory _step) private pure {
        vm.assume(_step.sizeLeft > 0);
        if (_step.improveBalance) {
            vm.assume(_step.current.size > _step.to.size);
            vm.assume(_step.current.size < _step.from.size);
        } else {
            vm.assume(_step.current.size < _step.to.size);
            vm.assume(_step.current.size > _step.from.size);
        }
    }

    function test_CalculatePremiumRateAfterX96() public {
        // aX248 = 135693854574979916511997248058197940169715531184894164759, bX96 = ±7922816251426433759354395034(global side: LONG(+) / SHORT(-))
        uint256 length = 16;
        CalculatePremiumRateAfterX96Params[] memory items = new CalculatePremiumRateAfterX96Params[](length);
        // long && reached && improveBalance (sizeUsed = sizeCurrent - to.size)
        items[0] = CalculatePremiumRateAfterX96Params({
            from: IMarketManager.PriceVertex(2e18, uint128(Constants.Q96 / 2)), // 39614081257132168796771975168
            to: IMarketManager.PriceVertex(1e18, uint128(Constants.Q96 / 5)), // 15845632502852867518708790067
            side: LONG,
            improveBalance: true,
            sizeCurrent: 1.2e18,
            reached: true,
            sizeUsed: 0.2e18,
            premiumRateAfterX96: uint128(Constants.Q96) / 5 // 15845632502852867518708790067
        });
        // long && reached && !improveBalance (sizeUsed = to.size - sizeCurrent)
        items[1] = CalculatePremiumRateAfterX96Params({
            from: IMarketManager.PriceVertex(1e18, uint128(Constants.Q96 / 5)), // 15845632502852867518708790067
            to: IMarketManager.PriceVertex(2e18, uint128(Constants.Q96 / 2)), // 39614081257132168796771975168
            side: LONG,
            improveBalance: false,
            sizeCurrent: 1.2e18,
            reached: true,
            sizeUsed: 0.8e18,
            premiumRateAfterX96: uint128(Constants.Q96) / 2 // 39614081257132168796771975168
        });
        // long && !reached && improveBalance (sizeUsed < sizeCurrent - to.size)
        items[2] = CalculatePremiumRateAfterX96Params({
            from: IMarketManager.PriceVertex(2e18, uint128(Constants.Q96 / 2)), // 39614081257132168796771975168
            to: IMarketManager.PriceVertex(1e18, uint128(Constants.Q96 / 5)), // 15845632502852867518708790067
            side: LONG,
            improveBalance: true,
            sizeCurrent: 1.2e18,
            reached: false,
            sizeUsed: 0.1e18,
            premiumRateAfterX96: 18222477378280797646515108578
        });
        // long && !reached && !improveBalance (sizeUsed < to.size - sizeCurrent)
        items[3] = CalculatePremiumRateAfterX96Params({
            from: IMarketManager.PriceVertex(1e18, uint128(Constants.Q96 / 5)), // 15845632502852867518708790067
            to: IMarketManager.PriceVertex(2e18, uint128(Constants.Q96 / 2)), // 39614081257132168796771975168
            side: LONG,
            improveBalance: false,
            sizeCurrent: 1.2e18,
            reached: false,
            sizeUsed: 0.5e18,
            premiumRateAfterX96: 32483546630848378413353019638
        });
        // short && reached && improveBalance (sizeUsed = sizeCurrent - to.size)
        items[4] = CalculatePremiumRateAfterX96Params({
            from: IMarketManager.PriceVertex(2e18, uint128(Constants.Q96 / 2)), // 39614081257132168796771975168
            to: IMarketManager.PriceVertex(1e18, uint128(Constants.Q96 / 5)), // 15845632502852867518708790067
            side: SHORT,
            improveBalance: true,
            sizeCurrent: 1.2e18,
            reached: true,
            sizeUsed: 0.2e18,
            premiumRateAfterX96: uint128(Constants.Q96) / 5 // 15845632502852867518708790067
        });
        // short && reached && !improveBalance (sizeUsed = to.size - sizeCurrent)
        items[5] = CalculatePremiumRateAfterX96Params({
            from: IMarketManager.PriceVertex(1e18, uint128(Constants.Q96 / 5)), // 15845632502852867518708790067
            to: IMarketManager.PriceVertex(2e18, uint128(Constants.Q96 / 2)), // 39614081257132168796771975168
            side: SHORT,
            improveBalance: false,
            sizeCurrent: 1.2e18,
            reached: true,
            sizeUsed: 0.8e18,
            premiumRateAfterX96: uint128(Constants.Q96) / 2 // 39614081257132168796771975168
        });
        // short && !reached && improveBalance (sizeUsed < sizeCurrent - to.size)
        items[6] = CalculatePremiumRateAfterX96Params({
            from: IMarketManager.PriceVertex(2e18, uint128(Constants.Q96 / 2)), // 39614081257132168796771975168
            to: IMarketManager.PriceVertex(1e18, uint128(Constants.Q96 / 5)), // 15845632502852867518708790067
            side: SHORT,
            improveBalance: true,
            sizeCurrent: 1.2e18,
            reached: false,
            sizeUsed: 0.1e18,
            premiumRateAfterX96: 18222477378280797646515108578
        });
        // short && !reached && !improveBalance (sizeUsed < to.size - sizeCurrent)
        items[7] = CalculatePremiumRateAfterX96Params({
            from: IMarketManager.PriceVertex(1e18, uint128(Constants.Q96 / 5)), // 15845632502852867518708790067
            to: IMarketManager.PriceVertex(2e18, uint128(Constants.Q96 / 2)), // 39614081257132168796771975168
            side: SHORT,
            improveBalance: false,
            sizeCurrent: 1.2e18,
            reached: false,
            sizeUsed: 0.5e18,
            premiumRateAfterX96: 32483546630848378413353019638
        });
        // premiumRate: [0.6%, 10%], sizeToReach: 1
        items[8] = CalculatePremiumRateAfterX96Params({
            // (aX248, bX96) = (42517407766827040507092471054543540554711450212262738584, -6972078301255261708231867629)
            from: IMarketManager.PriceVertex(1e18, uint128((3 * Constants.Q96) / 500)), // 475368975085586025561263702
            to: IMarketManager.PriceVertex(2e18, uint128(Constants.Q96 / 10)), // 7922816251426433759354395033
            side: SHORT,
            improveBalance: false,
            sizeCurrent: 1.2e18,
            reached: false,
            sizeUsed: 0.8e18 - 1,
            premiumRateAfterX96: 7922816251426433751906947757 // 0.0999999999999999999059999999967
        });
        // premiumRate: [1.2%, 20%], sizeToReach: 1
        items[9] = CalculatePremiumRateAfterX96Params({
            // (aX248, bX96) = (85034815533654081014184942114796071880246739948758621046, -13944156602510523416463735259)
            from: IMarketManager.PriceVertex(1e18, uint128((3 * Constants.Q96) / 250)), // 950737950171172051122527404
            to: IMarketManager.PriceVertex(2e18, uint128(Constants.Q96 / 5)), // 15845632502852867518708790067
            side: SHORT,
            improveBalance: false,
            sizeCurrent: 1.2e18,
            reached: false,
            sizeUsed: 0.8e18 - 1,
            premiumRateAfterX96: 15845632502852867503813895515 // 0.199999999999999999812000000006
        });
        // premiumRate: [3%, 50%], sizeToReach: 1
        items[10] = CalculatePremiumRateAfterX96Params({
            // (aX248, bX96) = (212587038834135202535462355289844675086028769634013124552, -34860391506276308541159338148)
            from: IMarketManager.PriceVertex(1e18, uint128((3 * Constants.Q96) / 100)), // 2376844875427930127806318510
            to: IMarketManager.PriceVertex(2e18, uint128(Constants.Q96 / 2)), // 39614081257132168796771975168
            side: SHORT,
            improveBalance: false,
            sizeCurrent: 1.2e18,
            reached: false,
            sizeUsed: 0.8e18 - 1,
            premiumRateAfterX96: 39614081257132168759534738787 // 0.499999999999999999530000000009
        });
        // premiumRate: [50%, 100%], sizeToReach: 1
        items[11] = CalculatePremiumRateAfterX96Params({
            // (aX248, bX96) = (4523128485832663883733241601992333970235012054, 39614081257132168796771975167)
            from: IMarketManager.PriceVertex(1, uint128(Constants.Q96 / 2)), // 39614081257132168796771975168
            to: IMarketManager.PriceVertex(50_000_000_000e18, uint128(Constants.Q96)), // 79228162514264337593543950336
            side: SHORT,
            improveBalance: false,
            sizeCurrent: 1,
            reached: false,
            sizeUsed: 50_000_000_000e18 - 2,
            premiumRateAfterX96: 79228162514264337593543950336
        });
        // sizeToReach: 1, premiumRateAfter < 1
        items[12] = CalculatePremiumRateAfterX96Params({
            // (aX248, bX96) = (9046256971665327767466483203803742801036717553, 0)
            from: IMarketManager.PriceVertex(0, 0),
            to: IMarketManager.PriceVertex(50_000_000_000e18, uint128(Constants.Q96)), // 79228162514264337593543950336
            side: SHORT,
            improveBalance: false,
            sizeCurrent: 0,
            reached: false,
            sizeUsed: 50_000_000_000e18 - 1,
            premiumRateAfterX96: 79228162514264337593543950335
        });
        // sizeToReach: 9e9 - 1, premiumRateAfter < 1
        items[13] = CalculatePremiumRateAfterX96Params({
            // (aX248, bX96) = (664613997892457936451903530140172289, 39614081257132168796771975167)
            from: IMarketManager.PriceVertex(1, uint128(Constants.Q96 / 2)), // 39614081257132168796771975168
            to: IMarketManager.PriceVertex(type(uint128).max, uint128(Constants.Q96)), // 79228162514264337593543950336
            side: SHORT,
            improveBalance: false,
            sizeCurrent: 1,
            reached: false,
            sizeUsed: type(uint128).max - 9e9,
            premiumRateAfterX96: 79228162514264337593543950334
        });
        // sizeToReach: 1e9 - 1, premiumRateAfter < 1
        items[14] = CalculatePremiumRateAfterX96Params({
            // (aX248, bX96) = (664613997892457936451903530140172289, 39614081257132168796771975167)
            from: IMarketManager.PriceVertex(1, uint128(Constants.Q96 / 2)), // 39614081257132168796771975168
            to: IMarketManager.PriceVertex(type(uint128).max, uint128(Constants.Q96)), // 79228162514264337593543950336
            side: SHORT,
            improveBalance: false,
            sizeCurrent: 1,
            reached: false,
            sizeUsed: type(uint128).max - 1e9,
            premiumRateAfterX96: 79228162514264337593543950335
        });
        // sizeToReach: 1, premiumRateAfter = 1
        items[15] = CalculatePremiumRateAfterX96Params({
            // (aX248, bX96) = (664613997892457936451903530140172289, 39614081257132168796771975167)
            from: IMarketManager.PriceVertex(1, uint128(Constants.Q96 / 2)), // 39614081257132168796771975168
            to: IMarketManager.PriceVertex(type(uint128).max, uint128(Constants.Q96)), // 79228162514264337593543950336
            side: SHORT,
            improveBalance: false,
            sizeCurrent: 1,
            reached: false,
            sizeUsed: type(uint128).max - 3,
            premiumRateAfterX96: 79228162514264337593543950336
        });

        for (uint256 i = 0; i < length; i++) {
            CalculatePremiumRateAfterX96Params memory item = items[i];
            PriceUtil.SimulateMoveStep memory _step;
            _step.from = item.from;
            _step.to = item.to;
            _step.side = item.side;
            _step.improveBalance = item.improveBalance;
            _step.current.size = item.sizeCurrent;
            uint128 premiumRateAfterX96 = PriceUtil.calculatePremiumRateAfterX96(_step, item.reached, item.sizeUsed);
            assertEq(premiumRateAfterX96, item.premiumRateAfterX96, string.concat("test case: ", vm.toString(i)));
        }
    }

    function testFuzz_CalculatePremiumRateAfterX96(
        PriceUtil.SimulateMoveStep memory _step,
        bool _reached,
        uint128 _sizeUsed
    ) public pure {
        vm.assume(_step.side.isLong() || _step.side.isShort());
        _assumeCalculateReachedAndSizeUsed(_step);
        (bool reached, uint128 sizeUsed) = PriceUtil.calculateReachedAndSizeUsed(_step);
        _reached = reached;
        _sizeUsed = sizeUsed;
        if (!_reached) {
            Side globalSide = _step.improveBalance ? _step.side : _step.side.flip();
            _assumeForCalculateAX248AndBX96(globalSide, _step.from, _step.to);
            (uint256 aX248, int256 bX96) = PriceUtil.calculateAX248AndBX96(globalSide, _step.from, _step.to);
            uint256 targetSize = _step.improveBalance ? _step.current.size - _sizeUsed : _step.current.size + _sizeUsed;
            vm.assume(aX248 <= uint256(type(int256).max) / targetSize);
            if (globalSide.isLong()) bX96 = -bX96;
            vm.assume(bX96 <= int256(uint256(type(uint128).max)) - (aX248 * targetSize).toInt256());
        }
        PriceUtil.calculatePremiumRateAfterX96(_step, _reached, _sizeUsed);
    }

    function test_SimulateMove() public {
        // aX248 = 37692737381938865697777013347279264747378376625268823147, bX96 = ±13204693752377389598923991723 (global side: LONG(-) / SHORT(+))
        uint256 length = 12;
        SimulateMoveParams[] memory items = new SimulateMoveParams[](length);
        // short && improveBalance && sizeLeft > sizeCurrent - sizeTo
        items[0] = SimulateMoveParams({
            side: SHORT,
            sizeLeft: 0.2e18 + 1,
            indexPriceX96: uint160((1000 * 1e6 * Constants.Q96) / 1e18), // 79228162514264337593
            improveBalance: true,
            from: IMarketManager.PriceVertex(2e18, uint128(Constants.Q96 / 3)), // 26409387504754779197847983445
            current: IMarketManager.PriceVertex(1.2e18, uint128((4 * Constants.Q96) / 15)), // 21127510003803823358278386756
            to: IMarketManager.PriceVertex(1e18, uint128(Constants.Q96 / 4)), // 19807040628566084398385987584
            basisIndexPriceX96: uint160((3000 * 1e6 * Constants.Q96) / 1e18), // 237684487542793012780
            tradePriceX96: 140629988462819199227,
            sizeUsed: 0.2e18,
            reached: true,
            premiumRateAfterX96: 19807040628566084398385987584
        });
        // short && improveBalance && sizeLeft = sizeCurrent - sizeTo
        items[1] = SimulateMoveParams({
            side: SHORT,
            sizeLeft: 0.2e18,
            indexPriceX96: uint160((1000 * 1e6 * Constants.Q96) / 1e18), // 79228162514264337593
            improveBalance: true,
            from: IMarketManager.PriceVertex(2e18, uint128(Constants.Q96 / 3)), // 26409387504754779197847983445
            current: IMarketManager.PriceVertex(1.2e18, uint128((4 * Constants.Q96) / 15)), // 21127510003803823358278386756
            to: IMarketManager.PriceVertex(1e18, uint128(Constants.Q96 / 4)), // 19807040628566084398385987584
            basisIndexPriceX96: uint160((3000 * 1e6 * Constants.Q96) / 1e18), // 237684487542793012780
            tradePriceX96: 140629988462819199227,
            sizeUsed: 0.2e18,
            reached: true,
            premiumRateAfterX96: 19807040628566084398385987584
        });
        // short && improveBalance && sizeLeft < sizeCurrent - sizeTo
        items[2] = SimulateMoveParams({
            side: SHORT,
            sizeLeft: 0.1e18,
            indexPriceX96: uint160((1000 * 1e6 * Constants.Q96) / 1e18), // 79228162514264337593
            improveBalance: true,
            from: IMarketManager.PriceVertex(2e18, uint128(Constants.Q96 / 3)), // 26409387504754779197847983445
            current: IMarketManager.PriceVertex(1.2e18, uint128((4 * Constants.Q96) / 15)), // 21127510003803823358278386756
            to: IMarketManager.PriceVertex(1e18, uint128(Constants.Q96 / 4)), // 19807040628566084398385987584
            basisIndexPriceX96: uint160((3000 * 1e6 * Constants.Q96) / 1e18), // 237684487542793012780
            tradePriceX96: 141620340494247503447,
            sizeUsed: 0.1e18,
            reached: false,
            premiumRateAfterX96: 20467275316184953878332187171
        });
        // long && improveBalance && sizeLeft > sizeCurrent - sizeTo
        items[3] = SimulateMoveParams({
            side: LONG,
            sizeLeft: 0.2e18 + 1,
            indexPriceX96: uint160((1000 * 1e6 * Constants.Q96) / 1e18), // 79228162514264337593
            improveBalance: true,
            from: IMarketManager.PriceVertex(2e18, uint128(Constants.Q96 / 3)), // 26409387504754779197847983445
            current: IMarketManager.PriceVertex(1.2e18, uint128((4 * Constants.Q96) / 15)), // 21127510003803823358278386756
            to: IMarketManager.PriceVertex(1e18, uint128(Constants.Q96 / 4)), // 19807040628566084398385987584
            basisIndexPriceX96: uint160((3000 * 1e6 * Constants.Q96) / 1e18), // 237684487542793012780
            tradePriceX96: 17826336565709475959,
            sizeUsed: 0.2e18,
            reached: true,
            premiumRateAfterX96: 19807040628566084398385987584
        });
        // long && improveBalance && sizeLeft = sizeCurrent - sizeTo
        items[4] = SimulateMoveParams({
            side: LONG,
            sizeLeft: 0.2e18,
            indexPriceX96: uint160((1000 * 1e6 * Constants.Q96) / 1e18), // 79228162514264337593
            improveBalance: true,
            from: IMarketManager.PriceVertex(2e18, uint128(Constants.Q96 / 3)), // 26409387504754779197847983445
            current: IMarketManager.PriceVertex(1.2e18, uint128((4 * Constants.Q96) / 15)), // 21127510003803823358278386756
            to: IMarketManager.PriceVertex(1e18, uint128(Constants.Q96 / 4)), // 19807040628566084398385987584
            basisIndexPriceX96: uint160((3000 * 1e6 * Constants.Q96) / 1e18), // 237684487542793012780
            tradePriceX96: 17826336565709475959,
            sizeUsed: 0.2e18,
            reached: true,
            premiumRateAfterX96: 19807040628566084398385987584
        });
        // long && improveBalance && sizeLeft < sizeCurrent - sizeTo
        items[5] = SimulateMoveParams({
            side: LONG,
            sizeLeft: 0.1e18,
            indexPriceX96: uint160((1000 * 1e6 * Constants.Q96) / 1e18), // 79228162514264337593
            improveBalance: true,
            from: IMarketManager.PriceVertex(2e18, uint128(Constants.Q96 / 3)), // 26409387504754779197847983445
            current: IMarketManager.PriceVertex(1.2e18, uint128((4 * Constants.Q96) / 15)), // 21127510003803823358278386756
            to: IMarketManager.PriceVertex(1e18, uint128(Constants.Q96 / 4)), // 19807040628566084398385987584
            basisIndexPriceX96: uint160((3000 * 1e6 * Constants.Q96) / 1e18), // 237684487542793012780
            tradePriceX96: 16835984534281171739,
            sizeUsed: 0.1e18,
            reached: false,
            premiumRateAfterX96: 20467275316184953878332187171
        });
        // short && !improveBalance && sizeLeft > sizeTo - sizeCurrent
        items[6] = SimulateMoveParams({
            side: SHORT,
            sizeLeft: 0.8e18 + 1,
            indexPriceX96: uint160((1000 * 1e6 * Constants.Q96) / 1e18), // 79228162514264337593
            improveBalance: false,
            from: IMarketManager.PriceVertex(1e18, uint128(Constants.Q96 / 4)), // 19807040628566084398385987584
            current: IMarketManager.PriceVertex(1.2e18, uint128((4 * Constants.Q96) / 15)), // 21127510003803823358278386756
            to: IMarketManager.PriceVertex(2e18, uint128(Constants.Q96 / 3)), // 26409387504754779197847983445
            basisIndexPriceX96: uint160((3000 * 1e6 * Constants.Q96) / 1e18), // 237684487542793012780
            tradePriceX96: 7922816251426433759,
            sizeUsed: 0.8e18,
            reached: true,
            premiumRateAfterX96: 26409387504754779197847983445
        });
        // short && !improveBalance && sizeLeft = sizeTo - sizeCurrent
        items[7] = SimulateMoveParams({
            side: SHORT,
            sizeLeft: 0.8e18 + 1,
            indexPriceX96: uint160((1000 * 1e6 * Constants.Q96) / 1e18), // 79228162514264337593
            improveBalance: false,
            from: IMarketManager.PriceVertex(1e18, uint128(Constants.Q96 / 4)), // 19807040628566084398385987584
            current: IMarketManager.PriceVertex(1.2e18, uint128((4 * Constants.Q96) / 15)), // 21127510003803823358278386756
            to: IMarketManager.PriceVertex(2e18, uint128(Constants.Q96 / 3)), // 26409387504754779197847983445
            basisIndexPriceX96: uint160((3000 * 1e6 * Constants.Q96) / 1e18), // 237684487542793012780
            tradePriceX96: 7922816251426433759,
            sizeUsed: 0.8e18,
            reached: true,
            premiumRateAfterX96: 26409387504754779197847983445
        });
        // short && !improveBalance && sizeLeft < sizeTo - sizeCurrent
        items[8] = SimulateMoveParams({
            side: SHORT,
            sizeLeft: 0.5e18,
            indexPriceX96: uint160((1000 * 1e6 * Constants.Q96) / 1e18), // 79228162514264337593
            improveBalance: false,
            from: IMarketManager.PriceVertex(1e18, uint128(Constants.Q96 / 4)), // 19807040628566084398385987584
            current: IMarketManager.PriceVertex(1.2e18, uint128((4 * Constants.Q96) / 15)), // 21127510003803823358278386756
            to: IMarketManager.PriceVertex(2e18, uint128(Constants.Q96 / 3)), // 26409387504754779197847983445
            basisIndexPriceX96: uint160((3000 * 1e6 * Constants.Q96) / 1e18), // 237684487542793012780
            tradePriceX96: 10893872345711346418,
            sizeUsed: 0.5e18,
            reached: false,
            premiumRateAfterX96: 24428683441898170758009384687
        });
        // long && !improveBalance && sizeLeft > sizeTo - sizeCurrent
        items[9] = SimulateMoveParams({
            side: LONG,
            sizeLeft: 0.8e18 + 1,
            indexPriceX96: uint160((1000 * 1e6 * Constants.Q96) / 1e18), // 79228162514264337593
            improveBalance: false,
            from: IMarketManager.PriceVertex(1e18, uint128(Constants.Q96 / 4)), // 19807040628566084398385987584
            current: IMarketManager.PriceVertex(1.2e18, uint128((4 * Constants.Q96) / 15)), // 21127510003803823358278386756
            to: IMarketManager.PriceVertex(2e18, uint128(Constants.Q96 / 3)), // 26409387504754779197847983445
            basisIndexPriceX96: uint160((3000 * 1e6 * Constants.Q96) / 1e18), // 237684487542793012780
            tradePriceX96: 150533508777102241427,
            sizeUsed: 0.8e18,
            reached: true,
            premiumRateAfterX96: 26409387504754779197847983445
        });
        // long && !improveBalance && sizeLeft = sizeTo - sizeCurrent
        items[10] = SimulateMoveParams({
            side: LONG,
            sizeLeft: 0.8e18,
            indexPriceX96: uint160((1000 * 1e6 * Constants.Q96) / 1e18), // 79228162514264337593
            improveBalance: false,
            from: IMarketManager.PriceVertex(1e18, uint128(Constants.Q96 / 4)), // 19807040628566084398385987584
            current: IMarketManager.PriceVertex(1.2e18, uint128((4 * Constants.Q96) / 15)), // 21127510003803823358278386756
            to: IMarketManager.PriceVertex(2e18, uint128(Constants.Q96 / 3)), // 26409387504754779197847983445
            basisIndexPriceX96: uint160((3000 * 1e6 * Constants.Q96) / 1e18), // 237684487542793012780
            tradePriceX96: 150533508777102241427,
            sizeUsed: 0.8e18,
            reached: true,
            premiumRateAfterX96: 26409387504754779197847983445
        });
        // long && !improveBalance && sizeLeft < sizeTo - sizeCurrent
        items[11] = SimulateMoveParams({
            side: LONG,
            sizeLeft: 0.5e18,
            indexPriceX96: uint160((1000 * 1e6 * Constants.Q96) / 1e18), // 79228162514264337593
            improveBalance: false,
            from: IMarketManager.PriceVertex(1e18, uint128(Constants.Q96 / 4)), // 19807040628566084398385987584
            current: IMarketManager.PriceVertex(1.2e18, uint128((4 * Constants.Q96) / 15)), // 21127510003803823358278386756
            to: IMarketManager.PriceVertex(2e18, uint128(Constants.Q96 / 3)), // 26409387504754779197847983445
            basisIndexPriceX96: uint160((3000 * 1e6 * Constants.Q96) / 1e18), // 237684487542793012780
            tradePriceX96: 147562452682817328768,
            sizeUsed: 0.5e18,
            reached: false,
            premiumRateAfterX96: 24428683441898170758009384687
        });
        for (uint256 i = 0; i < length; i++) {
            SimulateMoveParams memory item = items[i];
            PriceUtil.SimulateMoveStep memory _step = PriceUtil.SimulateMoveStep({
                side: item.side,
                sizeLeft: item.sizeLeft,
                indexPriceX96: item.indexPriceX96,
                improveBalance: item.improveBalance,
                basisIndexPriceX96: item.basisIndexPriceX96,
                from: item.from,
                current: item.current,
                to: item.to
            });
            (int160 tradePriceX96, uint128 sizeUsed, bool reached, uint128 premiumRateAfterX96) = PriceUtil
                .simulateMove(_step);
            assertEq(reached, item.reached, string.concat("reached: test case: ", vm.toString(i)));
            assertEq(sizeUsed, item.sizeUsed, string.concat("sizeUsed: test case: ", vm.toString(i)));
            assertEq(
                premiumRateAfterX96,
                item.premiumRateAfterX96,
                string.concat("premiumRateAfterX96: test case: ", vm.toString(i))
            );
            assertEq(tradePriceX96, item.tradePriceX96, string.concat("tradePriceX96: test case: ", vm.toString(i)));
        }
    }

    function testFuzz_CalculateMarketPriceX96(
        Side _globalSide,
        Side _side,
        uint160 _indexPriceX96,
        uint160 _basisIndexPriceX96,
        uint128 _premiumRateX96
    ) public pure {
        uint256 priceDeltaX96Up = Math.mulDivUp(_basisIndexPriceX96, _premiumRateX96, Constants.Q96);
        vm.assume(priceDeltaX96Up + _indexPriceX96 <= type(uint160).max);
        PriceUtil.calculateMarketPriceX96(_globalSide, _side, _indexPriceX96, _basisIndexPriceX96, _premiumRateX96);
    }
}
