import "dotenv/config";
import {networks} from "../networks";
import {hardhatArguments} from "hardhat";

module.exports = [
    networks[hardhatArguments.network as keyof typeof networks].usdChainLinkPriceFeed,
    0,
    networks[hardhatArguments.network as keyof typeof networks].ignoreReferencePriceFeedError,
];
