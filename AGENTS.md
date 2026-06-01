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
| 0G Storage for encrypted blobs only                   | 0G is used exclusively for ERC-7857 encrypted intelligent data blobs (`zerog://` URIs). Agent metadata (ERC-8004 registration JSON) is pinned to IPFS via Pinata (`ipfs://` URIs) — content-addressed and publicly readable without a storage-layer key.                                                                                                                             | May 2026 |
| Use official ERC-8004 singletons                      | Mainnet: Identity `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` / Reputation `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63`. Testnet: Identity `0x8004A818BFB912233c491871b3d84c89A494BD9e` / Reputation `0x8004B663056A597Dffe9eCcC1965A193B7388713`. The Identity Registry address is passed to the `AgentRegistry` constructor (immutable); `erc8004AgentId` is used for reputation. | May 2026 |
| Deploy our own ValidationRegistry                     | No confirmed global singleton exists for ValidationRegistry. `ValidationRegistry` is deployed alongside `AgentRegistry` in the Ignition module and takes `agentRegistry` as constructor arg. Address set via `VALIDATION_REGISTRY_ADDRESS` env var after deployment.                                                                                                                 | May 2026 |
| ABI exports as JSON                                   | `packages/agent/src/abis/*.json` are the source of truth; `abis.ts` is a thin re-exporter. `gen-abis.mjs` writes the JSON files; `ReputationRegistry.json` is maintained manually from upstream.                                                                                                                                                                                     | May 2026 |
| Server Actions only, no API routes                    | Next.js best practice for internal mutations/fetches                                                                                                                                                                                                                                                                                                                                 | May 2026 |
| Raw `fetch` to oracle, no `PhalaOracleClient` wrapper | Wrapper package (`packages/compute`) deleted — dashboard calls oracle directly                                                                                                                                                                                                                                                                                                       | May 2026 |
| `packages/core` deleted                               | Types moved into `packages/agent/src/types.ts`; network utils unused and removed                                                                                                                                                                                                                                                                                                     | May 2026 |
| `AgentNFTClient` deleted                              | Never called from any app; registry reads go through `AgentRegistry`                                                                                                                                                                                                                                                                                                                 | May 2026 |
| `ethers` pinned to exact minor (6.16.0)               | Used in oracle + zero-g.ts for 0G Storage signing; exact pin prevents unexpected bumps                                                                                                                                                                                                                                                                                               | May 2026 |

## Environment Variables

| Variable                      | Required | Description                                                                                                                                  |
| ----------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_NETWORK`         | Yes      | `base` or `baseSepolia` (default: baseSepolia)                                                                                               |
| `RPC_URL`                     | Yes      | EVM RPC for the app chain                                                                                                                    |
| `AGENT_REGISTRY_ADDRESS`      | Yes      | Deployed `AgentRegistry` contract                                                                                                            |
| `TEE_VERIFIER_ADDRESS`        | No       | Deployed `TEEVerifier`                                                                                                                       |
| `REPUTATION_REGISTRY_ADDRESS` | No       | Overrides ERC-8004 Reputation Registry (default: `0x8004BAa1…` mainnet / `0x8004B663…` testnet)                                              |
| `VALIDATION_REGISTRY_ADDRESS` | No       | Deployed `ValidationRegistry` contract (our own deployment — no default)                                                                     |
| `PRIVATE_KEY`                 | Yes      | Deployer / server-side signer                                                                                                                |
| `ZERO_G_PRIVATE_KEY`          | Yes      | Key for 0G Storage uploads of encrypted blobs (falls back to `PRIVATE_KEY`)                                                                  |
| `ZERO_G_RPC_URL`              | No       | 0G Storage EVM RPC (default: `https://evmrpc-testnet.0g.ai`)                                                                                 |
| `PINATA_JWT`                  | Yes      | Pinata Bearer JWT for IPFS metadata uploads (`agentMetadataUri`)                                                                             |
| `ZERO_G_INDEXER_URL`          | No       | 0G Indexer URL (default: `https://indexer-storage-testnet-turbo.0g.ai`)                                                                      |
| `TEE_ENCRYPTION_PUBLIC_KEY`   | No       | Removed — the dashboard now fetches the oracle's public key live from `GET /address` at mint time.                                           |
| `UPSTASH_REDIS_REST_URL`      | No       | Upstash Redis REST URL — caches indexed agents + last-seen block (free tier at console.upstash.com)                                          |
| `UPSTASH_REDIS_REST_TOKEN`    | No       | Upstash Redis REST token                                                                                                                     |
| `NEXT_PUBLIC_ORACLE_URL`      | No       | Phala Cloud CVM URL — used server-side (mint/transfer) and client-side (Run Oracle / Validate forms). Local default: `http://localhost:3001` |

## Requirements

### Implemented

- [x] ERC-721 agent NFT mint on Base / Base Sepolia
- [x] ERC-8004 on-chain registry, reputation, and validation
- [x] ERC-7857 encrypted intelligent data (AES-256-GCM + ECIES key wrapping)
- [x] Inline data URI blobs for public metadata (on-chain)
- [x] 0G Storage upload for private encrypted blobs
- [x] IPFS (Pinata) upload for agent metadata JSON (`agentMetadataUri`)
- [x] Phala Cloud TDX oracle for secure NFT transfers (re-encryption inside TEE)
- [x] Dashboard: create, list, view, update agents
- [x] Dashboard: decrypt intelligent data (owner-only, signature-gated)
- [x] `buildAccessPayloads` for owner-side access proof signing
- [x] `e2e-local.ts` for full local end-to-end test against Hardhat node

### Pending / In Progress

- [ ] Deploy oracle to Phala Cloud; register oracle address in `TEEVerifier`
- [ ] Basescan source verification after Base Sepolia deployment
- [ ] Trustless Agents Plus (TAP) support

## Known Issues & Follow-ups

- [ ] `axios` (transitive via `open-jsonrpc-provider`) has high-severity CVEs — no fix available upstream
- [ ] `elliptic` (transitive via `@ethersproject/signing-key`) has a CVE — no fix available upstream
- [ ] `@phala/dstack-sdk` is at 0.1.11; latest is 0.5.7 — needs manual review before upgrading (breaking 0.x changes)
- [ ] `eciesjs` 0.4.18 is in use; 0.5.0 is available but outside the current `^0.4.x` range — needs review
- [ ] `express` 4.x is pinned; 5.2.1 (major) available — needs approval before upgrade

## Conventions

- All mutations and client-triggered data fetches use **Server Actions** in `apps/dashboard/src/lib/actions/` — no API routes for internal use
- Internal imports use `.js` extensions (NodeNext resolution)
- Sub-path exports only: `@tee-agent/agent/types`, `@tee-agent/agent/encryption`, `@tee-agent/agent/zero-g`, `@tee-agent/agent/registry`, `@tee-agent/agent/abis`, `@tee-agent/agent/browser`
- `zerog://` is the canonical URI scheme for private encrypted blobs; `data:application/json;base64,…` is used for public on-chain metadata
