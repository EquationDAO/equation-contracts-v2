import {ethers, hardhatArguments} from "hardhat";
import {networks} from "./networks";
import {getCreate2Address} from "@ethersproject/address";
import {keccak256} from "@ethersproject/keccak256";
import {encodePacked} from "web3-utils";
import {AddressZero} from "@ethersproject/constants";

export async function registerMarkets(chainId: bigint) {
    const network = networks[hardhatArguments.network as keyof typeof networks];
    if (network == undefined) {
        throw new Error(`network ${hardhatArguments.network} is not defined`);
    }
    const document = require(`../deployments/${chainId}.json`);

    const marketManager = await ethers.getContractAt("MarketManager", document.deployments.MarketManager);
    const marketIndexer = await ethers.getContractAt("MarketIndexer", document.deployments.MarketIndexer);
    const deployer = await ethers.getContractAt(
        "MarketDescriptorDeployer",
        document.deployments.MarketDescriptorDeployer,
    );
    console.log("markets count: ", network.markets.length);
    for (let item of network.markets) {
        const marketAddr = getCreate2Address(
            document.deployments.MarketDescriptorDeployer,
            keccak256(encodePacked(item.name)!),
            document.marketDescriptorInitCodeHash,
        );
        const deployedMarketAddr = await deployer.descriptors(item.name);
        if (deployedMarketAddr === AddressZero) {
            await deployer.deploy(item.name);
        }

        if (!(await marketManager.isEnabledMarket(marketAddr))) {
            await marketManager.enableMarket(marketAddr, {
                baseConfig: item.marketCfg.baseCfg,
                feeRateConfig: item.marketCfg.feeRateCfg,
                priceConfig: item.marketCfg.priceCfg,
            });
            console.log(`registering market ${item.name} at ${marketAddr}`);
        }
        if ((await marketIndexer.marketIndexes(marketAddr)) === 0n) {
            await marketIndexer.assignMarketIndex(marketAddr);
            document.deployments.registerMarkets.push({
                name: item.name,
                index: parseInt((await marketIndexer.marketIndexes(marketAddr)).toString()),
                address: marketAddr,
            });
        }
    }

    const fs = require("fs");
    fs.writeFileSync(`deployments/${chainId}.json`, JSON.stringify(document));
}

async function main() {
    await registerMarkets((await ethers.provider.getNetwork()).chainId);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
