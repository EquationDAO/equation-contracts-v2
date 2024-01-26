import "dotenv/config";
import {networks} from "../networks";
import {hardhatArguments} from "hardhat";

const document = require(`../../deployments/${process.env.CHAIN_ID}.json`);

module.exports = [
    `${document.deployments.Router}`,
    networks[hardhatArguments.network as keyof typeof networks].routerV1,
    `${document.deployments.FarmRewardDistributor}`,
    networks[hardhatArguments.network as keyof typeof networks].farmRewardDistributorV2,
];
