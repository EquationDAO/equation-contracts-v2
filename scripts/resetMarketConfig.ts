import {ethers, hardhatArguments} from "hardhat";
import {networks} from "./networks";
import {getCreate2Address} from "@ethersproject/address";
import {keccak256} from "@ethersproject/keccak256";
import {encodePacked} from "web3-utils";

export async function resetMarketConfig(chainId: bigint) {
    const network = networks[hardhatArguments.network as keyof typeof networks];
    if (network == undefined) {
        throw new Error(`network ${hardhatArguments.network} is not defined`);
    }
    const document = require(`../deployments/${chainId}.json`);

    const marketManager = await ethers.getContractAt("MarketManager", document.deployments.MarketManager);
    for (let item of network.markets) {
        const marketAddr = getCreate2Address(
            document.deployments.MarketDescriptorDeployer,
            keccak256(encodePacked(item.name)!),
            document.marketDescriptorInitCodeHash,
        );
        if (!(await marketManager.isEnabledMarket(marketAddr))) {
            continue;
        }

        try {
            await marketManager.updateMarketBaseConfig(marketAddr, item.marketCfg.baseCfg);
            await marketManager.updateMarketFeeRateConfig(marketAddr, item.marketCfg.feeRateCfg);
            await marketManager.updateMarketPriceConfig(marketAddr, item.marketCfg.priceCfg);
            console.log(`reset market config ${item.name} finished`);
        } catch (e) {
            console.log(`reset market config ${item.name} failed`);
            console.log(e);
        }
    }
}

async function main() {
    await resetMarketConfig((await ethers.provider.getNetwork()).chainId);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
