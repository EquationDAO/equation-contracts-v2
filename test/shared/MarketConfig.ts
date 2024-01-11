export function newMarketBaseConfig() {
    return {
        minMarginPerLiquidityPosition: 10n * 10n ** 6n,
        maxLeveragePerLiquidityPosition: 200n,
        liquidationFeeRatePerLiquidityPosition: 200_000n, // 0.2%

        minMarginPerPosition: 10n * 10n ** 6n,
        maxLeveragePerPosition: 200n,
        liquidationFeeRatePerPosition: 200_000n, // 0.2%
        maxPositionLiquidity: 10n ** 28n,
        maxPositionValueRate: 100_000_000n, // 100%
        maxSizeRatePerPosition: 10_000_000n, // 10%

        interestRate: 1250n, // 0.00125%
        maxFundingRate: 150_000n, // 0.15%
        liquidationExecutionFee: 600_000n, // 0.6 USDC
    };
}

export function newMarketFeeRateConfig() {
    return {
        tradingFeeRate: 50_000n, // 0.05%
        protocolFeeRate: 30_000_000n, // 30%
        referralReturnFeeRate: 10_000_000n, // 10%
        referralParentReturnFeeRate: 1_000_000n, // 1%
        referralDiscountRate: 90_000_000n, // 90%
    };
}

export function newMarketPriceConfig() {
    return {
        maxPriceImpactLiquidity: 1_0000_0000n * 10n ** 6n,
        liquidationVertexIndex: 4n,
        vertices: [
            {
                balanceRate: 0n, // 0%
                premiumRate: 0n, // 0%
            },
            {
                balanceRate: 2000000n, // 2%
                premiumRate: 50000n, // 0.05%
            },
            {
                balanceRate: 4000000n, // 4%
                premiumRate: 100000n, // 0.1%
            },
            {
                balanceRate: 5000000n, // 5%
                premiumRate: 150000n, // 0.15%
            },
            {
                balanceRate: 6000000n, // 6%
                premiumRate: 200000n, // 0.2%
            },
            {
                balanceRate: 7000000n, // 7%
                premiumRate: 200000n, // 0.2%
            },
            {
                balanceRate: 8000000n, // 8%
                premiumRate: 200000n, // 0.2%
            },
            {
                balanceRate: 9000000n, // 9%
                premiumRate: 200000n, // 0.2%
            },
            {
                balanceRate: 10000000n, // 10%
                premiumRate: 1000000n, // 1%
            },
            {
                balanceRate: 100000000n, // 100%
                premiumRate: 20000000n, // 20%
            },
        ],
    };
}

export function newMarketConfig() {
    return {
        baseConfig: newMarketBaseConfig(),
        feeRateConfig: newMarketFeeRateConfig(),
        priceConfig: newMarketPriceConfig(),
    };
}
