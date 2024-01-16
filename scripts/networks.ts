import {ethers} from "hardhat";
import {parsePercent} from "./util";

const defaultBaseCfg = {
    minMarginPerLiquidityPosition: 10n * 10n ** 6n,
    maxLeveragePerLiquidityPosition: 100n,
    liquidationFeeRatePerLiquidityPosition: parsePercent("0.05%"),
    minMarginPerPosition: 10n * 10n ** 6n,
    maxLeveragePerPosition: 200n,
    liquidationFeeRatePerPosition: parsePercent("0.5%"),
    maxPositionLiquidity: 10_000_000n * 10n ** 6n,
    maxPositionValueRate: parsePercent("100%"),
    maxSizeRatePerPosition: parsePercent("20%"),
    liquidationExecutionFee: 800_000n, // 0.8 USD
    interestRate: parsePercent("0.00125%"),
    maxFundingRate: parsePercent("0.25%"),
};

const defaultFeeRateCfg = {
    tradingFeeRate: parsePercent("0.02%"),
    protocolFeeRate: parsePercent("40%"),
    referralReturnFeeRate: parsePercent("10%"),
    referralParentReturnFeeRate: parsePercent("1%"),
    referralDiscountRate: parsePercent("50%"),
};

const defaultPriceCfg = {
    maxPriceImpactLiquidity: (1n << 128n) - 1n,
    liquidationVertexIndex: 7,
    vertices: [
        {balanceRate: 0, premiumRate: 0},
        {balanceRate: parsePercent("2%"), premiumRate: parsePercent("0.05%")},
        {balanceRate: parsePercent("4%"), premiumRate: parsePercent("0.1%")},
        {balanceRate: parsePercent("5%"), premiumRate: parsePercent("0.15%")},
        {balanceRate: parsePercent("6%"), premiumRate: parsePercent("0.2%")},
        {balanceRate: parsePercent("7%"), premiumRate: parsePercent("0.3%")},
        {balanceRate: parsePercent("8%"), premiumRate: parsePercent("0.4%")},
        {balanceRate: parsePercent("9%"), premiumRate: parsePercent("0.5%")},
        {balanceRate: parsePercent("10%"), premiumRate: parsePercent("0.6%")},
        {balanceRate: parsePercent("50%"), premiumRate: parsePercent("10%")},
    ],
};

const highLeverageCfg = {
    baseCfg: {
        ...defaultBaseCfg,
        maxLeveragePerLiquidityPosition: 100n,
        maxLeveragePerPosition: 100n,
        maxPositionLiquidity: 100_000_000n * 10n ** 6n,
        maxPositionValueRate: parsePercent("1000%"),
        maxSizeRatePerPosition: parsePercent("10%"),
    },
    feeRateCfg: {
        ...defaultFeeRateCfg,
        tradingFeeRate: parsePercent("0.02%"),
    },
    priceCfg: {
        ...defaultPriceCfg,
    },
};

const mediumLeverageCfg = {
    baseCfg: {
        ...defaultBaseCfg,
        maxLeveragePerLiquidityPosition: 50n,
        maxLeveragePerPosition: 50n,
        maxPositionLiquidity: 10_000_000n * 10n ** 6n,
        maxPositionValueRate: parsePercent("500%"),
        maxSizeRatePerPosition: parsePercent("10%"),
    },
    feeRateCfg: {
        ...defaultFeeRateCfg,
        tradingFeeRate: parsePercent("0.04%"),
    },
    priceCfg: {
        ...defaultPriceCfg,
        vertices: [
            {balanceRate: 0, premiumRate: 0},
            {balanceRate: parsePercent("2%"), premiumRate: parsePercent("0.1%")},
            {balanceRate: parsePercent("4%"), premiumRate: parsePercent("0.2%")},
            {balanceRate: parsePercent("5%"), premiumRate: parsePercent("0.3%")},
            {balanceRate: parsePercent("6%"), premiumRate: parsePercent("0.4%")},
            {balanceRate: parsePercent("7%"), premiumRate: parsePercent("0.6%")},
            {balanceRate: parsePercent("8%"), premiumRate: parsePercent("0.8%")},
            {balanceRate: parsePercent("9%"), premiumRate: parsePercent("1.0%")},
            {balanceRate: parsePercent("10%"), premiumRate: parsePercent("1.2%")},
            {balanceRate: parsePercent("50%"), premiumRate: parsePercent("20%")},
        ],
    },
};

const lowLeverageCfg = {
    baseCfg: {
        ...defaultBaseCfg,
        maxLeveragePerLiquidityPosition: 20n,
        maxLeveragePerPosition: 20n,
        maxPositionLiquidity: 5_000_000n * 10n ** 6n,
        maxPositionValueRate: parsePercent("100%"),
        maxSizeRatePerPosition: parsePercent("10%"),
    },
    feeRateCfg: {
        ...defaultFeeRateCfg,
        tradingFeeRate: parsePercent("0.1%"),
    },
    priceCfg: {
        ...defaultPriceCfg,
        vertices: [
            {balanceRate: 0, premiumRate: 0},
            {balanceRate: parsePercent("2%"), premiumRate: parsePercent("0.25%")},
            {balanceRate: parsePercent("4%"), premiumRate: parsePercent("0.5%")},
            {balanceRate: parsePercent("5%"), premiumRate: parsePercent("0.75%")},
            {balanceRate: parsePercent("6%"), premiumRate: parsePercent("1.0%")},
            {balanceRate: parsePercent("7%"), premiumRate: parsePercent("1.5%")},
            {balanceRate: parsePercent("8%"), premiumRate: parsePercent("2%")},
            {balanceRate: parsePercent("9%"), premiumRate: parsePercent("2.5%")},
            {balanceRate: parsePercent("10%"), premiumRate: parsePercent("3%")},
            {balanceRate: parsePercent("50%"), premiumRate: parsePercent("50%")},
        ],
    },
};

const defaultMaxCumulativeDeltaDiff = 100n * 1000n; // 10%

export const networks = {
    "arbitrum-sepolia": {
        usd: "0x130a10D76E53eC70C2d1c05e9C2EcfB5C3350fe0",
        usdChainLinkPriceFeed: "0x80EDee6f667eCc9f63a0a6f55578F870651f06A4",
        minPositionRouterExecutionFee: ethers.parseUnits("0.0003", "ether"),
        minOrderBookExecutionFee: ethers.parseUnits("0.0004", "ether"),
        sequencerUptimeFeed: undefined,
        ignoreReferencePriceFeedError: true,
        equ: "0x015A5F94860bee9c0752895e613493ca93E3334B",
        efc: "0x5D532F910aDa7A01811756Ced2dC20756985004D",
        routerV1: "0x305Aa369b1dC4163CA412C005485eAE063C6eD8B",
        feeDistributor: "0x9482Bde4B5C39Bf6e2cF67Ac404e0e6C7Dc9e33d",
        farmRewardDistributorV2: "0x57a4360cc5D53dc601fFE74C677E0703291F217F",
        markets: [
            {
                name: "ETH",
                chainLinkPriceFeed: "0xd30e2101a97dcbAeBCBC04F14C3f624E67A35165",
                maxCumulativeDeltaDiff: defaultMaxCumulativeDeltaDiff,
                marketCfg: highLeverageCfg,
            },
            {
                name: "BTC",
                chainLinkPriceFeed: "0x56a43EB56Da12C0dc1D972ACb089c06a5dEF8e69",
                maxCumulativeDeltaDiff: defaultMaxCumulativeDeltaDiff,
                marketCfg: highLeverageCfg,
            },
            {
                name: "SOL",
                chainLinkPriceFeed: undefined,
                maxCumulativeDeltaDiff: defaultMaxCumulativeDeltaDiff,
                marketCfg: mediumLeverageCfg,
            },
            {
                name: "ARB",
                chainLinkPriceFeed: "0xD1092a65338d049DB68D7Be6bD89d17a0929945e",
                maxCumulativeDeltaDiff: defaultMaxCumulativeDeltaDiff,
                marketCfg: mediumLeverageCfg,
            },
            {
                name: "OP",
                chainLinkPriceFeed: undefined,
                maxCumulativeDeltaDiff: defaultMaxCumulativeDeltaDiff,
                marketCfg: mediumLeverageCfg,
            },
            {
                name: "MATIC",
                chainLinkPriceFeed: undefined,
                maxCumulativeDeltaDiff: defaultMaxCumulativeDeltaDiff,
                marketCfg: mediumLeverageCfg,
            },
            {
                name: "AVAX",
                chainLinkPriceFeed: undefined,
                maxCumulativeDeltaDiff: defaultMaxCumulativeDeltaDiff,
                marketCfg: mediumLeverageCfg,
            },
            {
                name: "LINK",
                chainLinkPriceFeed: "0x0FB99723Aee6f420beAD13e6bBB79b7E6F034298",
                maxCumulativeDeltaDiff: defaultMaxCumulativeDeltaDiff,
                marketCfg: mediumLeverageCfg,
            },
            {
                name: "XRP",
                chainLinkPriceFeed: undefined,
                maxCumulativeDeltaDiff: defaultMaxCumulativeDeltaDiff,
                marketCfg: mediumLeverageCfg,
            },
            {
                name: "BNB",
                chainLinkPriceFeed: undefined,
                maxCumulativeDeltaDiff: defaultMaxCumulativeDeltaDiff,
                marketCfg: mediumLeverageCfg,
            },
            {
                name: "ADA",
                chainLinkPriceFeed: undefined,
                maxCumulativeDeltaDiff: defaultMaxCumulativeDeltaDiff,
                marketCfg: mediumLeverageCfg,
            },
            {
                name: "DOGE",
                chainLinkPriceFeed: undefined,
                maxCumulativeDeltaDiff: defaultMaxCumulativeDeltaDiff,
                marketCfg: mediumLeverageCfg,
            },
            {
                name: "DOT",
                chainLinkPriceFeed: undefined,
                maxCumulativeDeltaDiff: defaultMaxCumulativeDeltaDiff,
                marketCfg: mediumLeverageCfg,
            },
            {
                name: "ATOM",
                chainLinkPriceFeed: undefined,
                maxCumulativeDeltaDiff: defaultMaxCumulativeDeltaDiff,
                marketCfg: mediumLeverageCfg,
            },
            {
                name: "NEAR",
                chainLinkPriceFeed: undefined,
                maxCumulativeDeltaDiff: defaultMaxCumulativeDeltaDiff,
                marketCfg: mediumLeverageCfg,
            },
            {
                name: "UNI",
                chainLinkPriceFeed: undefined,
                maxCumulativeDeltaDiff: defaultMaxCumulativeDeltaDiff,
                marketCfg: mediumLeverageCfg,
            },
            {
                name: "AAVE",
                chainLinkPriceFeed: undefined,
                maxCumulativeDeltaDiff: defaultMaxCumulativeDeltaDiff,
                marketCfg: mediumLeverageCfg,
            },
            {
                name: "GMX",
                chainLinkPriceFeed: undefined,
                maxCumulativeDeltaDiff: defaultMaxCumulativeDeltaDiff,
                marketCfg: mediumLeverageCfg,
            },
            {
                name: "DYDX",
                chainLinkPriceFeed: undefined,
                maxCumulativeDeltaDiff: defaultMaxCumulativeDeltaDiff,
                marketCfg: mediumLeverageCfg,
            },
            {
                name: "SNX",
                chainLinkPriceFeed: undefined,
                maxCumulativeDeltaDiff: defaultMaxCumulativeDeltaDiff,
                marketCfg: mediumLeverageCfg,
            },
            {
                name: "MKR",
                chainLinkPriceFeed: undefined,
                maxCumulativeDeltaDiff: defaultMaxCumulativeDeltaDiff,
                marketCfg: mediumLeverageCfg,
            },
            {
                name: "SUI",
                chainLinkPriceFeed: undefined,
                maxCumulativeDeltaDiff: defaultMaxCumulativeDeltaDiff,
                marketCfg: mediumLeverageCfg,
            },
            {
                name: "TIA",
                chainLinkPriceFeed: undefined,
                maxCumulativeDeltaDiff: defaultMaxCumulativeDeltaDiff,
                marketCfg: mediumLeverageCfg,
            },
            {
                name: "INJ",
                chainLinkPriceFeed: undefined,
                maxCumulativeDeltaDiff: defaultMaxCumulativeDeltaDiff,
                marketCfg: mediumLeverageCfg,
            },
            {
                name: "LDO",
                chainLinkPriceFeed: undefined,
                maxCumulativeDeltaDiff: defaultMaxCumulativeDeltaDiff,
                marketCfg: mediumLeverageCfg,
            },
            {
                name: "1000PEPE",
                chainLinkPriceFeed: undefined,
                maxCumulativeDeltaDiff: defaultMaxCumulativeDeltaDiff,
                marketCfg: mediumLeverageCfg,
            },
            {
                name: "STX",
                chainLinkPriceFeed: undefined,
                maxCumulativeDeltaDiff: defaultMaxCumulativeDeltaDiff,
                marketCfg: mediumLeverageCfg,
            },
            {
                name: "RUNE",
                chainLinkPriceFeed: undefined,
                maxCumulativeDeltaDiff: defaultMaxCumulativeDeltaDiff,
                marketCfg: mediumLeverageCfg,
            },
            {
                name: "LTC",
                chainLinkPriceFeed: undefined,
                maxCumulativeDeltaDiff: defaultMaxCumulativeDeltaDiff,
                marketCfg: mediumLeverageCfg,
            },
            {
                name: "ETC",
                chainLinkPriceFeed: undefined,
                maxCumulativeDeltaDiff: defaultMaxCumulativeDeltaDiff,
                marketCfg: mediumLeverageCfg,
            },
            {
                name: "CRV",
                chainLinkPriceFeed: undefined,
                maxCumulativeDeltaDiff: defaultMaxCumulativeDeltaDiff,
                marketCfg: lowLeverageCfg,
            },
            {
                name: "SUSHI",
                chainLinkPriceFeed: undefined,
                maxCumulativeDeltaDiff: defaultMaxCumulativeDeltaDiff,
                marketCfg: lowLeverageCfg,
            },
            {
                name: "ORDI",
                chainLinkPriceFeed: undefined,
                maxCumulativeDeltaDiff: defaultMaxCumulativeDeltaDiff,
                marketCfg: lowLeverageCfg,
            },
            {
                name: "RDNT",
                chainLinkPriceFeed: undefined,
                maxCumulativeDeltaDiff: defaultMaxCumulativeDeltaDiff,
                marketCfg: lowLeverageCfg,
            },
            {
                name: "FIL",
                chainLinkPriceFeed: undefined,
                maxCumulativeDeltaDiff: defaultMaxCumulativeDeltaDiff,
                marketCfg: lowLeverageCfg,
            },
            {
                name: "SEI",
                chainLinkPriceFeed: undefined,
                maxCumulativeDeltaDiff: defaultMaxCumulativeDeltaDiff,
                marketCfg: lowLeverageCfg,
            },
            {
                name: "BLUR",
                chainLinkPriceFeed: undefined,
                maxCumulativeDeltaDiff: defaultMaxCumulativeDeltaDiff,
                marketCfg: lowLeverageCfg,
            },
            {
                name: "MINA",
                chainLinkPriceFeed: undefined,
                maxCumulativeDeltaDiff: defaultMaxCumulativeDeltaDiff,
                marketCfg: lowLeverageCfg,
            },
            {
                name: "NTRN",
                chainLinkPriceFeed: undefined,
                maxCumulativeDeltaDiff: defaultMaxCumulativeDeltaDiff,
                marketCfg: lowLeverageCfg,
            },
            {
                name: "1000BONK",
                chainLinkPriceFeed: undefined,
                maxCumulativeDeltaDiff: defaultMaxCumulativeDeltaDiff,
                marketCfg: lowLeverageCfg,
            },
        ],
        mixedExecutors: ["0x8D2b663E72A8e29C771e9d0985d313bdd817BB28", "0xe78E0EC237996CF4965623ed6d474acE5Fd36301"],
    },
};
