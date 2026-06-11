# Tee Agent

## Overview

Full-stack framework for deploying AI agents as sovereign on-chain entities. Each agent is an ERC-721 NFT on **Base**, **Base Sepolia**, or **Arbitrum Sepolia** with private encrypted data managed through a Phala Cloud TDX TEE oracle. Implements ERC-8004 (Trustless Agent Registry + Reputation) and ERC-7857 (Intelligent Digital Assets with encrypted private metadata).

## Tech Stack

- **Monorepo**: Turborepo + npm workspaces
- **Smart Contracts**: Solidity 0.8.35, Hardhat 3.x, Hardhat Ignition, viaIR enabled
- **Chains**: Base (8453), Base Sepolia (84532), Arbitrum Sepolia (421614)
- **SDK packages**: TypeScript 6.x, NodeNext module resolution (`.js` extensions in imports)
- **Dashboard**: Next.js 16 App Router, React 19, Tailwind CSS 4, viem 2.x
- **Oracle server**: Express 4.x, Phala `@phala/dstack-sdk`, Intel TDX enclave
- **Oracle deployment**: Phala Cloud CVM via root `scripts/deploy-cvm.mjs`
- **Blob storage**: Data URIs (`data:application/json;base64,…`) — no external storage dependency
- **File storage**: `@0gfoundation/0g-ts-sdk` (0G Storage testnet) — for **encrypted ERC-7857 blobs only**
- **Metadata storage**: Pinata IPFS — for `agentMetadataUri` (ERC-8004 registration JSON, `ipfs://` URIs)
- **Encryption**: AES-256-GCM (content) + ECIES via `eciesjs` (key wrapping)
- **Ethers**: 6.x — used in `apps/oracle` and `packages/agent/zero-g.ts` for 0G Storage signing

## AI Model

Always use **`gemini-3-flash-preview`** for Gemini API calls in scripts across
this repository.

## Repository Structure

```
packages/agent   — Types, encryption/decryption, ABIs, ZeroGStorageClient, AgentRegistry
apps/dashboard       — Next.js 16 dashboard (Server Actions only, no API routes)
apps/oracle          — Phala Cloud TDX re-encryption oracle server
contracts/           — Solidity contracts, Hardhat Ignition modules, tests
```

## Architecture Decisions

| Decision                                              | Rationale                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Date     |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Base + Arbitrum network set                           | Supported chains live in `NETWORK_CONFIG`; old 0G chain (chainId 16602) removed. Arbitrum Sepolia uses the same remote oracle path as Base Sepolia, with no local-oracle deployment mode.                                                                                                                                                                                                                                                                                                                  | Jun 2026 |
| Explicit config only                                  | Do not add runtime fallbacks/defaults for RPC URLs, contract addresses, private keys, oracle URLs, chain selection, or deployment addresses. Missing required config should fail fast.                                                                                                                                                                                                                                                                                                                     | May 2026 |
| 0G Storage for encrypted blobs only                   | 0G is used exclusively for ERC-7857 encrypted intelligent data blobs (`zerog://` URIs). Agent metadata (ERC-8004 registration JSON) is pinned to IPFS via Pinata (`ipfs://` URIs`) — content-addressed and publicly readable without a storage-layer key.                                                                                                                                                                                                                                                  | May 2026 |
| Use official ERC-8004 singletons                      | Mainnet: Identity `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` / Reputation `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63`. Testnet: Identity `0x8004A818BFB912233c491871b3d84c89A494BD9e` / Reputation `0x8004B663056A597Dffe9eCcC1965A193B7388713`. The Identity Registry address is passed to the `AgentRegistry` constructor (immutable); `erc8004AgentId` is used for reputation.                                                                                                                       | May 2026 |
| Deploy our own ValidationRegistry                     | No confirmed global singleton exists for ValidationRegistry. `ValidationRegistry` is deployed alongside `AgentRegistry`; its address is stored in root `deployments.json`.                                                                                                                                                                                                                                                                                                                                 | May 2026 |
| Single data verifier interface                        | `TeeVerifier` implements `IAgentDataVerifier`. `AgentRegistry` stores the verifier address, calls it for ERC-7857 transfers, and passes oracle registration through it. Keep future verifier implementations behind the same interface.                                                                                                                                                                                                                                                                    | May 2026 |
| Remote TEE trust is verified on-chain                 | Remote oracle deployments use Automata DCAP from `TeeVerifier` to verify Intel TDX quotes on-chain. `initValidator` quotes bind `reportData` to the TEE-derived oracle key; validation quotes bind the agent id, request hash, and score. Base Sepolia and Arbitrum Sepolia remote params use Automata DCAP v1.0 (`0x95175096a9B74165BE0ac84260cc14Fc1c0EF5FF`) because a real Phala Cloud TDX quote that fails with `TCBR` on v1.1 succeeds on v1.0. Dashboard/oracle URLs are not trusted by themselves. | Jun 2026 |
| ABI exports as JSON                                   | `packages/agent/src/abis/*.json` are the source of truth; `abis.ts` is a thin re-exporter. `gen-abis.mjs` writes the JSON files; `ReputationRegistry.json` is maintained manually from upstream.                                                                                                                                                                                                                                                                                                           | May 2026 |
| Server Actions only, no API routes                    | Next.js best practice for internal mutations/fetches                                                                                                                                                                                                                                                                                                                                                                                                                                                       | May 2026 |
| Browser wallet RPC for client flows                   | Client-side reads, gas estimates, receipt polling, and writes should use the connected wallet provider. Do not add `NEXT_PUBLIC_RPC_URL_*` or route browser wallet operations through Alchemy/app RPC. Server Actions/indexers still use server-side `RPC_URL_*` env because there is no wallet provider on the server.                                                                                                                                                                                    | Jun 2026 |
| Separate Base Sepolia local/remote oracle deployments | `remoteOracle` uses real Automata/DCAP for Phala CVMs. `localOracle` deploys a separate `MockDcapAttestation` contract for tappd simulator development. Root `deployments.json` has one active Base Sepolia contract set; switch manually with `ARBITRUM_SEPOLIA_ORACLE=remote` or `ARBITRUM_SEPOLIA_ORACLE=local`. No runtime profiles.                                                                                                                                                                   | Jun 2026 |
| Homepage is explorer-first                            | Homepage order is hero, contract addresses, three feature boxes, registered agents, and a compact animated deploy teaser. Put full documentation components on `/docs`, not on the homepage. Agent cards stay compact: image, name, and `AgentRegistry #<tokenId>` only; do not show IPFS/metadata URIs, owner address, tags, or ERC-8004 ids on the homepage card.                                                                                                                                        | Jun 2026 |
| Raw `fetch` to oracle, no `PhalaOracleClient` wrapper | Wrapper package (`packages/compute`) deleted — dashboard calls oracle directly                                                                                                                                                                                                                                                                                                                                                                                                                             | May 2026 |
| `packages/core` deleted                               | Types moved into `packages/agent/src/types.ts`; network utils unused and removed                                                                                                                                                                                                                                                                                                                                                                                                                           | May 2026 |
| `AgentNFTClient` deleted                              | Never called from any app; registry reads go through `AgentRegistry`                                                                                                                                                                                                                                                                                                                                                                                                                                       | May 2026 |

## Environment Variables

### Shared

| Variable / file            | Required | Description                                                                                                                                                          |
| -------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deployments.json`         | Yes      | Public contract addresses and first deployment blocks for deployed networks                                                                                          |
| `PRIVATE_KEY`              | Yes      | Deployer / server-side transaction signer. For dashboard automatic validation, dashboard and oracle `PRIVATE_KEY` must resolve to the same validation signer address |
| `RPC_URL_BASE`             | Network  | EVM RPC for Base mainnet                                                                                                                                             |
| `RPC_URL_BASE_SEPOLIA`     | Network  | EVM RPC for Base Sepolia                                                                                                                                             |
| `RPC_URL_ARBITRUM_SEPOLIA` | Network  | EVM RPC for Arbitrum Sepolia                                                                                                                                         |

### Dashboard

| Variable                               | Required | Description                                                      |
| -------------------------------------- | -------- | ---------------------------------------------------------------- |
| `PORT`                                 | Yes      | Dashboard HTTP port                                              |
| `RPC_URL_ZERO_G`                       | Yes      | 0G Storage EVM RPC                                               |
| `INDEXER_URL_ZERO_G`                   | Yes      | 0G Indexer URL                                                   |
| `PINATA_JWT`                           | Yes      | Pinata Bearer JWT for IPFS metadata uploads (`agentMetadataUri`) |
| `VALIDATION_ORACLE_URLS`               | Yes      | Comma-separated `teeOracle` URLs this dashboard worker owns      |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | Yes      | WalletConnect project ID                                         |
| `UPSTASH_REDIS_REST_URL`               | No       | Upstash Redis REST URL — caches indexed agents + last-seen block |
| `UPSTASH_REDIS_REST_TOKEN`             | No       | Upstash Redis REST token                                         |
| `CRON_SECRET`                          | No       | Bearer token Vercel injects into cron requests                   |

### Oracle

| Variable               | Required | Description                                                                                                                                                                                                                                           |
| ---------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NETWORK`              | Yes      | `base`, `baseSepolia`, or `arbitrumSepolia`                                                                                                                                                                                                           |
| `RPC_URL_ZERO_G`       | Yes      | 0G Storage EVM RPC                                                                                                                                                                                                                                    |
| `INDEXER_URL_ZERO_G`   | Yes      | 0G Indexer URL                                                                                                                                                                                                                                        |
| `LLM_API_KEY`          | Yes      | LLM provider key for example oracle handlers and `/validate`                                                                                                                                                                                          |
| `LLM_API_BASE`         | Yes      | OpenAI-compatible API base                                                                                                                                                                                                                            |
| `LLM_VALIDATION_MODEL` | Yes      | Model used by `/validate` scorer                                                                                                                                                                                                                      |
| `PORT`                 | Yes      | HTTP port                                                                                                                                                                                                                                             |
| `APP_NAME`             | No       | Root `.env` dstack key path used by Phala deploy to derive the oracle TEE signing key; defaults to `TEE-ORACLE`. Changing it rotates the TEE address and old encrypted blobs will not decrypt with the new key                                        |
| `PRIVATE_KEY`          | Yes      | Oracle transaction signer for `initValidator`, `/validate` authorization, validation responses, and 0G fees. For dashboard automatic validation, this must match dashboard `PRIVATE_KEY`. Reencrypt owner auth is a request signature, not an env key |
| `DSTACK_VERIFIER_URL`  | Yes      | dstack-verifier sidecar URL                                                                                                                                                                                                                           |

`ORACLE_ENTRY` is set by root `scripts/deploy-cvm.mjs` during deploy; do not put it in `.env`.

## Production Instructions

Production docs should prioritize deployability over app architecture. The most
important path is:

1. Deploy contracts on Base, Base Sepolia, or Arbitrum Sepolia. For Base
   Sepolia, choose either `deploy:arbitrumSepolia:remoteOracle` or
   `deploy:arbitrumSepolia:localOracle`. For Arbitrum Sepolia, use
   `deploy:baseSepolia`; it is remote-oracle only.
2. Run `contracts/setup-env` so root `deployments.json` contains
   `agentRegistry`, `teeVerifier`, `validationRegistry`, and scan start blocks.
3. Implement a production oracle entry under `apps/oracle/src` using
   `@tee-agent/server` and `startOracle({ handler, deployments })`.
4. Fill `apps/oracle/.env` explicitly. Do not set
   `DSTACK_SIMULATOR_ENDPOINT` in production.
5. Build and push the oracle Docker image with `npm run oracle:image`.
   This logs into GHCR, builds `apps/oracle/Dockerfile` for `linux/amd64`,
   pushes a fresh git-SHA timestamp tag, and saves the pushed image URL to root
   `.env` as `ORACLE_IMAGE`. The script uses
   `git config --global user.name` by default, prompts for the GHCR token when
   needed, and writes the Phala pull credentials to root `.env` so Phala Cloud
   can pull private GHCR images.
6. Deploy the Phala CVM with
   `npm run oracle:deploy -- src/<path-to-oracle>.ts`. The deploy script reads
   `ORACLE_IMAGE`, writes `apps/oracle/.phala/docker-compose.generated.yml` with
   that concrete image, passes the compiled entry as `ORACLE_ENTRY`, and prints
   the oracle HTTPS URL when the endpoint is available.
7. `deploy-cvm.mjs` auto-runs `phala link` when `apps/oracle/phala.toml` does
   not have a CVM identity (`name` or `app_id`). The first deploy is already
   processing after link; wait for Phala to finish before running deploy again.
   Future deploys update the same CVM. If the linked CVM is stopped, the script
   starts it after Phala accepts the new compose/env deploy.
8. Use the public Phala HTTPS endpoint as the agent `teeOracle` service URL.
9. Confirm `/attestation` is exposed for inspection. The on-chain gate is still
   `TeeVerifier` calling Automata DCAP during `initValidator` and validation
   responses.
10. Mint agents through `@tee-agent/agent/ops/mint`; do not hand-edit `teeOracle`
    for existing agents without an oracle key rotation flow.

Package roles:

- `@tee-agent/server`: production oracle runtime only.
- `@tee-agent/agent`: SDK for app/backend usage — network metadata, ABIs, mint
  prep, transfer prep, registry reads, validation, feedback, service updates,
  encryption, and 0G Storage.

### Contracts

| Variable                   | Required | Description                              |
| -------------------------- | -------- | ---------------------------------------- |
| `RPC_URL_BASE_SEPOLIA`     | Network  | RPC for Base Sepolia deployments         |
| `RPC_URL_ARBITRUM_SEPOLIA` | Network  | RPC for Arbitrum Sepolia deployments     |
| `RPC_URL_BASE`             | Network  | RPC for Base mainnet deployments         |
| `EXPLORER_API_KEY`         | No       | Basescan API key for source verification |

### Root E2E

Root E2E tests live in `__tests__/` and load `__tests__/.env`.
`npm run e2e:local` expects a running Hardhat node and an existing local
Ignition deployment under `contracts/ignition/deployments/chain-31337`.

| Variable                   | Required | Description                                                    |
| -------------------------- | -------- | -------------------------------------------------------------- |
| `PRIVATE_KEY`              | Yes      | E2E signer for minting, transfer, validation, feedback, and 0G |
| `LOCAL_RPC_URL`            | Local    | RPC for `npm run e2e:local`                                    |
| `RPC_URL_ARBITRUM_SEPOLIA` | Network  | RPC for `npm run e2e:arbitrumSepolia`                          |
| `ORACLE_URL`               | Yes      | Running oracle URL used by E2E tests                           |
| `PINATA_JWT`               | Yes      | Pinata JWT used by SDK minting for IPFS metadata               |
| `RPC_URL_ZERO_G`           | Yes      | 0G Storage EVM RPC used by encrypted blob uploads              |
| `INDEXER_URL_ZERO_G`       | Yes      | 0G Storage indexer used by encrypted blob storage              |

## Requirements

### Implemented

- [x] ERC-721 agent NFT mint on configured EVM networks
- [x] ERC-8004 on-chain registry, reputation, and validation
- [x] ERC-7857 encrypted intelligent data (AES-256-GCM + ECIES key wrapping)
- [x] Inline data URI blobs for public metadata (on-chain)
- [x] 0G Storage upload for private encrypted blobs
- [x] IPFS (Pinata) upload for agent metadata JSON (`agentMetadataUri`)
- [x] Phala Cloud TDX oracle for secure NFT transfers (key re-wrapping inside TEE)
- [x] Dashboard: create, list, view, update agents
- [x] Dashboard: decrypt intelligent data (owner-only, signature-gated)
- [x] SDK two-party transfer helpers (`createTransferOffer`, `getTransferAccessPayloadsToSign`, `buildTransferAcceptance`, `buildTransferTxArgs`)
- [x] Post-transfer private-data re-encryption flow for the new owner
- [x] E2E coverage for mint, ERC-7857 transfer, ERC-8004 identity transfer, reputation, validation, and `teeOracle` service metadata
- [x] Generic Phala CVM deploy script for any oracle entry under `apps/oracle/src`

### Pending / In Progress

- [ ] Deploy production oracle CVMs and point agent `teeOracle` services at them
- [ ] Deploy Arbitrum Sepolia contract set and publish addresses in root `deployments.json`
- [ ] Dedicated oracle key rotation flow for changing an agent's `teeOracle`
- [ ] Add `forge test` step to CI — `contracts` already has `npm run test:foundry`, but `.github/workflows/pr-checks.yml` does not run it yet
- [ ] Validate explorer source verification for deployed Base Sepolia/Base/Arbitrum Sepolia addresses — deploy scripts pass `--verify`, but deployed-address verification still needs confirmation
- [ ] Support [`zaryab2000/create-8004-TAP-agent`](https://github.com/zaryab2000/create-8004-TAP-agent)
- [ ] Support additional networks beyond Base and Arbitrum
- [ ] Add standalone approval flow — transfer/e2e covers the ERC-8004 approval needed for combined transfer, but dashboard allowance approval/revoke UI is still placeholder-only

## Known Issues & Follow-ups

- [ ] `axios` (transitive via `open-jsonrpc-provider`) has high-severity CVEs — no fix available upstream
- [ ] `elliptic` (transitive via `@ethersproject/signing-key`) has a CVE — no fix available upstream
- [ ] `@phala/dstack-sdk` is in the 0.1.x line; newer 0.x releases need manual review before upgrading
- [ ] Direct workspace dependencies use `eciesjs` 0.5.x; keep an eye on transitive older copies during dependency audits
- [ ] `express` 4.x is pinned; 5.2.1 (major) available — needs approval before upgrade

## Conventions

- TypeScript uses `strict: true`; keep `strictNullChecks` enabled.
- Keep `noImplicitAny: false` so implicit any is allowed when inference cannot
  resolve a type.
- Do not use `unknown`. Prefer concrete domain types, schema-validated types,
  generics with constraints, or small local object types.
- Avoid `any` as much as possible. If a third-party boundary forces it, isolate
  it at the boundary and immediately cast or validate into a concrete type.
- In React components, prefer `useMemo` for derived values with branching,
  parsing, filtering, or formatting. Do not use inline IIFE constants like
  `const value = (() => { ... })()` for render-time derivations.
- All mutations and client-triggered data fetches use **Server Actions** in `apps/dashboard/src/lib/actions/` — no API routes for internal use
- Keep exactly one project README: root `README.md`. Do not add package READMEs
  or duplicate deploy/setup instructions elsewhere.
- Client wallet flows must use `useWallet().getViemClients()`. That helper
  builds a viem public client from `walletClient.transport.request`, so browser
  estimates/receipt polling use MetaMask/the connected wallet RPC.
- Dashboard chain/config state lives in `apps/dashboard/src/lib/config.ts`.
  Do not recreate `client-config.ts`, `active-chain.ts`, or local dashboard
  chain files. Chain metadata comes from `@tee-agent/agent/network`
  `NETWORK_CONFIG`; deployment addresses come from root `deployments.json`.
- Internal imports use `.js` extensions (NodeNext resolution)
- Sub-path exports only: `@tee-agent/agent/types`, `@tee-agent/agent/network`, `@tee-agent/agent/crypto`, `@tee-agent/agent/abis`, `@tee-agent/agent/registry`, `@tee-agent/agent/storage/zero-g`, `@tee-agent/agent/ops/metadata`, `@tee-agent/agent/ops/mint`, `@tee-agent/agent/ops/transfer`, `@tee-agent/agent/ops/transfer-acceptance`, `@tee-agent/agent/ops/services`, `@tee-agent/agent/ops/feedback`, `@tee-agent/agent/ops/validate`, `@tee-agent/agent/typed-data`
- `zerog://` is the canonical URI scheme for private encrypted blobs; `data:application/json;base64,…` is used for public on-chain metadata
- Transfer offer creation belongs in `@tee-agent/agent/ops/transfer`; browser-safe acceptance/tx helpers belong in `@tee-agent/agent/ops/transfer-acceptance`. Dashboard storage is an implementation detail, not an SDK requirement.
- Oracle image command: `npm run oracle:image` from repo root. It saves the pushed URL to root `.env` as `ORACLE_IMAGE`.
- Oracle deployment command: `npm run oracle:deploy -- src/examples/<entry>.ts` from repo root. The script prints the oracle URL when Phala exposes it. The `apps/oracle` workspace `deploy` script is only a thin alias.
- User-facing docs and UI must show repo scripts as the deploy interface. Do
  not document raw `phala` CLI commands or invent new flags/env vars when the
  existing scripts should own the workflow.
- Validation automation watches `ValidationRegistry.ValidationRequest`, filters
  for the active `teeVerifier`, skips requests with matching
  `ValidationResponse`, and calls the agent `teeOracle` `/validate` endpoint.
- For dashboard UI, keep operational surfaces dense and app-like. Use the
  homepage process diagram as the mental model: WebApp/User, Phala/Oracle, and
  Blockchain are distinct responsibilities. The diagram must explicitly show
  that remote TEE trust is Automata DCAP verification of Intel TDX hardware
  quotes on-chain.
