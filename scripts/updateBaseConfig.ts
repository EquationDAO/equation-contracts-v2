import {ethers, hardhatArguments} from "hardhat";
import {networks} from "./networks";
import {parsePercent} from "./util";

async function main() {
    const network = networks[hardhatArguments.network as keyof typeof networks];
    if (network == undefined) {
        throw new Error(`network ${hardhatArguments.network} is not defined`);
    }
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const document = require(`../deployments/${chainId}.json`);

    const marketManager = await ethers.getContractAt("MarketManager", document.deployments.MarketManager);
    for (let item of document.deployments.registerMarkets) {
        const baseCfg = await marketManager.marketBaseConfigs(item.market);
        const newBaseCfg = {
            minMarginPerLiquidityPosition: baseCfg.minMarginPerLiquidityPosition,
            maxLeveragePerLiquidityPosition: baseCfg.maxLeveragePerLiquidityPosition,
            liquidationFeeRatePerLiquidityPosition: parsePercent("0%"),
            minMarginPerPosition: baseCfg.minMarginPerPosition,
            maxLeveragePerPosition: baseCfg.maxLeveragePerPosition,
            liquidationFeeRatePerPosition: baseCfg.liquidationFeeRatePerPosition,
            maxPositionLiquidity: baseCfg.maxPositionLiquidity,
            maxPositionValueRate: baseCfg.maxPositionValueRate,
            maxSizeRatePerPosition: baseCfg.maxSizeRatePerPosition,
            liquidationExecutionFee: baseCfg.liquidationExecutionFee,
            interestRate: baseCfg.interestRate,
            maxFundingRate: baseCfg.maxFundingRate,
        };

        await marketManager.updateMarketBaseConfig(item.market, newBaseCfg);
        console.log(`update base config for ${item.name}`);
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
