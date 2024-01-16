import "dotenv/config";
import {networks} from "../networks";

const document = require(`../../deployments/${process.env.CHAIN_ID}.json`);

module.exports = [
    `${document.deployments.Router}`,
    `${document.deployments.MarketManager}`,
    networks[process.env.CHAIN_NAME as keyof typeof networks].usd,
    networks[process.env.CHAIN_NAME as keyof typeof networks].efc,
];