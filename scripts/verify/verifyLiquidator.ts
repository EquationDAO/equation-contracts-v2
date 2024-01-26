import "dotenv/config";
import {networks} from "../networks";
import {hardhatArguments} from "hardhat";

const document = require(`../../deployments/${process.env.CHAIN_ID}.json`);

module.exports = [
    `${document.deployments.Router}`,
    `${document.deployments.MarketManager}`,
    networks[hardhatArguments.network as keyof typeof networks].usd,
    networks[hardhatArguments.network as keyof typeof networks].efc,
];
