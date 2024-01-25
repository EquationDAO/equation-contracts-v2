import {ethers, hardhatArguments} from "hardhat";
import {networks} from "./networks";

async function main() {
    const network = networks[hardhatArguments.network as keyof typeof networks];
    if (network == undefined) {
        throw new Error(`network ${hardhatArguments.network} is not defined`);
    }
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const document = require(`../deployments/${chainId}.json`);

    const FarmRewardDistributor = await ethers.getContractFactory("FarmRewardDistributor");
    const farmRewardDistributor = await FarmRewardDistributor.deploy(
        network.farmRewardDistributorV2,
        document.deployments.MarketIndexer,
    );
    await farmRewardDistributor.waitForDeployment();
    console.log(`FarmRewardDistributor deployed to: ${await farmRewardDistributor.getAddress()}`);
    document.deployments.FarmRewardDistributor = await farmRewardDistributor.getAddress();

    const RewardCollector = await ethers.getContractFactory("RewardCollector");
    const rewardCollector = await RewardCollector.deploy(
        document.deployments.Router,
        network.routerV1,
        await farmRewardDistributor.getAddress(),
        network.farmRewardDistributorV2,
    );
    await rewardCollector.waitForDeployment();
    console.log(`RewardCollector deployed to: ${await rewardCollector.getAddress()}`);
    document.deployments.RewardCollector = await rewardCollector.getAddress();

    const fs = require("fs");
    fs.writeFileSync(`deployments/${chainId}.json`, JSON.stringify(document));

    const [contractsV2Gov, contractsV1Gov] = await ethers.getSigners();

    await farmRewardDistributor.setCollector(await rewardCollector.getAddress(), true);
    // Set distributor as minter
    const EQU = await ethers.getContractAt("IMultiMinter", network.equ);
    await EQU.connect(contractsV1Gov).setMinter(await farmRewardDistributor.getAddress(), true);
    const router = await ethers.getContractAt("Router", document.deployments.Router);
    await router.registerPlugin(await rewardCollector.getAddress());

    const routerV1 = await ethers.getContractAt("PluginManager", network.routerV1);
    await routerV1.connect(contractsV1Gov).registerPlugin(await rewardCollector.getAddress());
    const farmRewardDistributorV2 = await ethers.getContractAt(
        "FarmRewardDistributor",
        network.farmRewardDistributorV2,
    );
    await farmRewardDistributorV2.connect(contractsV1Gov).setCollector(await rewardCollector.getAddress(), true);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
