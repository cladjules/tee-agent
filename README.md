# Tee Agent

Create, own, and manage AI agents on-chain with verifiable identity, private encrypted data, and transparent reputation.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.35-blue)](https://soliditylang.org)

---

## What is it?

Tee Agent is a full-stack framework for deploying AI agents as sovereign on-chain entities. Each agent is an ERC-721 NFT on **Base** or **Base Sepolia** with private encrypted data managed through a Phala Cloud Intel TDX TEE oracle.

The production shape is simple: deploy the contracts, deploy at least one Phala
CVM oracle, mint agents whose `teeOracle` service points at that CVM, then use
the SDK packages from your own app. Remote oracle trust is enforced on-chain:
`TeeVerifier` calls Automata DCAP to verify Intel TDX hardware quotes before it
accepts oracle registration or validation proofs. Transfer proofs are accepted
only when they are signed by an already registered TDX-attested oracle key. The
dashboard is a reference app, not a required runtime.

> **Dashboard URL: https://teeagent.xyz**
>
> This is the user-facing dashboard. It is **not** the oracle URL. Agent
> `teeOracle` services must point at the Phala CVM HTTPS endpoint copied from
> Phala Cloud.

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

`setup-env` scans every Ignition deployment directory and writes public contract
addresses to root `deployments.json`. Keep that file with your app and oracle
deployment; it is the source of truth for `agentRegistry`, `teeVerifier`,
`validationRegistry`, and scan start blocks.

Base Sepolia supports two separate contract deployments:

- `remoteOracle` uses real Automata/DCAP attestation for Phala CVMs.
- `localOracle` deploys a separate `MockDcapAttestation` contract for tappd
  simulator development.

There are no runtime deployment profiles. Root `deployments.json` has one
contract set per chain. Base Sepolia is the only selectable case: run
`setup-env` with the mode you want before starting the dashboard or oracle:

```bash
BASE_SEPOLIA_ORACLE=remote npm run setup-env --workspace=contracts
BASE_SEPOLIA_ORACLE=local npm run setup-env --workspace=contracts
```

### 2. Implement an oracle entry

An oracle is just an `@tee-agent/server` handler. Put production entries under
`apps/oracle/src`, for example `apps/oracle/src/prod/my-oracle.ts`:

```typescript
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
    const config = ctx.blobs[1] as { model: string };

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
- self-registers that TEE-derived oracle address in `TeeVerifier` with an
  Automata DCAP-verified Intel TDX quote
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
APP_NAME=TEE-ORACLE
# Oracle transaction signer, not the agent owner/creator key.
PRIVATE_KEY=
RPC_URL_ZERO_G=
INDEXER_URL_ZERO_G=
LLM_API_KEY=
LLM_API_BASE=
LLM_VALIDATION_MODEL=
PORT=3001
DSTACK_VERIFIER_URL=
```

`PRIVATE_KEY` is the oracle transaction signer, not the agent owner/creator key.
It pays gas for oracle-owned infrastructure transactions: `initValidator`,
validation responses, and 0G storage operations. Agent owners still sign
mint/run/transfer and `ReencryptRequest` messages with their own wallet; those
signatures are sent in request bodies and are not stored in oracle env. The
oracle identity itself is the TEE-derived wallet returned by `GET /address`.

### 4. Deploy the Phala CVM

Use the repo scripts from the repository root. They build the image, generate
the Phala compose file, deploy or update the linked CVM, and print the oracle
URL when Phala exposes the endpoint.

Deploy any oracle source file under `apps/oracle/src`:

```bash
npm run oracle:image
npm run oracle:deploy -- src/prod/my-oracle.ts
```

The deploy script validates the source path, maps it to the compiled
`dist/...js` entry, reads `ORACLE_IMAGE` from root `.env`, writes
`apps/oracle/.phala/docker-compose.generated.yml` with that concrete image,
passes the compiled entry as `ORACLE_ENTRY`, and prints the CVM HTTPS oracle URL
at the end of a successful deploy.

The image must be pullable by the remote CVM. Use a public registry image or a
registry Phala can authenticate to.

To build and push the oracle image:

```bash
npm run oracle:image
```

`oracle:image` uses `git config --global user.name` as the Docker login
username and default GHCR owner. If the GHCR token is missing, the script prints
the GitHub token link, asks you to paste it, saves it, logs into GHCR, builds
the image for `linux/amd64`, pushes it under a fresh git-SHA timestamp tag, then
saves `ORACLE_IMAGE`, `ORACLE_DEPLOYMENTS_SHA`, `ORACLE_IMAGE_SOURCE_SHA`, and
the Phala pull credentials to root `.env` so Phala Cloud can pull private GHCR
images and the deploy script can verify the image matches the current
`deployments.json` and oracle source.

After a successful first deploy, the deploy script runs `phala link` when
`apps/oracle/phala.toml` does not have a CVM identity (`name` or `app_id`), so
future deploys update the same instance. The first deploy is already processing
at that point; wait for Phala to finish before running deploy again. If the
linked CVM is stopped on a later deploy, the script starts it after Phala accepts
the new compose/env deploy.
If a later deploy reports that the requested CVM was not found, the script
treats the stored CVM identity as stale, removes it from `phala.toml`, creates a
new CVM, and links the new deployment.

`npm run oracle:deploy` prints the public Phala HTTPS endpoint when it is
available. Production agents should use that URL as their `teeOracle` service
endpoint.

`/address` returns the TEE-derived signer address and public key. On startup the
oracle calls `initValidator`; if that transaction fails, transfer, validation,
and decryption checks that depend on registered TEE oracle signatures will fail
on-chain.

### 5. TEE hardware verification

Remote oracle deployments use the real Automata DCAP verifier contract. The
oracle asks Phala dstack for an Intel TDX quote, then `TeeVerifier` submits that
quote to Automata on-chain.

There are two quote paths:

- `initValidator` registers the oracle key. The quote's `reportData` must bind
  the TEE-derived oracle address to the running CVM. Any wallet can pay gas for
  this transaction, but the registered oracle address must come from the TEE
  quote, not from `PRIVATE_KEY`.
- `validationResponse` verifies a specific result. The quote commits to the
  agent id, request hash, and score before the score is accepted on-chain.

This is why `remoteOracle` contract deployments must be used for real Phala CVMs
and why `localOracle` is only for tappd simulator development. In local mode,
`TeeVerifier` is wired to `MockDcapAttestation`; in remote mode it is wired to
Automata DCAP. Remote deployment parameters use Automata's current
`standard()` collateral with `dcapTcbEvaluationDataNumber = 0`, so the verifier
is not pinned to stale TD_QE identity collateral.

### 6. Mint agents

When minting, include a `teeOracle` service that points at the deployed Phala
CVM oracle endpoint printed by `npm run oracle:deploy`.

`prepareMint` calls `GET /address`, verifies the oracle, encrypts private data
for its public key, uploads encrypted blobs to 0G Storage, uploads metadata to
IPFS, and returns calldata-ready mint data.

#### 6a. Use the dashboard

Use the dashboard at:

```text
https://teeagent.xyz
```

That dashboard URL is for humans and wallets. It is not the `teeOracle`
endpoint written into ERC-8004 agent metadata.

The dashboard handles metadata, encryption, 0G uploads, Pinata IPFS uploads,
wallet minting, agent listing, owner-only decrypt, updates, validation, and
transfer flows.

#### 6b. Deploy / mint yourself using SDK

Use `@tee-agent/server` only for oracle services. Use `@tee-agent/agent` for
everything a client or backend app needs: config, ABIs, mint prep, transfer
prep, registry reads, validation, feedback, service updates, encryption, and 0G
storage.

```typescript
import { getNetworkConfig } from "@tee-agent/agent/network";
import { getNetworkDeploymentByChainId } from "@tee-agent/agent/config";
import { prepareMint } from "@tee-agent/agent/mint";
import { AGENT_REGISTRY_ABI } from "@tee-agent/agent/abis";
import type { AgentConfig } from "@tee-agent/agent/types";
import deployments from "./deployments.json" with { type: "json" };

const network = getNetworkConfig("base");
const deployment = getNetworkDeploymentByChainId(network.chainId, deployments);
const config = {
  chain: network.chain,
  registryAddress: deployment.contracts.agentRegistry,
  teeVerifierAddress: deployment.contracts.teeVerifier,
  validationRegistryAddress: deployment.contracts.validationRegistry,
  identityRegistryAddress: network.identityRegistryAddress,
  reputationRegistryAddress: network.reputationRegistryAddress,
  rpcUrl: process.env.RPC_URL_BASE!,
  pinataJwt: process.env.PINATA_JWT!,
  privateKey: process.env.PRIVATE_KEY!,
  zeroGRpcUrl: process.env.RPC_URL_ZERO_G!,
  zeroGIndexerUrl: process.env.INDEXER_URL_ZERO_G!,
} satisfies AgentConfig;

const prepared = await prepareMint(config, {
  name: "Production Agent",
  description: "Runs inside my Phala CVM oracle.",
  ownerAddress,
  services: [
    {
      name: "teeOracle",
      endpoint: oracleUrl,
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

- Data is encrypted with **AES-256-GCM**, with content keys wrapped by a **TEE Oracle** (Intel TDX via Phala Cloud)
- Only the current owner (or explicitly approved wallets) can decrypt and use the agent's private data
- **Transfer** the NFT — the sender oracle re-wraps encrypted content keys for the recipient oracle public key, the recipient signs acceptance proofs, and `TeeVerifier` verifies the transfer on-chain against the registered TDX-attested oracle key. No plaintext ever leaves the secure enclave.

### 3. On-Chain Reputation & Validation — ERC-8004

Agents earn a verifiable, tamper-proof reputation through [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004).

- **Validation requests** can be submitted on-chain, naming a validator contract (e.g. `TEEVerifier`) or EOA to respond
- **Validation responses** carry a score (0–100) and optional evidence URI; the `TEEVerifier` path requires an Automata DCAP-verified TDX quote for the exact response
- **Reputation scores** are fixed-point values (int128 × 10^decimals) stored on-chain
- Reputation and service definitions travel with the agent NFT — new owners inherit the agent's full history

---

## Full Lifecycle

1. **Register** — Mint an ERC-721 NFT on Base. Sign an EIP-712 proof to link the agent wallet on-chain.
2. **Encrypt & Store** — Private data is AES-256-GCM encrypted and uploaded to **0G Storage**. The `zerog://` URI and content hash are anchored on-chain.
3. **Define Services** — Publish MCP, A2A, web, and other endpoints on-chain so other agents and clients can discover and connect.
4. **Transfer** — The sender creates a JSON-safe transfer offer, the recipient signs an acceptance, and the sender submits `iTransferFromWithIdentity`. Apps can store pending offers and acceptances in any storage layer.
5. **Validate** — Request on-chain validation by submitting a `validationRequest` naming `TEEVerifier`. The oracle scores the result inside the TEE and submits a `validationResponse` with an Intel TDX quote that Automata DCAP verifies on-chain.
6. **Earn Reputation** — Validation scores accumulate on-chain and persist across ownership changes.

---

## Validation Flow

Validation is driven by `ValidationRegistry` events. A client first submits a
request:

```typescript
await walletClient.writeContract({
  address: config.validationRegistryAddress,
  abi: VALIDATION_REGISTRY_ABI,
  functionName: "validationRequest",
  args: [
    config.teeVerifierAddress,
    BigInt(erc8004AgentId),
    requestURI,
    requestHash,
  ],
});
```

Watch this event:

```solidity
event ValidationRequest(
    address indexed validatorAddress,
    uint256 indexed agentId,
    string requestURI,
    bytes32 indexed requestHash
);
```

For TEE validation, `validatorAddress` must be the deployed `TeeVerifier`
address from `deployments.json`. `agentId` is the ERC-8004 Identity Registry
agent id, not the ERC-721 token id. `requestHash` is
`keccak256(bytes(requestURI))`.

The dashboard worker scans `ValidationRequest` events from
`ValidationRegistry`, ignores requests that already have a matching
`ValidationResponse(agentId, requestHash)`, then calls the agent's `teeOracle`
`POST /validate`.

The worker only responds when all of these are true:

- `validatorAddress` is the configured `teeVerifier` contract.
- The dashboard `PRIVATE_KEY` address owns the ERC-8004 `agentId`.
- The agent metadata has a `teeOracle` service URL listed in
  `VALIDATION_ORACLE_URLS`.
- `requestURI` is a `data:application/json;base64,...` JSON payload the oracle
  can score.

Key usage:

- Dashboard `PRIVATE_KEY`: server-side validation signer. For automatic
  validation, this address must own the ERC-8004 agent id and must match the
  oracle validation signer expected by `/validate`.
- Oracle `PRIVATE_KEY`: oracle transaction signer. The bundled oracle requires
  `/validate` EIP-712 requests to be signed by this same address, then uses it
  to submit `ValidationRegistry.validationResponse(...)` and pay gas.
- Browser wallet: submits the initial `validationRequest` when a user requests
  validation manually. It is not used by the dashboard worker to submit the
  response.

When `/validate` succeeds, the oracle submits:

```solidity
validationResponse(
    requestHash,
    score,
    responseURI,
    responseHash,
    tag,
    tdxQuote
);
```

For `TeeVerifier`, the TDX quote commits to `agentId`, `requestHash`, and
`score`; Automata DCAP verifies that quote on-chain before the response is
accepted.

---

## Dashboard Model

The dashboard homepage is an explorer-first view:

1. Hero and contract addresses show the active Base/Base Sepolia deployment.
2. Three feature boxes explain the standards stack: ERC-8004 discovery,
   ValidationRegistry feedback, and ERC-7857 private skills.
3. Registered agents appear immediately after those boxes. Cards are intentionally
   compact: image, name, and `AgentRegistry #<tokenId>` only. Do not show IPFS,
   metadata URI, owner address, or ERC-8004 ids on the homepage card.
4. The process diagram below the list explains the three-party flow:
   WebApp/User -> Phala/Oracle -> Blockchain, plus transfer/oracle rotation.
5. The diagram must highlight that remote TEE trust is enforced by
   `TeeVerifier` calling Automata DCAP on-chain with Intel TDX quotes, not by
   dashboard-side checks.
6. Developer quickstart comes after the explorer content.

Browser-side wallet flows use the connected wallet provider for reads,
estimation, receipt polling, and writes. Do not add `NEXT_PUBLIC_RPC_URL_*` or
route client wallet operations through an app RPC. Server Actions, indexing, and
cron workers use server-side `RPC_URL_BASE` / `RPC_URL_BASE_SEPOLIA` because
there is no wallet provider on the server. Use an RPC provider that supports
dashboard `eth_getLogs` indexing ranges; public Base RPC endpoints are usually
better than narrow log-range provider plans for this path.

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

Set `NETWORK=base` or `NETWORK=baseSepolia` in `apps/oracle/.env`. The
dashboard can read both public networks from `deployments.json`, while
client-side wallet operations follow the connected wallet's current chain and
RPC provider. Server-side RPC URLs must be configured explicitly; missing
required config fails fast.

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

For remote oracle deployments, the DCAP verifier is Automata's on-chain Intel
TDX attestation verifier. `TeeVerifier` never trusts a URL, dashboard setting,
or server claim by itself. It accepts an oracle key only after Automata verifies
the hardware quote and the quote's `reportData` binds that key to the running
CVM. Validation responses also carry TDX quotes, so the on-chain score is tied
to the agent id, request hash, and score.

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

Types, ABIs, encryption/decryption utilities, registry clients, 0G Storage, deployment helpers, and network config.

Sub-path exports: `./types`, `./network`, `./config`, `./encryption`, `./abis`, `./registry`, `./zero-g`, `./metadata`, `./mint`, `./transfer`, `./services`, `./feedback`, `./validate`, `./typed-data`

```typescript
import { AgentRegistry } from "@tee-agent/agent/registry";
import { getNetworkConfig } from "@tee-agent/agent/network";
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
   verifies the sender signature from the request body, then re-wraps each
   encrypted content key for the recipient oracle public key. The sender/owner
   private key is never configured in oracle `.env`.
3. The recipient signs one access proof per encrypted data entry with their
   wallet.
4. The sender submits `buildTransferTxArgs(...)`, which calls
   `AgentRegistry.iTransferFromWithIdentity(from, to, tokenId, proofs)`.

`iTransferFromWithIdentity` moves both the ERC-7857 NFT and the linked ERC-8004
Identity Registry token in one transaction. After transfer, the new owner must
complete private-data re-encryption for their selected oracle before the agent
can run again.

Changing an agent's `teeOracle` service is a separate oracle-key-rotation flow,
not a regular services edit. The current oracle must re-wrap the existing
content keys for the new oracle public key, the encrypted blob metadata must be
updated, and the registry must anchor the new data hashes/URIs before the
ERC-8004 service endpoint changes. The dashboard shows this as a dedicated
rotation action instead of allowing silent `teeOracle` edits.

`NETWORK_CONFIG` and `getNetworkConfig*` are the single source of truth for supported chains, chain IDs, viem chain objects, ERC-8004 singleton addresses, explorer URLs, and OpenSea links:

```typescript
import { getNetworkConfigByChainId } from "@tee-agent/agent/network";
const nc = getNetworkConfigByChainId(84532);
// nc.chain, nc.chainId, nc.isTestnet,
// nc.identityRegistryAddress, nc.reputationRegistryAddress,
// nc.explorerUrl, nc.erc8004ScanUrl, nc.openseaUrl
```

Dashboard config lives in `apps/dashboard/src/lib/config.ts`. Do not recreate
`client-config.ts`, `active-chain.ts`, or local dashboard chain files; derive
chain data from `@tee-agent/agent/network` and deployment addresses from root
`deployments.json`.

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

The server handles: TEE key derivation via Phala dstack SDK, TDX quote
generation, 0G Storage blob fetch + ECIES-unwrap + AES-256-GCM decrypt, EIP-712
signature verification, and on-chain validation response submission. The actual
hardware attestation decision happens in `TeeVerifier`, which calls Automata
DCAP on-chain for remote oracle deployments.

HTTP endpoints: `GET /health`, `GET /address`, `GET /info`, `GET /attestation`, `POST /verify`, `POST /reencrypt`, `POST /run`, `POST /validate`

---

## Apps

### `apps/dashboard`

Next.js 16 App Router UI. Connects to Base or Base Sepolia.

- All wallet writes execute in the browser via viem — no backend proxy
- Client-side reads/estimates/receipt polling use the connected wallet provider
  RPC, not Alchemy or `NEXT_PUBLIC_RPC_URL_*`
- Server Actions (`src/lib/actions/`) handle encryption and oracle calls
- No API routes for internal mutations; the only API route is the cron sync endpoint
- The homepage agent card stays compact: image, name, and AgentRegistry token id
  only

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
npm run oracle:image
npm run oracle:deploy -- src/examples/prediction-market.ts
npm run oracle:deploy -- src/examples/web-data-oracle.ts
```

Root `scripts/deploy-cvm.mjs` validates that the entry lives under
`apps/oracle/src`, maps it to the compiled `dist/...js` path, reads
`ORACLE_IMAGE` from root `.env`, writes a generated Phala compose file
with that image, deploys or updates the linked CVM, and prints the oracle URL
when the endpoint is available.
`ORACLE_ENTRY` is set by the deploy script and should not live in `.env`. After
a successful first deploy, the script auto-runs `phala link` when
`apps/oracle/phala.toml` does not have a CVM identity (`name` or `app_id`), so
future deploys update the same CVM. The first deploy is already processing after
linking; wait for Phala to finish before running deploy again. If the linked CVM
is stopped, the script starts it after Phala accepts the new compose/env deploy.
If that linked CVM was deleted manually and Phala returns a "requested CVM was
not found" error, the script removes the stale identity, deploys a new CVM, and
links it.

On startup, the oracle reads root `deployments.json`, derives its TEE keypair,
and submits `initValidator` to `TeeVerifier`. `initValidator` is permissionless:
any account can pay gas to register an oracle address, but remote deployments
only succeed when Automata DCAP verifies the Intel TDX quote and the quote's
`reportData` starts with that oracle address. The signer in oracle `PRIVATE_KEY`
is a gas wallet for the oracle process, not the agent owner/creator. It must
have enough gas on the selected Base network for startup registration,
validation responses, and any 0G upload fees.

---

## Development Rules

- Use `gemini-3-flash-preview` for Gemini API calls in repository scripts.
- TypeScript uses `strict: true` with `strictNullChecks: false`; keep
  `strictNullChecks` disabled unless the architecture decision changes.
- Keep `noImplicitAny: false` so implicit any is allowed when inference cannot
  resolve a type.
- Do not use `unknown`. Prefer concrete domain types, schema-validated types,
  generics with constraints, or small local object types.
- Avoid `any` as much as possible. If a third-party boundary forces it, isolate
  it at the boundary and immediately cast or validate into a concrete type.
- Keep Base and Base Sepolia as the only supported chains unless the architecture
  decision changes.
- Do not add deployment profiles. Base Sepolia local-vs-remote oracle mode is
  selected by which contract set `setup-env` writes into `deployments.json`.
- User-facing deploy docs should use repo scripts only. Do not document raw
  `phala` CLI commands or invent new flags/env vars when the existing scripts
  own the workflow.
- Keep dashboard mutations and client-triggered fetches in Server Actions; do
  not add API routes for internal app flows.
- Use `useWallet().getViemClients()` for browser wallet flows so reads,
  estimates, receipt polling, and writes use the connected wallet provider RPC.
- Keep SDK transfer logic in `@tee-agent/agent/transfer` storage-agnostic.
- Do not edit an existing agent's `teeOracle` like a normal service field;
  expose/use an oracle key-rotation flow.

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

Private blob uploads require 0G testnet tokens. Fund the backend/oracle wallet
used by `PRIVATE_KEY`; this does not have to be the agent owner wallet:

- Faucet: https://faucet.0g.ai
- RPC: `https://evmrpc-testnet.0g.ai`

### 3. Deploy contracts to Base Sepolia

```bash
cd contracts
npm test                          # run contract tests first
npm run deploy:baseSepolia        # remoteOracle: real Automata DCAP
```

DCAP mode is selected by which Base Sepolia deployment you copy into
`deployments.json`:

- `remoteOracle` deploys Base Sepolia contracts wired to the real Automata DCAP
  attestation contract. Base Sepolia uses Automata DCAP v1.0
  (`0x95175096a9B74165BE0ac84260cc14Fc1c0EF5FF`) because a real Phala Cloud TDX
  quote that fails with `TCBR` on v1.1 succeeds on v1.0. This is the default
  `deploy:baseSepolia` path.
- `localOracle` deploys a separate Base Sepolia contract set wired to
  `MockDcapAttestation`, for a local oracle using the tappd simulator.
- Base always uses real DCAP.

```bash
# Deploy and write deployments.json in one step
npm run deploy:baseSepolia:remoteOracle
npm run deploy:baseSepolia:localOracle

# Or switch deployments.json manually after both are deployed
BASE_SEPOLIA_ORACLE=remote npm run setup-env
BASE_SEPOLIA_ORACLE=local npm run setup-env
```

`setup-env` scans every Ignition deployment directory and writes each discovered
chain to root `deployments.json`. Base Sepolia is the only special case: when
you want the named local or remote oracle deployment, run `setup-env` with
`BASE_SEPOLIA_ORACLE=local` before using the tappd simulator oracle, or
`BASE_SEPOLIA_ORACLE=remote` before using real Phala/Automata DCAP.

If an existing Base Sepolia remote deployment fails oracle startup with
`DcapVerificationFailed("TCBR")`, redeploy the remote contract set so
`TeeVerifier` uses the Automata v1.0 Base Sepolia verifier:

```bash
npm run deploy:baseSepolia:remoteOracle --workspace=contracts
```

Because the oracle image bakes `deployments.json`, run `npm run oracle:image`
and redeploy the CVM after this contract redeploy.

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

| Variable                               | Required | Description                                                                                                                                                               |
| -------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RPC_URL_BASE`                         | Network  | EVM RPC for Base mainnet (server-side only); must support dashboard `eth_getLogs` indexing ranges                                                                         |
| `RPC_URL_BASE_SEPOLIA`                 | Network  | EVM RPC for Base Sepolia (server-side only); must support dashboard `eth_getLogs` indexing ranges                                                                         |
| `deployments.json`                     | Yes      | Public deployed contract addresses, including `agentRegistry`, `teeVerifier`, `validationRegistry`, and scan start blocks                                                 |
| `PORT`                                 | Yes      | Dashboard HTTP port                                                                                                                                                       |
| `PRIVATE_KEY`                          | Yes      | Dashboard server-side signer for uploads and validation automation. For automatic validation it must own the ERC-8004 agent id and match the oracle `PRIVATE_KEY` address |
| `VALIDATION_ORACLE_URLS`               | Yes      | Comma-separated `teeOracle` URLs this dashboard worker owns; only these URLs are auto-validated from `ValidationRequest` events                                           |
| `RPC_URL_ZERO_G`                       | Yes      | 0G Storage EVM RPC                                                                                                                                                        |
| `INDEXER_URL_ZERO_G`                   | Yes      | 0G Indexer URL                                                                                                                                                            |
| `PINATA_JWT`                           | Yes      | Pinata V3 Bearer JWT for IPFS metadata uploads (`org:files:write` scope)                                                                                                  |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | Yes      | WalletConnect project ID (create at https://cloud.walletconnect.com)                                                                                                      |
| `UPSTASH_REDIS_REST_URL`               | No       | Upstash Redis REST URL — caches indexed agents + last-seen block                                                                                                          |
| `UPSTASH_REDIS_REST_TOKEN`             | No       | Upstash Redis REST token                                                                                                                                                  |
| `CRON_SECRET`                          | No       | Bearer token Vercel injects into cron job requests (set in Vercel project settings)                                                                                       |

### `apps/oracle`

| Variable                    | Required   | Description                                                                                                                                                                                                    |
| --------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NETWORK`                   | Yes        | `base` or `baseSepolia`                                                                                                                                                                                        |
| `RPC_URL_BASE`              | Network    | EVM RPC for Base mainnet                                                                                                                                                                                       |
| `RPC_URL_BASE_SEPOLIA`      | Network    | EVM RPC for Base Sepolia                                                                                                                                                                                       |
| `deployments.json`          | Yes        | Public deployed contract addresses, including `agentRegistry`, `teeVerifier`, `validationRegistry`, and scan start blocks                                                                                      |
| `APP_NAME`                  | No         | Root `.env` dstack key path used by Phala deploy to derive the oracle TEE signing key; defaults to `TEE-ORACLE`. Changing it rotates the TEE address and old encrypted blobs will not decrypt with the new key |
| `PRIVATE_KEY`               | Yes        | Oracle transaction signer for `initValidator`, `/validate` authorization, validation responses, and 0G fees. For dashboard automatic validation this must match dashboard `PRIVATE_KEY`                        |
| `RPC_URL_ZERO_G`            | Yes        | 0G Storage EVM RPC                                                                                                                                                                                             |
| `INDEXER_URL_ZERO_G`        | Yes        | 0G Indexer URL                                                                                                                                                                                                 |
| `LLM_API_KEY`               | Yes        | API key for LLM scoring (Red Pill for TEE-attested models: https://red-pill.ai)                                                                                                                                |
| `LLM_API_BASE`              | Yes        | OpenAI-compatible API base                                                                                                                                                                                     |
| `LLM_VALIDATION_MODEL`      | Yes        | Model used by `/validate` scorer                                                                                                                                                                               |
| `PORT`                      | Yes        | HTTP port                                                                                                                                                                                                      |
| `DSTACK_VERIFIER_URL`       | Yes        | dstack-verifier sidecar URL                                                                                                                                                                                    |
| `DSTACK_SIMULATOR_ENDPOINT` | Local only | tappd simulator endpoint for local dev with fake DCAP; omit in real Phala CVMs                                                                                                                                 |

### `contracts`

| Variable               | Required | Description                                                         |
| ---------------------- | -------- | ------------------------------------------------------------------- |
| `PRIVATE_KEY`          | Yes      | Deployer key                                                        |
| `RPC_URL_BASE_SEPOLIA` | Network  | RPC for Base Sepolia deployments                                    |
| `RPC_URL_BASE`         | Network  | RPC for Base mainnet deployments                                    |
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
| `RPC_URL_BASE_SEPOLIA` | Network  | RPC for `npm run e2e:baseSepolia`                              |
| `ORACLE_URL`           | Yes      | Running oracle URL used by E2E tests                           |
| `PINATA_JWT`           | Yes      | Pinata JWT used by SDK minting for IPFS metadata               |
| `RPC_URL_ZERO_G`       | Yes      | 0G Storage EVM RPC used by encrypted blob uploads              |
| `INDEXER_URL_ZERO_G`   | Yes      | 0G Storage indexer used by encrypted blob uploads/downloads    |

`Network` means required when using that network. The project does not invent
RPC URLs, contract addresses, private keys, or oracle URLs at runtime.

---

## Open Standards

- **[ERC-8004](https://eips.ethereum.org/EIPS/eip-8004)** — Trustless Agent Registry (identity, reputation, validation)
- **[ERC-7857](https://eips.ethereum.org/EIPS/eip-7857)** — Intelligent Digital Assets (ownable AI agents with encrypted private metadata)
