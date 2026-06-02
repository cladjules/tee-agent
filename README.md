# Tee Agent

Create, own, and manage AI agents on-chain with verifiable identity, private encrypted data, and transparent reputation.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.35-blue)](https://soliditylang.org)

---

## What is it?

Tee Agent is a full-stack framework for deploying AI agents as sovereign on-chain entities. Each agent is an ERC-721 NFT on **Base** or **Base Sepolia** with private encrypted data managed through a Phala Cloud Intel TDX TEE oracle.

**Architecture:** The Next.js dashboard owns all contract writes directly via viem. SDK packages provide read-only clients, encryption/decryption helpers, and a reusable oracle server factory. The oracle runs inside a TEE enclave — private data never leaves it in plaintext.

---

## Core Pillars

### 1. On-Chain Agent Identity — ERC-721 + ERC-8004

Every agent is minted as an **ERC-721 NFT**. Ownership is registered on-chain with an **EIP-712 typed-data proof**, ensuring the agent wallet signature is verifiable by anyone.

- Agent identity is tied to the NFT token ID — transferable and composable with existing NFT infrastructure
- Agents are minted through `AgentRegistry` (ERC-7857) and co-registered with the official ERC-8004 Identity Registry
- Service endpoints (MCP, A2A, web, DID, etc.) are defined on-chain with the agent

### 2. Private Intelligent Data — ERC-7857 + TEE Oracle

Sensitive agent data — system prompts, API keys, knowledge bases — is stored as **Intelligent Data** per [ERC-7857](https://eips.ethereum.org/EIPS/eip-7857). All data is AES-256-GCM encrypted and uploaded to **0G Storage**. The `zerog://` URI and a content hash are anchored on-chain.

- Data is encrypted with **AES-256-GCM**, with sealed keys managed by a **TEE Oracle** (Intel TDX via Phala Cloud)
- Only the current owner (or explicitly approved wallets) can decrypt and use the agent's private data
- **Transfer** the NFT — private data is automatically re-encrypted for the new owner inside the TEE, verified on-chain by `TEEVerifier`. No plaintext ever leaves the secure enclave.

### 3. On-Chain Reputation & Validation — ERC-8004

Agents earn a verifiable, tamper-proof reputation through [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004).

- **Validation requests** can be submitted on-chain, naming a validator contract (e.g. `TEEVerifier`) or EOA to respond
- **Validation responses** carry a score (0–100) and optional evidence URI; the `TEEVerifier` path requires a TDX-attested proof
- **Reputation scores** are fixed-point values (int128 × 10^decimals) stored on-chain
- Reputation and service definitions travel with the agent NFT — new owners inherit the agent's full history

---

## Full Lifecycle

1. **Register** — Mint an ERC-721 NFT on Base. Sign an EIP-712 proof to link the agent wallet on-chain.
2. **Encrypt & Store** — Private data is AES-256-GCM encrypted and uploaded to **0G Storage**. The `zerog://` URI and content hash are anchored on-chain.
3. **Define Services** — Publish MCP, A2A, web, and other endpoints on-chain so other agents and clients can discover and connect.
4. **Approve or Transfer** — Approve wallets to access your agent's private data, or transfer the NFT. On transfer, the TEE re-encrypts all private data for the new owner — verified on-chain.
5. **Validate** — Request on-chain validation by submitting a `validationRequest` naming `TEEVerifier`. The oracle scores the result inside the TEE and submits a `validationResponse` with a TDX-attested proof (production) or ECDSA signature (simulator).
6. **Earn Reputation** — Validation scores accumulate on-chain and persist across ownership changes.

---

## Repository Structure

```
open-agent/
├── packages/
│   ├── agent/          # Types, ABIs, encryption, registry clients, network config
│   └── server/         # Reusable TEE oracle server factory (startOracle)
├── contracts/          # Solidity 0.8.35 (Hardhat + viaIR)
│   ├── src/
│   │   ├── AgentRegistry.sol      # ERC-7857 agent NFT + encrypted data
│   │   ├── ERC7857.sol            # ERC-7857 Intelligent Digital Asset base
│   │   ├── ValidationRegistry.sol # ERC-8004 validation requests + responses
│   │   ├── verifiers/
│   │   │   └── TeeVerifier.sol    # IAgentDataVerifier — TDX DCAP + ECDSA proofs
│   │   └── Utils.sol              # ERC-7857 data verifier (wraps TeeVerifier)
│   ├── test/                      # Contract tests (Hardhat)
│   └── ignition/                  # Hardhat Ignition deployment modules + parameters
└── apps/
    ├── dashboard/      # Next.js 16 App Router — agent management UI
    └── oracle/         # Example oracle deployments (prediction-market, web-fetcher)
```

---

## Networks

| Network      | Chain ID | RPC                      | Explorer                     |
| ------------ | -------- | ------------------------ | ---------------------------- |
| Base         | 8453     | https://mainnet.base.org | https://basescan.org         |
| Base Sepolia | 84532    | https://sepolia.base.org | https://sepolia.basescan.org |

Set `NETWORK=base` or `NETWORK=baseSepolia` (default: `baseSepolia`) in `apps/oracle/.env`. The dashboard uses both networks simultaneously — switch via the RainbowKit network selector.

---

## Smart Contracts

| Contract             | Standard | Description                                                                     |
| -------------------- | -------- | ------------------------------------------------------------------------------- |
| `AgentRegistry`      | ERC-7857 | Agent NFT with encrypted intelligent data and ERC-8004 co-registration          |
| `ValidationRegistry` | ERC-8004 | Validation requests and responses with optional TDX-attested proofs             |
| `TeeVerifier`        | ERC-7857 | `IAgentDataVerifier` — verifies TDX DCAP quotes or ECDSA signatures from oracle |
| `Verifier`           | ERC-7857 | ERC-7857 data verifier for NFT transfers (wraps `TeeVerifier`)                  |

ABIs are exported from `@tee-agent/agent/abis`:

```typescript
import {
  AGENT_REGISTRY_ABI,
  VALIDATION_REGISTRY_ABI,
  TEE_VERIFIER_ABI,
} from "@tee-agent/agent/abis";
```

---

## Packages

### `@tee-agent/agent`

Types, ABIs, encryption/decryption utilities, registry clients, 0G Storage, and network config.

Sub-path exports: `./types`, `./config`, `./encryption`, `./abis`, `./registry`, `./zero-g`, `./mint`, `./transfer`, `./services`, `./feedback`, `./validate`, `./typed-data`

```typescript
import { AgentRegistry } from "@tee-agent/agent/registry";
import { getNetworkConfig } from "@tee-agent/agent/config";
import {
  readJsonFromUri,
  buildAccessPayloads,
} from "@tee-agent/agent/encryption";
import { ZeroGStorageClient } from "@tee-agent/agent/zero-g";
```

`getNetworkConfig` returns per-chain addresses, explorer URLs, and OpenSea links — keyed by chain name:

```typescript
import { getNetworkConfigByChainId } from "@tee-agent/agent/config";
const nc = getNetworkConfigByChainId(84532);
// nc.chain, nc.chainId, nc.isTestnet,
// nc.identityRegistryAddress, nc.reputationRegistryAddress,
// nc.explorerUrl, nc.erc8004ScanUrl, nc.openseaUrl
```

### `@tee-agent/server`

Reusable TEE oracle server factory. Implement an `AgentHandler` and call `startOracle`:

```typescript
import { startOracle, type AgentHandler } from "@tee-agent/server";

const handler: AgentHandler = {
  async run(payload, ctx) {
    // ctx.blobs contains decrypted private data from 0G Storage
    return { result: "..." };
  },
};

await startOracle({ handler });
```

The server handles: TEE key derivation via Phala dstack SDK, 0G Storage blob fetch + ECIES-unwrap + AES-256-GCM decrypt, EIP-712 signature verification, TDX DCAP attestation, and on-chain validation response submission.

HTTP endpoints: `GET /health`, `GET /address`, `GET /info`, `GET /attestation`, `POST /verify`, `POST /reencrypt`, `POST /run`, `POST /validate`

---

## Apps

### `apps/dashboard`

Next.js 16 App Router UI. Connects to Base or Base Sepolia.

- All contract writes execute in the browser via viem — no backend proxy
- Server Actions (`src/lib/actions/`) handle encryption and oracle calls
- No API routes for internal mutations; the only API route is the cron sync endpoint

### `apps/oracle`

Example oracle deployments built on `@tee-agent/server`:

| Example                             | Description                             |
| ----------------------------------- | --------------------------------------- |
| `src/examples/prediction-market.ts` | Price/outcome oracle with LLM scoring   |
| `src/examples/web-data-oracle.ts`   | Fetches and summarises web data via LLM |

```bash
# Local dev (starts tappd simulator via Docker Compose)
npm run dev:prediction-market --prefix apps/oracle

# Deploy to Phala Cloud
npm run deploy:prediction-market --prefix apps/oracle
```

---

## Quick Start

### Prerequisites

- Node.js ≥ 20, npm ≥ 10
- Docker (for local tappd simulator)
- A wallet funded on Base Sepolia (faucet: https://www.coinbase.com/faucets/base-ethereum-goerli-faucet)

### 1. Install and build

```bash
npm install
npm run build --workspace=packages/agent
npm run build --workspace=packages/server
```

### 2. Fund 0G testnet wallet

Private blob uploads require 0G testnet tokens. Fund the wallet used by `PRIVATE_KEY`:

- Faucet: https://faucet.0g.ai
- RPC: `https://evmrpc-testnet.0g.ai`

### 3. Deploy contracts to Base Sepolia

```bash
cd contracts
npm test                          # run contract tests first
npm run deploy:baseSepolia        # deploys AgentRegistry, ValidationRegistry, TeeVerifier, Verifier
npm run setup-env -- baseSepolia  # writes deployed addresses to deployments.json
```

### 4. Configure environment files

```bash
cp apps/dashboard/.env.example apps/dashboard/.env
cp apps/oracle/.env.example    apps/oracle/.env
cp contracts/.env.example      contracts/.env
```

Fill in the required values in each file — see the tables below.

### 5. Start

```bash
# Dashboard + oracle together (turbo)
npm run dev

# Dashboard only
npm run dev --workspace=apps/dashboard
```

---

## Environment Variables

### `apps/dashboard`

| Variable                               | Required | Description                                                                                      |
| -------------------------------------- | -------- | ------------------------------------------------------------------------------------------------ |
| `RPC_URL_BASE`                         | No       | EVM RPC for Base mainnet (server-side only)                                                      |
| `RPC_URL_BASE_SEPOLIA`                 | No       | EVM RPC for Base Sepolia (server-side only; at least one RPC URL required)                       |
| `deployments.json`                     | No       | Public deployed contract addresses and AgentRegistry scan start blocks (auto-set by `setup-env`) |
| `PRIVATE_KEY`                          | Yes      | Server-side signer key — never exposed to the client                                             |
| `ZERO_G_RPC_URL`                       | No       | 0G Storage EVM RPC (default: `https://evmrpc-testnet.0g.ai`)                                     |
| `ZERO_G_INDEXER_URL`                   | No       | 0G Indexer URL (default: turbo testnet indexer)                                                  |
| `PINATA_JWT`                           | Yes      | Pinata V3 Bearer JWT for IPFS metadata uploads (`org:files:write` scope)                         |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | No       | WalletConnect project ID (create at https://cloud.walletconnect.com; falls back to demo ID)      |
| `UPSTASH_REDIS_REST_URL`               | No       | Upstash Redis REST URL — caches indexed agents + last-seen block                                 |
| `UPSTASH_REDIS_REST_TOKEN`             | No       | Upstash Redis REST token                                                                         |
| `CRON_SECRET`                          | No       | Bearer token Vercel injects into cron job requests (set in Vercel project settings)              |

### `apps/oracle`

| Variable                    | Required | Description                                                                                  |
| --------------------------- | -------- | -------------------------------------------------------------------------------------------- |
| `NETWORK`                   | Yes      | `base` or `baseSepolia` (default: `baseSepolia`) — selects which per-network vars to use     |
| `RPC_URL_BASE`              | No       | EVM RPC for Base mainnet                                                                     |
| `RPC_URL_BASE_SEPOLIA`      | No       | EVM RPC for Base Sepolia (at least one required)                                             |
| `deployments.json`          | No       | Public deployed contract addresses, including `teeVerifier`, and AgentRegistry scan start blocks |
| `TEE_VERIFIER_ADDRESS`      | No       | Optional TeeVerifier override; otherwise read from `deployments.json`                        |
| `PRIVATE_KEY`               | Yes      | Signer used to submit `initValidator` on startup, plus validation responses and 0G fees       |
| `ZERO_G_RPC_URL`            | No       | 0G Storage EVM RPC (default: `https://evmrpc-testnet.0g.ai`)                                 |
| `ZERO_G_INDEXER_URL`        | No       | 0G Indexer URL (default: turbo testnet indexer)                                              |
| `LLM_API_KEY`               | No       | API key for LLM scoring (Red Pill for TEE-attested models: https://red-pill.ai)              |
| `LLM_API_BASE`              | No       | OpenAI-compatible API base (default: `https://api.red-pill.ai/v1`)                           |
| `LLM_VALIDATION_MODEL`      | No       | Model used by `/validate` scorer (default: `phala/gemma-4-26b-a4b-uncensored`)               |
| `PORT`                      | No       | HTTP port (default: `3001`)                                                                  |
| `IDENTITY_REGISTRY_ADDRESS` | No       | Override ERC-8004 Identity Registry (default: official singleton for the network)            |
| `DSTACK_VERIFIER_URL`       | No       | dstack-verifier sidecar URL (default: `http://verifier:8080`)                                |
| `DSTACK_SIMULATOR_ENDPOINT` | No       | Local tappd simulator endpoint for dev (e.g. `http://localhost:8090`)                        |

### `contracts`

| Variable               | Required | Description                                                         |
| ---------------------- | -------- | ------------------------------------------------------------------- |
| `PRIVATE_KEY`          | Yes      | Deployer key                                                        |
| `BASE_SEPOLIA_RPC_URL` | Yes      | RPC for Base Sepolia deployments                                    |
| `BASE_RPC_URL`         | Yes      | RPC for Base mainnet deployments                                    |
| `EXPLORER_API_KEY`     | No       | Basescan API key for contract source verification (`--verify` flag) |

---

## Open Standards

- **[ERC-8004](https://eips.ethereum.org/EIPS/eip-8004)** — Trustless Agent Registry (identity, reputation, validation)
- **[ERC-7857](https://eips.ethereum.org/EIPS/eip-7857)** — Intelligent Digital Assets (ownable AI agents with encrypted private metadata)
