import {ethers, hardhatArguments} from "hardhat";
import {networks} from "../../scripts/networks";

async function generate(chainId: bigint) {
    const network = networks[hardhatArguments.network as keyof typeof networks];
    if (network == undefined) {
        throw new Error(`network ${hardhatArguments.network} is not defined`);
    }
    const document = require(`../../deployments/${chainId}.json`);

    const marketManager = await ethers.getContractAt("MarketManager", document.deployments.MarketManager);

    const blockNumber = await marketManager.runner!.provider?.getBlockNumber();
    const market = "0xe43E2194a811C95e9125420eA1E8ed7F6715ff4B";
    const glp = await marketManager.globalLiquidityPositions(market, {blockTag: blockNumber});
    const ps = await marketManager.priceStates(market, {blockTag: blockNumber});

    console.log(`
    globalPosition = IMarketLiquidityPosition.GlobalLiquidityPosition({
        netSize: ${glp.netSize},
        liquidationBufferNetSize: ${glp.liquidationBufferNetSize},
        previousSPPriceX96: ${glp.previousSPPriceX96},
        side: Side.wrap(${glp.side}),
        liquidity: ${glp.liquidity},
        unrealizedPnLGrowthX64: ${glp.unrealizedPnLGrowthX64}
    });
    priceState = IMarketManager.PriceState({
        premiumRateX96: ${ps.premiumRateX96},
        pendingVertexIndex: ${ps.pendingVertexIndex},
        currentVertexIndex: ${ps.currentVertexIndex},
        basisIndexPriceX96: ${ps.basisIndexPriceX96},
        priceVertices: [
            IMarketManager.PriceVertex({size: ${ps.priceVertices[0].size}, premiumRateX96: ${ps.priceVertices[0].premiumRateX96}}),
            IMarketManager.PriceVertex({size: ${ps.priceVertices[1].size}, premiumRateX96: ${ps.priceVertices[1].premiumRateX96}}),
            IMarketManager.PriceVertex({size: ${ps.priceVertices[2].size}, premiumRateX96: ${ps.priceVertices[2].premiumRateX96}}),
            IMarketManager.PriceVertex({size: ${ps.priceVertices[3].size}, premiumRateX96: ${ps.priceVertices[3].premiumRateX96}}),
            IMarketManager.PriceVertex({size: ${ps.priceVertices[4].size}, premiumRateX96: ${ps.priceVertices[4].premiumRateX96}}),
            IMarketManager.PriceVertex({size: ${ps.priceVertices[5].size}, premiumRateX96: ${ps.priceVertices[5].premiumRateX96}}),
            IMarketManager.PriceVertex({size: ${ps.priceVertices[6].size}, premiumRateX96: ${ps.priceVertices[6].premiumRateX96}}),
            IMarketManager.PriceVertex({size: ${ps.priceVertices[7].size}, premiumRateX96: ${ps.priceVertices[7].premiumRateX96}}),
            IMarketManager.PriceVertex({size: ${ps.priceVertices[8].size}, premiumRateX96: ${ps.priceVertices[8].premiumRateX96}}),
            IMarketManager.PriceVertex({size: ${ps.priceVertices[9].size}, premiumRateX96: ${ps.priceVertices[9].premiumRateX96}})
        ],
        liquidationBufferNetSizes: [
            uint128(${ps.liquidationBufferNetSizes[0]}), 
            uint128(${ps.liquidationBufferNetSizes[1]}), 
            uint128(${ps.liquidationBufferNetSizes[2]}), 
            uint128(${ps.liquidationBufferNetSizes[3]}), 
            uint128(${ps.liquidationBufferNetSizes[4]}), 
            uint128(${ps.liquidationBufferNetSizes[5]}), 
            uint128(${ps.liquidationBufferNetSizes[6]}), 
            uint128(${ps.liquidationBufferNetSizes[7]}), 
            uint128(${ps.liquidationBufferNetSizes[8]}), 
            uint128(${ps.liquidationBufferNetSizes[9]})
    ]
    });    
    `);
}

async function main() {
    await generate((await ethers.provider.getNetwork()).chainId);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
