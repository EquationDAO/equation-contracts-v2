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
        const priceCfg = await marketManager.marketPriceConfigs(item.market);
        const vertices = [];
        for (let i = 0; i < priceCfg.vertices.length - 1; i++) {
            vertices.push({
                balanceRate: priceCfg.vertices[i].balanceRate,
                premiumRate: priceCfg.vertices[i].premiumRate,
            });
        }
        vertices.push({
            balanceRate: parsePercent("100%"),
            premiumRate: parsePercent("100%"),
        });
        await marketManager.updateMarketPriceConfig(item.market, {
            maxPriceImpactLiquidity: priceCfg.maxPriceImpactLiquidity,
            liquidationVertexIndex: priceCfg.liquidationVertexIndex,
            vertices: vertices,
        });
        console.log(`update price config for ${item.name}`);
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
