import "@nomicfoundation/hardhat-toolbox";
import "@nomiclabs/hardhat-solhint";
import "dotenv/config";
import "hardhat-contract-sizer";
import {HardhatUserConfig} from "hardhat/config";

const accounts = [
    `${process.env.PRIVATE_KEY ?? "9".repeat(64)}`,
    `${process.env.CONTRACTS_V1_PRIVATE_KEY ?? "9".repeat(64)}`,
];

const config: HardhatUserConfig = {
    solidity: {
        compilers: [
            {
                version: "0.8.23",
                settings: {
                    evmVersion: "paris",
                    viaIR: true,
                    optimizer: {
                        enabled: true,
                        runs: 1e8,
                    },
                },
            },
        ],
    },
    networks: {
        hardhat: {
            allowUnlimitedContractSize: false,
        },
        "arbitrum-sepolia": {
            url: "https://sepolia-rollup.arbitrum.io/rpc",
            chainId: 421614,
            accounts: accounts,
        },
        "arbitrum-mainnet": {
            url: "https://rpc.arb1.arbitrum.gateway.fm",
            chainId: 42161,
            accounts: accounts,
        },
    },
    etherscan: {
        apiKey: {
            arbitrumGoerli: `${process.env.ARBISCAN_API_KEY}`,
            arbitrumOne: `${process.env.ARBISCAN_API_KEY}`,
        },
    },
    sourcify: {
        enabled: false,
    },
};

export default config;
