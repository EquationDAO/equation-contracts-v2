import "dotenv/config";
import {networks} from "../networks";

const document = require(`../../deployments/${process.env.CHAIN_ID}.json`);

module.exports = [
    networks[process.env.CHAIN_NAME as keyof typeof networks].farmRewardDistributorV2,
    `${document.deployments.MarketIndexer}`,
];