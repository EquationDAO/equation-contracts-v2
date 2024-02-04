import {ethers, hardhatArguments} from "hardhat";
import {networks} from "./networks";

async function main() {
    const network = networks[hardhatArguments.network as keyof typeof networks];
    if (network == undefined) {
        throw new Error(`network ${hardhatArguments.network} is not defined`);
    }
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const document = require(`../deployments/${chainId}.json`);

    const marketManager = await ethers.getContractAt("MarketManager", document.deployments.MarketManager);
    for (let item of document.deployments.registerMarkets) {
        if (item.name !== "ETH" && item.name !== "BTC") {
            continue;
        }
        const feeRateCfg = await marketManager.marketFeeRateConfigs(item.market);
        const newFeeRateCfg = {
            tradingFeeRate: feeRateCfg.tradingFeeRate,
            protocolFeeRate: feeRateCfg.protocolFeeRate,
            referralReturnFeeRate: feeRateCfg.referralReturnFeeRate,
            referralParentReturnFeeRate: feeRateCfg.referralParentReturnFeeRate,
            referralDiscountRate: 10_000_000,
        };

        await marketManager.updateMarketFeeRateConfig(item.market, newFeeRateCfg);
        console.log(`update fee rate config for ${item.name}`);
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
