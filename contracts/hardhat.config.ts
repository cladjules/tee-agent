import "dotenv/config";
import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";

import { configVariable, defineConfig } from "hardhat/config";

export default defineConfig({
  plugins: [hardhatToolboxViemPlugin],
  paths: {
    sources: "./src",
  },
  verify: {
    blockscout: {
      enabled: false,
    },
    etherscan: {
      apiKey: process.env.EXPLORER_API_KEY,
    },
    sourcify: {
      enabled: false,
    },
  },
  chainDescriptors: {
    84532: {
      name: "Base Sepolia",
      blockExplorers: {
        etherscan: {
          url: "https://sepolia.basescan.org",
        },
      },
    },
    8453: {
      name: "Base",
      blockExplorers: {
        etherscan: {
          url: "https://basescan.org",
        },
      },
    },
    421614: {
      name: "Arbitrum Sepolia",
      blockExplorers: {
        etherscan: {
          url: "https://sepolia.arbiscan.io",
        },
      },
    },
  },
  solidity: {
    profiles: {
      default: {
        version: "0.8.35",
        settings: {
          viaIR: true,
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
      production: {
        version: "0.8.35",
        settings: {
          viaIR: true,
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    },
  },
  networks: {
    hardhatMainnet: {
      type: "edr-simulated",
      chainType: "l1",
    },
    hardhatOp: {
      type: "edr-simulated",
      chainType: "op",
    },
    localhost: {
      type: "http",
      chainType: "l1",
      chainId: 31337,
      url: configVariable("LOCAL_RPC_URL"),
      accounts: [configVariable("TESTNET_PRIVATE_KEY")],
    },
    baseSepolia: {
      type: "http",
      chainType: "op",
      chainId: 84532,
      url: configVariable("RPC_URL_BASE_SEPOLIA"),
      accounts: [configVariable("TESTNET_PRIVATE_KEY")],
    },
    base: {
      type: "http",
      chainType: "op",
      chainId: 8453,
      url: configVariable("RPC_URL_BASE"),
      accounts: [configVariable("MAINNET_PRIVATE_KEY")],
    },
    arbitrumSepolia: {
      type: "http",
      chainType: "generic",
      chainId: 421614,
      url: configVariable("RPC_URL_ARBITRUM_SEPOLIA"),
      accounts: [configVariable("TESTNET_PRIVATE_KEY")],
    },
  },
});
