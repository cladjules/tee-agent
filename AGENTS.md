# Tee Agent

## Overview

Full-stack framework for deploying AI agents as sovereign on-chain entities. Each agent is an ERC-721 NFT on **Base** or **Base Sepolia** with private encrypted data managed through a Phala Cloud TDX TEE oracle. Implements ERC-8004 (Trustless Agent Registry + Reputation) and ERC-7857 (Intelligent Digital Assets with encrypted private metadata).

## Tech Stack

- **Monorepo**: Turborepo + npm workspaces
- **Smart Contracts**: Solidity 0.8.35, Hardhat 3.x, Hardhat Ignition, viaIR enabled
- **Chains**: Base (8453) + Base Sepolia (84532) — the only two supported chains
- **SDK packages**: TypeScript 6.x, NodeNext module resolution (`.js` extensions in imports)
- **Dashboard**: Next.js 16 App Router, React 19, Tailwind CSS 4, viem 2.x
- **Oracle server**: Express 4.x, Phala `@phala/dstack-sdk`, Intel TDX enclave
- **Oracle deployment**: Phala Cloud CVM via `apps/oracle/scripts/deploy-cvm.mjs`
- **Blob storage**: Data URIs (`data:application/json;base64,…`) — no external storage dependency
- **File storage**: `@0gfoundation/0g-ts-sdk` (0G Storage testnet) — for **encrypted ERC-7857 blobs only**
- **Metadata storage**: Pinata IPFS — for `agentMetadataUri` (ERC-8004 registration JSON, `ipfs://` URIs)
- **Encryption**: AES-256-GCM (content) + ECIES via `eciesjs` (key wrapping)
- **Ethers**: 6.x — used in `apps/oracle` and `packages/agent/zero-g.ts` for 0G Storage signing

## Repository Structure

```
packages/agent   — Types, encryption/decryption, ABIs, ZeroGStorageClient, AgentRegistry
apps/dashboard       — Next.js 16 dashboard (Server Actions only, no API routes)
apps/oracle          — Phala Cloud TDX re-encryption oracle server
contracts/           — Solidity contracts, Hardhat Ignition modules, tests
```

## Architecture Decisions

| Decision                                              | Rationale                                                                                                                                                                                                                                                                                                                                                                            | Date     |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| Base / Base Sepolia only                              | Single well-supported L2; old 0G chain (chainId 16602) removed                                                                                                                                                                                                                                                                                                                       | May 2026 |
| Explicit config only                                  | Do not add runtime fallbacks/defaults for RPC URLs, contract addresses, private keys, oracle URLs, chain selection, or deployment addresses. Missing required config should fail fast.                                                                                                                                                                                               | May 2026 |
| 0G Storage for encrypted blobs only                   | 0G is used exclusively for ERC-7857 encrypted intelligent data blobs (`zerog://` URIs). Agent metadata (ERC-8004 registration JSON) is pinned to IPFS via Pinata (`ipfs://` URIs`) — content-addressed and publicly readable without a storage-layer key.                                                                                                                            | May 2026 |
| Use official ERC-8004 singletons                      | Mainnet: Identity `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` / Reputation `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63`. Testnet: Identity `0x8004A818BFB912233c491871b3d84c89A494BD9e` / Reputation `0x8004B663056A597Dffe9eCcC1965A193B7388713`. The Identity Registry address is passed to the `AgentRegistry` constructor (immutable); `erc8004AgentId` is used for reputation. | May 2026 |
| Deploy our own ValidationRegistry                     | No confirmed global singleton exists for ValidationRegistry. `ValidationRegistry` is deployed alongside `AgentRegistry`; its address is stored in root `deployments.json`.                                                                                                                                                                                                           | May 2026 |
| Single data verifier interface                        | `TeeVerifier` implements `IAgentDataVerifier`. `AgentRegistry` stores the verifier address, calls it for ERC-7857 transfers, and passes oracle registration through it. Keep future verifier implementations behind the same interface.                                                                                                                                              | May 2026 |
| ABI exports as JSON                                   | `packages/agent/src/abis/*.json` are the source of truth; `abis.ts` is a thin re-exporter. `gen-abis.mjs` writes the JSON files; `ReputationRegistry.json` is maintained manually from upstream.                                                                                                                                                                                     | May 2026 |
| Server Actions only, no API routes                    | Next.js best practice for internal mutations/fetches                                                                                                                                                                                                                                                                                                                                 | May 2026 |
| Raw `fetch` to oracle, no `PhalaOracleClient` wrapper | Wrapper package (`packages/compute`) deleted — dashboard calls oracle directly                                                                                                                                                                                                                                                                                                       | May 2026 |
| `packages/core` deleted                               | Types moved into `packages/agent/src/types.ts`; network utils unused and removed                                                                                                                                                                                                                                                                                                     | May 2026 |
| `AgentNFTClient` deleted                              | Never called from any app; registry reads go through `AgentRegistry`                                                                                                                                                                                                                                                                                                                 | May 2026 |

## Environment Variables

### Shared

| Variable / file        | Required | Description                                                                 |
| ---------------------- | -------- | --------------------------------------------------------------------------- |
| `deployments.json`     | Yes      | Public contract addresses and first deployment blocks for deployed networks |
| `PRIVATE_KEY`          | Yes      | Deployer / server-side signer                                               |
| `RPC_URL_BASE`         | Network  | EVM RPC for Base mainnet                                                    |
| `RPC_URL_BASE_SEPOLIA` | Network  | EVM RPC for Base Sepolia                                                    |

### Dashboard

| Variable                               | Required | Description                                                      |
| -------------------------------------- | -------- | ---------------------------------------------------------------- |
| `PORT`                                 | Yes      | Dashboard HTTP port                                              |
| `ZERO_G_RPC_URL`                       | Yes      | 0G Storage EVM RPC                                               |
| `ZERO_G_INDEXER_URL`                   | Yes      | 0G Indexer URL                                                   |
| `PINATA_JWT`                           | Yes      | Pinata Bearer JWT for IPFS metadata uploads (`agentMetadataUri`) |
| `VALIDATION_ORACLE_URLS`               | Yes      | Comma-separated `teeOracle` URLs this dashboard worker owns      |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | Yes      | WalletConnect project ID                                         |
| `UPSTASH_REDIS_REST_URL`               | No       | Upstash Redis REST URL — caches indexed agents + last-seen block |
| `UPSTASH_REDIS_REST_TOKEN`             | No       | Upstash Redis REST token                                         |
| `CRON_SECRET`                          | No       | Bearer token Vercel injects into cron requests                   |

### Oracle

| Variable                    | Required   | Description                                                           |
| --------------------------- | ---------- | --------------------------------------------------------------------- |
| `NETWORK`                   | Yes        | `base` or `baseSepolia`                                               |
| `ZERO_G_RPC_URL`            | Yes        | 0G Storage EVM RPC                                                    |
| `ZERO_G_INDEXER_URL`        | Yes        | 0G Indexer URL                                                        |
| `LLM_API_KEY`               | Yes        | LLM provider key for example oracle handlers and `/validate`          |
| `LLM_API_BASE`              | Yes        | OpenAI-compatible API base                                            |
| `LLM_VALIDATION_MODEL`      | Yes        | Model used by `/validate` scorer                                      |
| `PORT`                      | Yes        | HTTP port                                                             |
| `DSTACK_VERIFIER_URL`       | Yes        | dstack-verifier sidecar URL                                           |
| `DSTACK_SIMULATOR_ENDPOINT` | Local only | tappd simulator endpoint for local fake DCAP; omit in real Phala CVMs |

`ORACLE_ENTRY` is set by `apps/oracle/scripts/deploy-cvm.mjs` during deploy; do not put it in `.env`.

## Production Instructions

Production docs should prioritize deployability over app architecture. The most
important path is:

1. Deploy contracts on Base or Base Sepolia.
2. Run `contracts/setup-env` so root `deployments.json` contains
   `agentRegistry`, `teeVerifier`, `validationRegistry`, and scan start blocks.
3. Implement a production oracle entry under `apps/oracle/src` using
   `@tee-agent/server` and `startOracle({ handler, deployments })`.
4. Fill `apps/oracle/.env` explicitly. Do not set
   `DSTACK_SIMULATOR_ENDPOINT` in production.
5. Deploy the Phala CVM with
   `npm run deploy:oracle -- src/<path-to-oracle>.ts`.
6. Run `phala link` from `apps/oracle` after the first deploy so future deploys
   update the same CVM.
7. Use the public Phala HTTPS endpoint as the agent `teeOracle` service URL.
8. Mint agents through `@tee-agent/agent/mint`; do not hand-edit `teeOracle`
   for existing agents without an oracle key rotation flow.

Package roles:

- `@tee-agent/server`: production oracle runtime only.
- `@tee-agent/agent`: SDK for app/backend usage — config, ABIs, mint prep,
  transfer prep, registry reads, validation, feedback, service updates,
  encryption, and 0G Storage.

### Contracts

| Variable               | Required | Description                              |
| ---------------------- | -------- | ---------------------------------------- |
| `LOCAL_RPC_URL`        | Local    | RPC for local Hardhat deployment         |
| `BASE_SEPOLIA_RPC_URL` | Network  | RPC for Base Sepolia deployments         |
| `BASE_RPC_URL`         | Network  | RPC for Base mainnet deployments         |
| `EXPLORER_API_KEY`     | No       | Basescan API key for source verification |

### Root E2E

Root E2E tests live in `__tests__/` and load `__tests__/.env`.
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
| `ZERO_G_INDEXER_URL`   | Yes      | 0G Storage indexer used by encrypted blob storage              |

## Requirements

### Implemented

- [x] ERC-721 agent NFT mint on Base / Base Sepolia
- [x] ERC-8004 on-chain registry, reputation, and validation
- [x] ERC-7857 encrypted intelligent data (AES-256-GCM + ECIES key wrapping)
- [x] Inline data URI blobs for public metadata (on-chain)
- [x] 0G Storage upload for private encrypted blobs
- [x] IPFS (Pinata) upload for agent metadata JSON (`agentMetadataUri`)
- [x] Phala Cloud TDX oracle for secure NFT transfers (key re-wrapping inside TEE)
- [x] Dashboard: create, list, view, update agents
- [x] Dashboard: decrypt intelligent data (owner-only, signature-gated)
- [x] SDK two-party transfer helpers (`createTransferOffer`, `acceptTransferOffer`, `buildTransferTxArgs`)
- [x] `PublishedSealedKey` event lookup for reading transferred agents
- [x] E2E coverage for mint, ERC-7857 transfer, ERC-8004 identity transfer, reputation, validation, and `teeOracle` service metadata
- [x] Generic Phala CVM deploy script for any oracle entry under `apps/oracle/src`

### Pending / In Progress

- [ ] Deploy production oracle CVMs and point agent `teeOracle` services at them
- [ ] Dedicated oracle key rotation flow for changing an agent's `teeOracle`
- [ ] Add `forge test` step to CI (`npm run test:foundry` in `contracts/`)
- [ ] Basescan source verification after Base Sepolia deployment
- [ ] Trustless Agents Plus (TAP) support

## Known Issues & Follow-ups

- [ ] `axios` (transitive via `open-jsonrpc-provider`) has high-severity CVEs — no fix available upstream
- [ ] `elliptic` (transitive via `@ethersproject/signing-key`) has a CVE — no fix available upstream
- [ ] `@phala/dstack-sdk` is in the 0.1.x line; newer 0.x releases need manual review before upgrading
- [ ] Direct workspace dependencies use `eciesjs` 0.5.x; keep an eye on transitive older copies during dependency audits
- [ ] `express` 4.x is pinned; 5.2.1 (major) available — needs approval before upgrade

## Conventions

- All mutations and client-triggered data fetches use **Server Actions** in `apps/dashboard/src/lib/actions/` — no API routes for internal use
- Internal imports use `.js` extensions (NodeNext resolution)
- Sub-path exports only: `@tee-agent/agent/types`, `@tee-agent/agent/config`, `@tee-agent/agent/encryption`, `@tee-agent/agent/abis`, `@tee-agent/agent/registry`, `@tee-agent/agent/zero-g`, `@tee-agent/agent/mint`, `@tee-agent/agent/transfer`, `@tee-agent/agent/services`, `@tee-agent/agent/feedback`, `@tee-agent/agent/validate`, `@tee-agent/agent/typed-data`
- `zerog://` is the canonical URI scheme for private encrypted blobs; `data:application/json;base64,…` is used for public on-chain metadata
- Transfer flow belongs in `@tee-agent/agent/transfer` and must stay storage-agnostic. Dashboard storage is an implementation detail, not an SDK requirement.
- Oracle deployment command: `npm run deploy:oracle -- src/examples/<entry>.ts` from repo root, or `npm run deploy -- src/examples/<entry>.ts` from `apps/oracle`.
