import {hardhatArguments} from "hardhat";
import {networks} from "./networks";

export async function validateMarkets() {
    const network = networks["arbitrum-mainnet"];
    if (network == undefined) {
        throw new Error(`network ${hardhatArguments.network} is not defined`);
    }
    const markets = [
        "eth",
        "btc",
        "sol",
        "arb",
        "op",
        "matic",
        "avax",
        "link",
        "ordi",
        "doge",
        "xrp",
        "ada",
        "bnb",
        "ltc",
        "etc",
        "fil",
        "sui",
        "tia",
        "dot",
        "blur",
        "inj",
        "sei",
        "trb",
        "atom",
        "apt",
        "near",
        "ldo",
        "dydx",
        "mkr",
        "stx",
        "ftm",
        "rune",
        "uni",
        "crv",
        "1000bonk",
        "ens",
        "aave",
        "1000pepe",
        "mina",
        "jto",
        "rdnt",
        "sushi",
        "1inch",
        "snx",
        "pendle",
        "ntrn",
        "pyth",
        "gmx",
    ];
    if (markets.length != network.markets.length) {
        throw new Error(`network ${hardhatArguments.network} markets length is not equal to ${markets.length}`);
    }
    const marketToProxy = await fetch(
        "https://reference-data-directory.vercel.app/feeds-ethereum-mainnet-arbitrum-1.json",
    )
        .then((resp) => resp.json())
        .then((json) => {
            const marketToProxy = new Map<string, string>();
            for (let item of json) {
                if (item.docs.quoteAsset !== "USD") {
                    continue;
                }
                if (!item.proxyAddress || !item.docs.baseAsset) {
                    continue;
                }
                if (item.name !== `${item.docs.baseAsset} / ${item.docs.quoteAsset}`) {
                    continue;
                }
                marketToProxy.set(item.docs.baseAsset, item.proxyAddress);
            }
            return marketToProxy;
        });
    for (let index in network.markets) {
        if (network.markets[index].name !== markets[index].toUpperCase()) {
            throw new Error(
                `network ${hardhatArguments.network} markets[${index}] name is not equal to ${markets[index]}`,
            );
        }
        if (!marketToProxy.has(network.markets[index].name)) {
            continue;
        }
        const proxy = marketToProxy.get(network.markets[index].name);
        if (proxy !== network.markets[index].chainLinkPriceFeed) {
            console.error(`network ${hardhatArguments.network} markets[${index}] proxy is not equal to ${proxy}`);
        }
    }
}

async function main() {
    await validateMarkets();
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
