# Tee Agent

Create, own, and manage AI agents on-chain with verifiable identity, private encrypted data, and transparent reputation.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.35-blue)](https://soliditylang.org)

---

## What is it?

Tee Agent is a full-stack framework for deploying AI agents as sovereign on-chain entities. Each agent is an ERC-721 NFT on **Base** or **Base Sepolia** with private encrypted data managed through a Phala Cloud Intel TDX TEE oracle.

The production shape is simple: deploy the contracts, deploy at least one Phala
CVM oracle, mint agents whose `teeOracle` service points at that CVM, then use
the SDK packages from your own app. The dashboard is a reference app, not a
required runtime.

---

## Production Guide

### 1. Deploy contracts

Choose the network and configure the matching RPC/private key in
`contracts/.env`.

```bash
cd contracts
npm test
npm run deploy:baseSepolia
# or
npm run deploy:base
npm run setup-env
```

`setup-env` writes public contract addresses to root `deployments.json`. Keep
that file with your app and oracle deployment; it is the source of truth for
`agentRegistry`, `teeVerifier`, `validationRegistry`, and scan start blocks.

DCAP mode is controlled by the Ignition parameter file:

- Base uses real DCAP.
- Base Sepolia can use real or fake DCAP through
  `contracts/ignition/parameters.baseSepolia.json`.
- Local development uses fake DCAP.

### 2. Implement an oracle entry

An oracle is just an `@tee-agent/server` handler. Put production entries under
`apps/oracle/src`, for example `apps/oracle/src/prod/my-oracle.ts`:

```typescript
import "dotenv/config";
import { z } from "zod";
import { startOracle, type AgentHandler } from "@tee-agent/server";
import deployments from "../../../../deployments.json" with { type: "json" };

const payloadSchema = z.object({
  prompt: z.string(),
});

const handler: AgentHandler = {
  async run(rawPayload, ctx) {
    const payload = payloadSchema.parse(rawPayload);
    const systemPrompt = ctx.blobs[0] as string;
    const config = ctx.blobs[1] as Record<string, unknown>;

    return {
      result: `${systemPrompt}\n\n${payload.prompt}`,
      config,
      signer: ctx.wallet.address,
    };
  },
};

await startOracle({ handler, deployments });
```

The server package handles the production plumbing:

- derives the oracle wallet inside the Phala TDX CVM
- self-registers that TEE-derived oracle address in `TeeVerifier`
- exposes `GET /address`, `POST /run`, `POST /reencrypt`, and `POST /validate`
- decrypts ERC-7857 blobs inside the TEE
- re-wraps transfer keys for recipient oracle public keys
- submits ERC-8004 validation responses

### 3. Configure the production oracle

Copy `apps/oracle/.env.example` to `apps/oracle/.env` and fill every required
value. Do not set local simulator values in production.

```dotenv
NETWORK=base
RPC_URL_BASE=
PRIVATE_KEY=
ZERO_G_RPC_URL=
ZERO_G_INDEXER_URL=
LLM_API_KEY=
LLM_API_BASE=
LLM_VALIDATION_MODEL=
PORT=3001
DSTACK_VERIFIER_URL=
```

`PRIVATE_KEY` is the transaction signer. It pays gas for `initValidator`,
validation responses, and 0G storage operations. The oracle identity itself is
the TEE-derived wallet returned by `GET /address`.

### 4. Deploy the Phala CVM

Phala Cloud supports CVMs deployed from Docker Compose through the dashboard or
the `phala` CLI. This repo uses the CLI path so oracle deployment can be
scripted and repeated.

Install and authenticate the Phala CLI once:

```bash
npm install -g phala
phala login
```

Deploy any oracle source file under `apps/oracle/src`:

```bash
# from repo root
npm run deploy:oracle -- src/prod/my-oracle.ts

# equivalent from apps/oracle
cd apps/oracle
npm run deploy -- src/prod/my-oracle.ts
```

The deploy script validates the source path, maps it to the compiled
`dist/...js` entry, then runs:

```bash
phala deploy -e .env -e ORACLE_ENTRY=<compiled-entry> --wait
```

After the first deploy, link the local `apps/oracle/phala.toml` to the CVM so
future deploys update the same instance:

```bash
cd apps/oracle
phala link
```

In Phala Cloud, expose the oracle port and copy the public HTTPS endpoint from
the CVM Network tab. Production agents should use that URL as their
`teeOracle` service endpoint.

### 5. Verify the deployed oracle

```bash
curl https://your-oracle.example/health
curl https://your-oracle.example/address
curl https://your-oracle.example/info
curl https://your-oracle.example/attestation
```

`/address` returns the TEE-derived signer address and public key. On startup the
oracle calls `initValidator`; if that transaction fails, transfer, validation,
and decryption checks that depend on registered TEE oracle signatures will fail
on-chain.

### 6. Mint agents against the production oracle

When minting, include a `teeOracle` service that points at the deployed Phala
HTTPS endpoint. `prepareMint` calls `GET /address`, verifies the oracle, encrypts
private data for its public key, uploads encrypted blobs to 0G Storage, uploads
metadata to IPFS, and returns calldata-ready mint data.

```typescript
import { createConfig } from "@tee-agent/agent/config";
import { prepareMint } from "@tee-agent/agent/mint";
import { AGENT_REGISTRY_ABI } from "@tee-agent/agent/abis";
import deployments from "./deployments.json" with { type: "json" };

const config = createConfig(
  "base",
  {
    rpcUrl: process.env.RPC_URL_BASE!,
    pinataJwt: process.env.PINATA_JWT!,
    zeroGPrivateKey: process.env.PRIVATE_KEY!,
    zeroGRpcUrl: process.env.ZERO_G_RPC_URL!,
    zeroGIndexerUrl: process.env.ZERO_G_INDEXER_URL!,
  },
  deployments,
);

const prepared = await prepareMint(config, {
  name: "Production Agent",
  description: "Runs inside my Phala CVM oracle.",
  ownerAddress,
  services: [
    {
      name: "teeOracle",
      endpoint: "https://your-oracle.example",
    },
  ],
  privateEntries: [
    { name: "SKILL.md", data: "# System prompt\n..." },
    { name: "config", data: JSON.stringify({ model: "..." }) },
  ],
});

await walletClient.writeContract({
  address: prepared.contractAddress,
  abi: AGENT_REGISTRY_ABI,
  functionName: "mint",
  args: [
    ownerAddress,
    prepared.publicMetadataUri,
    prepared.agentMetadataUri,
    prepared.intelligentData,
  ],
  account: ownerAddress,
});
```

Changing `teeOracle` later is not a normal service edit. It requires oracle key
rotation so the encrypted blob keys are re-wrapped for the new oracle public
key.

### 7. Use the packages in your own app

Use `@tee-agent/server` only for oracle services. Use `@tee-agent/agent` for
everything a client or backend app needs: config, ABIs, mint prep, transfer
prep, registry reads, validation, feedback, service updates, encryption, and 0G
storage.

```typescript
import { AgentRegistry } from "@tee-agent/agent/registry";
import { createConfig } from "@tee-agent/agent/config";
import {
  createTransferOffer,
  acceptTransferOffer,
  buildTransferTxArgs,
} from "@tee-agent/agent/transfer";
```

The transfer helpers are storage-agnostic. Store `TransferOffer` and
`TransferAcceptance` in your own database, queue, inbox, IPFS object, or any
other message layer.

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
- **Transfer** the NFT — the sender oracle re-wraps encrypted content keys for the recipient oracle public key, the recipient signs acceptance proofs, and `TeeVerifier` verifies the transfer on-chain. No plaintext ever leaves the secure enclave.

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
4. **Transfer** — The sender creates a JSON-safe transfer offer, the recipient signs an acceptance, and the sender submits `iTransferFromWithIdentity`. Apps can store pending offers and acceptances in any storage layer.
5. **Validate** — Request on-chain validation by submitting a `validationRequest` naming `TEEVerifier`. The oracle scores the result inside the TEE and submits a `validationResponse` with a TDX-attested proof.
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
│   │   │   └── TeeVerifier.sol    # IAgentDataVerifier — TDX DCAP proofs
│   │   └── Utils.sol              # Contract helpers
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

Set `NETWORK=base` or `NETWORK=baseSepolia` in `apps/oracle/.env`. The dashboard can use both public networks simultaneously — switch via the RainbowKit network selector. RPC URLs must be configured explicitly; missing required config fails fast.

---

## Smart Contracts

| Contract             | Standard | Description                                                            |
| -------------------- | -------- | ---------------------------------------------------------------------- |
| `AgentRegistry`      | ERC-7857 | Agent NFT with encrypted intelligent data and ERC-8004 co-registration |
| `ValidationRegistry` | ERC-8004 | Validation requests and responses with optional TDX-attested proofs    |
| `TeeVerifier`        | ERC-7857 | `IAgentDataVerifier` — verifies transfer and validation TDX proofs     |

`AgentRegistry` stores the active `IAgentDataVerifier` address. `TeeVerifier`
self-registers oracle addresses through `initValidator` using a DCAP quote, and
the registry calls that verifier directly during ERC-7857 transfer and
ERC-8004 validation flows.

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

Transfer helpers live in `@tee-agent/agent/transfer`:

```typescript
import {
  createTransferOffer,
  acceptTransferOffer,
  buildTransferTxArgs,
} from "@tee-agent/agent/transfer";
```

The SDK transfer flow is storage-agnostic: `createTransferOffer` and
`acceptTransferOffer` return plain JSON payloads, so apps can persist pending
transfers in Redis, SQL, IPFS, or any other message layer.

Ownership transfer is a two-party SDK flow:

1. The sender signs `ReencryptRequest` for the sender oracle.
2. `createTransferOffer(...)` calls the sender oracle `POST /reencrypt`, which
   re-wraps each encrypted content key for the recipient oracle public key.
3. The recipient signs one access proof per encrypted data entry with their
   wallet.
4. The sender submits `buildTransferTxArgs(...)`, which calls
   `AgentRegistry.iTransferFromWithIdentity(from, to, tokenId, proofs)`.

`iTransferFromWithIdentity` moves both the ERC-7857 NFT and the linked ERC-8004
Identity Registry token in one transaction. The transfer emits
`PublishedSealedKey(to, tokenId, sealedKeys)`; recipient oracles use those
sealed keys to decrypt transferred agents without changing the encrypted blob
URIs.

Changing an agent's `teeOracle` service is a separate oracle-key-rotation flow,
not a regular services edit. The current oracle must re-wrap the existing
content keys for the new oracle public key, the encrypted blob metadata must be
updated, and the registry must anchor the new data hashes/URIs before the
ERC-8004 service endpoint changes. The dashboard shows this as a dedicated
rotation action instead of allowing silent `teeOracle` edits.

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
# Base Sepolia dev (starts tappd simulator via Docker Compose)
npm run dev:prediction-market --prefix apps/oracle

# Deploy any oracle entry to a Phala Cloud CVM
npm run deploy:oracle -- src/examples/prediction-market.ts
npm run deploy:oracle -- src/examples/web-data-oracle.ts
```

`apps/oracle/scripts/deploy-cvm.mjs` validates that the entry lives under
`apps/oracle/src`, maps it to the compiled `dist/...js` path, and calls
`phala deploy -e .env -e ORACLE_ENTRY=<entry> --wait`. `ORACLE_ENTRY` is set by
the deploy script and should not live in `.env`. After the first deploy, run
`phala link` from `apps/oracle` so future deploys update the same CVM.

On startup, the oracle reads root `deployments.json`, derives its TEE keypair,
and submits `initValidator` to `TeeVerifier`. The signer in `PRIVATE_KEY` must
have enough gas on the selected Base network for startup registration,
validation responses, and any 0G upload fees.

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
npm run deploy:baseSepolia        # deploys AgentRegistry, ValidationRegistry, TeeVerifier
npm run setup-env                 # writes all found deployed addresses to deployments.json
```

DCAP mode is selected by deployment parameters:

- Local always uses fake DCAP.
- Base Sepolia can use fake or real DCAP, depending on the
  `dcapAttestationAddress` in `contracts/ignition/parameters.baseSepolia.json`.
- Base always uses real DCAP.

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

| Variable                               | Required | Description                                                                                                                     |
| -------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `RPC_URL_BASE`                         | Network  | EVM RPC for Base mainnet (server-side only)                                                                                     |
| `RPC_URL_BASE_SEPOLIA`                 | Network  | EVM RPC for Base Sepolia (server-side only)                                                                                     |
| `deployments.json`                     | Yes      | Public deployed contract addresses, including `agentRegistry`, `teeVerifier`, `validationRegistry`, and scan start blocks       |
| `PORT`                                 | Yes      | Dashboard HTTP port                                                                                                             |
| `PRIVATE_KEY`                          | Yes      | Server-side signer key — never exposed to the client                                                                            |
| `VALIDATION_ORACLE_URLS`               | Yes      | Comma-separated `teeOracle` URLs this dashboard worker owns; only these URLs are auto-validated from `ValidationRequest` events |
| `ZERO_G_RPC_URL`                       | Yes      | 0G Storage EVM RPC                                                                                                              |
| `ZERO_G_INDEXER_URL`                   | Yes      | 0G Indexer URL                                                                                                                  |
| `PINATA_JWT`                           | Yes      | Pinata V3 Bearer JWT for IPFS metadata uploads (`org:files:write` scope)                                                        |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | Yes      | WalletConnect project ID (create at https://cloud.walletconnect.com)                                                            |
| `UPSTASH_REDIS_REST_URL`               | No       | Upstash Redis REST URL — caches indexed agents + last-seen block                                                                |
| `UPSTASH_REDIS_REST_TOKEN`             | No       | Upstash Redis REST token                                                                                                        |
| `CRON_SECRET`                          | No       | Bearer token Vercel injects into cron job requests (set in Vercel project settings)                                             |

### `apps/oracle`

| Variable                    | Required   | Description                                                                                                               |
| --------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------- |
| `NETWORK`                   | Yes        | `base` or `baseSepolia`                                                                                                   |
| `RPC_URL_BASE`              | Network    | EVM RPC for Base mainnet                                                                                                  |
| `RPC_URL_BASE_SEPOLIA`      | Network    | EVM RPC for Base Sepolia                                                                                                  |
| `deployments.json`          | Yes        | Public deployed contract addresses, including `agentRegistry`, `teeVerifier`, `validationRegistry`, and scan start blocks |
| `PRIVATE_KEY`               | Yes        | Signer used to submit `initValidator` on startup, plus validation responses and 0G fees                                   |
| `ZERO_G_RPC_URL`            | Yes        | 0G Storage EVM RPC                                                                                                        |
| `ZERO_G_INDEXER_URL`        | Yes        | 0G Indexer URL                                                                                                            |
| `LLM_API_KEY`               | Yes        | API key for LLM scoring (Red Pill for TEE-attested models: https://red-pill.ai)                                           |
| `LLM_API_BASE`              | Yes        | OpenAI-compatible API base                                                                                                |
| `LLM_VALIDATION_MODEL`      | Yes        | Model used by `/validate` scorer                                                                                          |
| `PORT`                      | Yes        | HTTP port                                                                                                                 |
| `DSTACK_VERIFIER_URL`       | Yes        | dstack-verifier sidecar URL                                                                                               |
| `DSTACK_SIMULATOR_ENDPOINT` | Local only | tappd simulator endpoint for local dev with fake DCAP; omit in real Phala CVMs                                            |

### `contracts`

| Variable               | Required | Description                                                         |
| ---------------------- | -------- | ------------------------------------------------------------------- |
| `PRIVATE_KEY`          | Yes      | Deployer key                                                        |
| `LOCAL_RPC_URL`        | Local    | RPC for local Hardhat deployment                                    |
| `BASE_SEPOLIA_RPC_URL` | Network  | RPC for Base Sepolia deployments                                    |
| `BASE_RPC_URL`         | Network  | RPC for Base mainnet deployments                                    |
| `EXPLORER_API_KEY`     | No       | Basescan API key for contract source verification (`--verify` flag) |

### `__tests__`

Root E2E tests load `__tests__/.env`; use `__tests__/.env.example` as the
template.
`npm run e2e:local` expects a running Hardhat node and an existing local
Ignition deployment under `contracts/ignition/deployments/chain-31337`.

| Variable               | Required | Description                                                    |
| ---------------------- | -------- | -------------------------------------------------------------- |
| `PRIVATE_KEY`          | Yes      | E2E signer for minting, transfer, validation, feedback, and 0G |
| `LOCAL_RPC_URL`        | Local    | RPC for `npm run e2e:local`                                    |
| `BASE_SEPOLIA_RPC_URL` | Network  | RPC for `npm run e2e:baseSepolia`                              |
| `ORACLE_URL`           | Yes      | Running oracle URL used by E2E tests                           |
| `PINATA_JWT`           | Yes      | Pinata JWT used by SDK minting for IPFS metadata               |
| `ZERO_G_RPC_URL`       | Yes      | 0G Storage EVM RPC used by encrypted blob uploads              |
| `ZERO_G_INDEXER_URL`   | Yes      | 0G Storage indexer used by encrypted blob uploads/downloads    |

`Network` means required when using that network. The project does not invent
RPC URLs, contract addresses, private keys, or oracle URLs at runtime.

---

## Open Standards

- **[ERC-8004](https://eips.ethereum.org/EIPS/eip-8004)** — Trustless Agent Registry (identity, reputation, validation)
- **[ERC-7857](https://eips.ethereum.org/EIPS/eip-7857)** — Intelligent Digital Assets (ownable AI agents with encrypted private metadata)
