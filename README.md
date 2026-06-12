# Tee Agent

Create AI agents as on-chain entities with:

- ERC-8004 identity and reputation
- ERC-7857 encrypted private skills and model data
- Phala Cloud Intel TDX oracle execution
- Automata DCAP-verified TEE proofs on-chain

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.35-blue)](https://soliditylang.org)

Dashboard: **https://teeagent.xyz**

Use the hosted dashboard unless you specifically want to run the frontend
locally. Your agent `teeOracle` service must point to the Phala CVM HTTPS
endpoint printed by `npm run oracle:deploy`, not to the dashboard URL.

---

## Trust Passport For AI Agents

Tee Agent gives every AI agent a portable on-chain trust passport on Arbitrum:
identity, encrypted private data, verifiable execution, validation results, and
feedback that can be checked by any app or agent.

AI agents are starting to own wallets, call tools, and make decisions for users.
The missing piece is trust. A user or another agent should be able to answer:

- Who owns this agent?
- What services does it expose?
- Was its output produced by the registered TEE oracle?
- Has another validator checked the result?
- Is the feedback genuine or just self-reported noise?

Tee Agent answers those questions with ERC-8004 identity/reputation,
ERC-7857 encrypted agent data, Phala Intel TDX execution, Automata DCAP
verification, and simple dashboard/API/MCP surfaces.

### What Tee Agent Adds To ERC-8004

ERC-8004 gives agents a common identity, validation, and reputation shape, but
three practical gaps remain:

- Validation is not globally deployable yet. There is an official identity and
  reputation registry, but no confirmed global `ValidationRegistry` singleton
  across the networks this project targets.
- Reputation feedback is easy to spam. A feedback provider can submit feedback,
  but raw reputation entries are not Sybil-resistant on their own.
- TEE providers are underused. In a basic ERC-8004 setup, the TEE is mostly a
  validator. The agent's actual private skills, prompts, model config, and files
  still need a secure execution path.

Tee Agent fills those gaps with a deployed validation registry, a feedback loop
that links feedback to validation-backed evidence, and ERC-7857 encrypted agent
data. The Phala TDX oracle is not just a validation provider; it decrypts
private agent data inside the TEE, runs the agent, validates outputs, handles
transfer re-encryption, and produces proofs that can be checked on-chain.

### Demo Flow

1. Create or import an agent with public metadata, `teeOracle` service, and
   encrypted private skills/files.
2. Mint the agent on Arbitrum Sepolia as an ERC-7857 NFT linked to ERC-8004
   identity.
3. Run the agent through its Phala CVM oracle. The owner signs the request; the
   oracle decrypts private data only inside the TEE.
4. Request validation on-chain. The validator checks the run and submits a
   response with a TDX quote bound to the validation data.
5. Give feedback through ERC-8004 reputation using a feedback URI that embeds
   the validation reference.
6. Verify the feedback from the dashboard, `/api/verify`, or MCP. The verifier
   decodes the feedback, reads the on-chain validation response, and confirms it
   came from the configured `TeeVerifier`.

### Why Arbitrum

Arbitrum is the coordination layer for the agent passport. It stores ownership,
identity, validation, reputation, and feedback commitments while heavy execution
and private data stay off-chain in TEE and encrypted storage. This keeps the
agent state public, composable, and cheap to verify while preserving private
skills and model configuration.

### What You Can Try

- Dashboard: create, inspect, run, validate, give feedback, and verify agents.
- MCP: let AI clients discover agents, prepare mint/validation/feedback
  transactions, read reputation, and verify feedback.
- SDK: integrate the same flows into any app without relying on the dashboard.

---

## Deployed Contracts

Use these contracts by default. You should not redeploy contracts unless you are
changing the protocol, testing a local simulator, or intentionally running your
own contract set.

| Network          | Chain ID | AgentRegistry                                | TeeVerifier                                  | ValidationRegistry                           | From block |
| ---------------- | -------: | -------------------------------------------- | -------------------------------------------- | -------------------------------------------- | ---------: |
| Arbitrum Sepolia | `421614` | `0x6F92CAD52c3786FE4ec0b0F4a07DEB65094f00a1` | `0x2f2b0b4cbda3069c1BBf894a0e4b3807a20bB0cf` | `0x2d2c758DA36110AC137c2c8b333db94D4D5ae66E` | `275691630` |

Keep these values in root `deployments.json`; the SDK, oracle image, and hosted
dashboard/indexer read from it.

---

## What Is Stored Where

| Layer                            | Stored data                                                                                                                               |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| On-chain `AgentRegistry`         | ERC-7857 NFT ownership, token URI, encrypted data descriptors, encrypted data hashes, linked ERC-8004 agent id, verifier address          |
| On-chain ERC-8004 Identity       | Agent identity owner and `agentMetadataUri` pointer                                                                                       |
| On-chain Validation / Reputation | Validation requests, validation responses, scores, response hashes, feedback summaries                                                    |
| IPFS via Pinata                  | Public ERC-721 metadata and ERC-8004 registration JSON: name, description, image, services, `teeOracle` endpoint, skills/domains metadata |
| 0G Storage                       | Encrypted private blobs: skills, prompts, model config, private files, knowledge data                                                     |
| Phala CVM only                   | Decrypted private blobs and content keys during `/run`, `/validate`, `/reencrypt`                                                         |

The chain stores pointers and hashes. IPFS stores public metadata. 0G stores the
encrypted private payloads. Only the registered Phala CVM oracle can decrypt
those private payloads.

## Feedback Verification

Use `feedbackURI` as the verifier input. `feedbackHash` is only a checksum; it
cannot be decoded.

```bash
curl -X POST https://teeagent.xyz/api/verify \
  -H 'content-type: application/json' \
  -d '{"feedbackURI":"data:application/json;base64,..."}'
```

The endpoint decodes the feedback payload, recomputes its hash, reads the
configured `ValidationRegistry` for the embedded validation request, and checks
that the response came from the configured `TeeVerifier`.

---

## Production Path

### 1. Install And Build

```bash
npm install
npm run build
```

### 2. Create Your Oracle Handler

Copy an example and replace the handler with your app logic:

```bash
mkdir -p apps/oracle/src/prod
cp apps/oracle/src/examples/prediction-market.ts apps/oracle/src/prod/my-oracle.ts
```

Minimal handler shape, imports omitted:

```typescript
const handler = {
  async run(payload, ctx) {
    const skill = ctx.blobs[0];
    const modelConfig = ctx.blobs[1];

    return runModel({
      skill,
      modelConfig,
      input: payload,
    });
  },
};

await startOracle({ handler, deployments });
```

The oracle server handles TDX keys, ownership checks, encrypted blob decrypt,
quote generation, transfer key re-encryption, and validation responses. Your
handler only needs to implement what the agent does.

### 3. Configure Environment

```bash
cp apps/oracle/.env.example apps/oracle/.env
```

Fill the required oracle values:

| Scope  | Required                                                                                                                                                                                                                                                                               |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Oracle | `NETWORK`, `PRIVATE_KEY`, matching network RPC (`RPC_URL_BASE_SEPOLIA`, `RPC_URL_ARBITRUM_SEPOLIA`, or `RPC_URL_BASE`), `RPC_URL_ZERO_G`, `INDEXER_URL_ZERO_G`, `LLM_API_KEY`, `LLM_API_BASE`, `LLM_VALIDATION_MODEL`, `DSTACK_VERIFIER_URL`; `TAVILY_API_KEY` when using web research |

`PRIVATE_KEY` on the oracle is the gas / validation signer for the oracle
process. It is not the wallet that owns every agent. Agent owners still sign
mint, `/run`, transfer, and re-encryption requests with their own wallet.

### 4. Build And Deploy The Phala CVM

```bash
npm run oracle:image
npm run oracle:deploy -- src/prod/my-oracle.ts
```

`oracle:deploy` prints the public Phala HTTPS endpoint. Use that URL as the
agent's ERC-8004 `teeOracle` service.

---

## Oracle Calls

| Endpoint           | Use                                                     |
| ------------------ | ------------------------------------------------------- |
| `GET /health`      | Liveness check                                          |
| `GET /address`     | TEE-derived oracle address and public key               |
| `GET /attestation` | Current CVM proof bundle for inspection                 |
| `POST /run`        | Run the agent handler inside the Phala CVM              |
| `POST /verify`     | Verify a returned TDX proof bundle off-chain            |
| `POST /validate`   | Score a run and submit the on-chain validation response |
| `POST /reencrypt`  | Re-wrap ERC-7857 keys during transfer / oracle rotation |

### 5a. Use The Dashboard

Run, verify, validate, and transfer at https://teeagent.xyz.

### 5b. Use the SDK

**Mint**

Mint from your app with `@tee-agent/agent`.

```typescript
const network = getNetworkConfig("arbitrumSepolia");
const contracts = deployments[String(network.chainId)].contracts;

const config = {
  chain: network.chain,
  registryAddress: contracts.agentRegistry,
  teeVerifierAddress: contracts.teeVerifier,
  validationRegistryAddress: contracts.validationRegistry,
  identityRegistryAddress: network.identityRegistryAddress,
  reputationRegistryAddress: network.reputationRegistryAddress,
  rpcUrl,
  pinataJwt,
  privateKey,
  zeroGRpcUrl,
  zeroGIndexerUrl,
};

const prepared = await prepareMint(config, {
  name: "My Agent",
  description: "Runs inside my Phala CVM oracle.",
  ownerAddress,
  services: [{ name: "teeOracle", endpoint: oracleUrl }],
  privateEntries: [
    { name: "SKILL.md", data: systemPrompt },
    { name: "config", data: JSON.stringify(modelConfig) },
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

**Run And Verify**

The agent owner signs `/run`. The oracle checks ownership, decrypts ERC-7857
private data inside the CVM, runs your handler, and returns a TDX proof bundle.

```typescript
const oracleInfo = await fetch(`${oracleUrl}/address`).then((res) =>
  res.json(),
);
const payload = {
  question: "Will ETH close above $4,000 on May 30, 2026?",
  url: "https://api.coingecko.com/api/v3/coins/ethereum/market_chart/range?vs_currency=usd&from=1780099200&to=1780185600",
};
// Omit url to let the prediction oracle research the web with Tavily.
const deadline = Math.floor(Date.now() / 1000) + 300;
const typedData = buildRunTypedData({
  oracleAddress: oracleInfo.address,
  chainId: network.chainId,
  agentId,
  payload,
  deadline,
});
const signature = await walletClient.signTypedData({
  account: ownerAddress,
  ...typedData,
});

const run = await fetch(`${oracleUrl}/run`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    agentId: agentId.toString(),
    registryAddress: contracts.agentRegistry,
    payload,
    signature,
    deadline,
  }),
}).then((res) => res.json());

const verified = await fetch(`${oracleUrl}/verify`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ proof: run.proof }),
}).then((res) => res.json());
```

`/verify` also compares the proof measurements against the current oracle
environment when both proofs expose RTMRs:

| Measurement | What it represents                              |
| ----------- | ----------------------------------------------- |
| `RTMR0`     | CVM virtual hardware / firmware configuration   |
| `RTMR1`     | Linux kernel measurement                        |
| `RTMR2`     | Kernel parameters, initrd, and rootfs integrity |
| `RTMR3`     | dstack app compose hash and runtime events      |

Matching RTMRs means the run proof and verification proof came from the same
measured TDX environment. A mismatch means the quote may still be a real TDX
quote, but it was not produced by the same measured hardware / OS / app stack.

**Request A Run Validation**

Validation is event-driven:

1. Write `ValidationRegistry.validationRequest(...)`.
2. A worker watches `ValidationRequest` events.
3. The worker signs a `/validate` request with `PRIVATE_KEY`.
4. The oracle reruns / checks the result, usually with another model at
   temperature `0`.
5. The oracle submits `validationResponse(...)` with a TDX quote.
6. The result can feed ERC-8004 reputation without Sybil-prone self-reporting.

```typescript
const requestURI = toDataUri({
  type: "tee-agent.run",
  agentId: agentId.toString(),
  payload,
  outcome: run.result,
  proof: run.proof,
  timestamp: run.timestamp,
});
const validation = prepareValidation(config, {
  agentId: erc8004AgentId,
  validatorAddress: contracts.teeVerifier,
  requestURI,
});

await walletClient.writeContract({
  address: contracts.validationRegistry,
  abi: VALIDATION_REGISTRY_ABI,
  functionName: "validationRequest",
  args: [
    validation.validatorAddress,
    BigInt(validation.agentId),
    validation.requestURI,
    validation.requestHash,
  ],
});
```

**Transfer**

Transfer keeps storage out of the SDK. Persist offers and acceptances wherever
your app wants: database, queue, inbox, IPFS, or files.

Sender side:

- owns the ERC-7857 NFT and linked ERC-8004 identity
- signs the re-encryption request for the current oracle
- calls `createTransferOffer(...)`
- submits the final `buildTransferTxArgs(...)` transaction

Receiver side:

- chooses the destination oracle / public key
- signs the returned access payload digests
- sends the acceptance back to the sender

The current oracle re-wraps encrypted 0G content keys for the receiver's oracle
key inside the TEE. Plaintext skills/models are not exposed to either wallet.

```typescript
// sender
const offer = await createTransferOffer(config, transferParams);

// receiver
const toSign = getTransferAccessPayloadsToSign(offer);
const signatures = await wallet.signMessages(toSign);
const acceptance = buildTransferAcceptance(offer, signatures);

// sender
await walletClient.writeContract(buildTransferTxArgs(acceptance));
```

Changing an agent's `teeOracle` is a key-rotation flow, not a normal metadata
edit. Existing encrypted content keys must be re-wrapped for the new oracle key.

### 6. Respond To A Validation Request

The hosted dashboard already implements the event watcher for its own worker.
If you run your own worker, configure `VALIDATION_ORACLE_URLS` with the oracle
URLs it owns.

For the bundled dashboard/oracle automation, `PRIVATE_KEY` must resolve to the
owner of the ERC-8004 agent id being validated. The worker only responds for
agents it owns.

Minimal worker shape, imports omitted:

```typescript
const signer = privateKeyToAccount(process.env.PRIVATE_KEY);
const identityRegistry = new IdentityRegistry({
  address: network.identityRegistryAddress,
  publicClient,
});
const validationRegistry = new ValidationRegistry({
  address: contracts.validationRegistry,
  publicClient,
});

const events = await publicClient.getContractEvents({
  address: contracts.validationRegistry,
  abi: VALIDATION_REGISTRY_ABI,
  eventName: "ValidationRequest",
  fromBlock,
  toBlock,
});

for (const event of events) {
  if (event.args.validatorAddress !== contracts.teeVerifier) continue;

  const status = await validationRegistry.getValidationStatus(
    event.args.requestHash,
  );
  if (status.lastUpdate > 0n) continue;

  const owner = await identityRegistry.ownerOf(event.args.agentId);
  if (owner.toLowerCase() !== signer.address.toLowerCase()) continue;

  const oracleUrl = await resolveTeeOracleUrl(event.args.agentId);
  const oracleInfo = await fetch(`${oracleUrl}/address`).then((res) =>
    res.json(),
  );
  const payload = await readJsonFromUri(event.args.requestURI);
  const deadline = Math.floor(Date.now() / 1000) + 300;
  const typedData = buildValidateTypedData({
    oracleAddress: oracleInfo.address,
    chainId: network.chainId,
    erc8004AgentId: event.args.agentId,
    requestHash: event.args.requestHash,
    payload,
    deadline,
  });
  const signature = await signer.signTypedData(typedData);

  await fetch(`${oracleUrl}/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      erc8004AgentId: event.args.agentId.toString(),
      requestHash: event.args.requestHash,
      payload,
      validationRegistryAddress: contracts.validationRegistry,
      signature,
      deadline,
    }),
  });
}
```

---

## How It Fits Together

| Piece                  | What it does                                                                    |
| ---------------------- | ------------------------------------------------------------------------------- |
| ERC-8004 Identity      | Official agent identity and service discovery, compatible with 8004scan.io      |
| ERC-7857 AgentRegistry | Agent NFT plus encrypted private intelligent data                               |
| Phala CVM Oracle       | Decrypts skills, runs handlers, re-encrypts keys, returns TDX quotes            |
| TeeVerifier            | Verifies TDX-backed oracle registration, transfer proofs, and validation proofs |
| ValidationRegistry     | Stores validation requests and responses                                        |
| ReputationRegistry     | Receives validation-backed feedback                                             |

Remote trust is not the URL. The URL is how clients find the oracle. Trust comes
from Intel TDX quotes verified through TeeVerifier and Automata DCAP.
RTMR checks make that trust inspectable: RTMR0-2 identify the measured platform
and OS path, while RTMR3 identifies the dstack application compose/runtime path
that actually ran the oracle code.

---

## Package Overview

| Package                 | Role                                                                                                                                                  |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@tee-agent/agent`      | SDK for app/backend usage: network config, ABIs, registry reads, mint prep, transfer prep, services, validation, feedback, encryption, and 0G Storage |
| `@tee-agent/oracle`     | Reusable oracle runtime: `startOracle({ handler, deployments })`, TDX key handling, quotes, decrypt, `/run`, `/validate`, `/reencrypt`, `/verify`     |
| `@tee-agent/contracts`  | Solidity contracts and deployment scripts for protocol development or optional custom deployments                                                     |
| `@tee-agent/oracle-app` | Example oracle entries and Phala CVM deploy workspace                                                                                                 |
| `@tee-agent/dashboard`  | Optional local Next.js dashboard; hosted UI is https://teeagent.xyz                                                                                   |
| `@tee-agent/mcp`        | MCP server for AI clients to discover agents, prepare transactions, run signed oracle calls, and verify Tee Agent feedback                             |

Main SDK subpaths:

```text
@tee-agent/agent/network
@tee-agent/agent/registry
@tee-agent/agent/ops/mint
@tee-agent/agent/ops/transfer
@tee-agent/agent/ops/transfer-acceptance
@tee-agent/agent/ops/services
@tee-agent/agent/ops/feedback
@tee-agent/agent/ops/validate
@tee-agent/agent/typed-data
```

TODO: Move remaining `writeContract` helpers into the package registry clients.
TODO: Use 8004 TAP agents.

---

## Local Development

### MCP Server

The MCP server exposes Tee Agent tools to AI clients over stdio or Streamable
HTTP.

```bash
npm run mcp:build
npm run mcp:start
```

Configure your MCP client with:

```json
{
  "mcpServers": {
    "tee-agent": {
      "command": "node",
      "args": ["apps/mcp/dist/index.js"],
      "env": {
        "RPC_URL_ARBITRUM_SEPOLIA": "...",
        "PINATA_JWT": "...",
        "RPC_URL_ZERO_G": "...",
        "INDEXER_URL_ZERO_G": "..."
      }
    }
  }
}
```

The MCP server never submits transactions or signs with a server wallet. Tools
that mutate chain state return `tx.address`, `tx.functionName`, and `tx.args`
for the caller to submit with their own wallet. `PINATA_JWT` and 0G env vars
are only needed for metadata/private-blob uploads during prepare flows.

For HTTP transport:

```bash
npm run mcp:start:http
```

The HTTP endpoint is `POST /mcp`; `GET /health` returns a simple status check.
Set `MCP_HOST` and `PORT` when deploying outside localhost.

The dashboard also exposes a Vercel-compatible endpoint at `POST /api/mcp`
with `GET /api/mcp` as its health check. Set `MCP_API_KEY` only when you want
to require `x-api-key` or `Authorization: Bearer ...` for access.

### Optional Local Dashboard

The hosted dashboard at https://teeagent.xyz is the preferred UI. Run this only
if you want local frontend development.

```bash
cp apps/dashboard/.env.example apps/dashboard/.env
npm --workspace @tee-agent/dashboard run dev
```

### Oracle Simulator

```bash
npm --workspace @tee-agent/oracle-app run dev:prediction-market
```

### Full Workspace

```bash
npm run dev
```

### E2E

```bash
npm run e2e:arbitrumSepolia
```

---

## Optional: Deploy Your Own Contracts

The shared deployed contracts are the preferred path. Use this only for protocol
development or simulator-specific contract sets.

```bash
npm --workspace @tee-agent/contracts run test
npm --workspace @tee-agent/contracts run deploy:arbitrumSepolia:remoteOracle
npm --workspace @tee-agent/contracts run deploy:arbitrumSepolia
```

For local tappd simulator contracts:

```bash
npm --workspace @tee-agent/contracts run deploy:arbitrumSepolia:localOracle
```

To rewrite root `deployments.json` from existing Ignition deployments:

```bash
npm --workspace @tee-agent/contracts run setup-env
```

---

## Environment Variables

### `.env.example` (repo root, oracle deployment)

| Name            | Required | Description                                                                                                                                   |
| --------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `GHCR_PUSH_PAT` | Image    | GitHub classic token for pushing/pulling the private oracle image from GHCR. `npm run oracle:image` prompts for it when missing and saves it. |
| `APP_NAME`      | No       | Phala dstack key path used to derive the TEE signing key. Defaults to `TEE-ORACLE`; changing it rotates the oracle TEE address.               |

`npm run oracle:image` writes local image metadata to
`.oracle-image-state.json`. `npm run oracle:deploy` reads that state and injects
the Phala private-registry pull credentials. Do not set `ORACLE_IMAGE`,
`ORACLE_DEPLOYMENTS_SHA`, `ORACLE_IMAGE_SOURCE_SHA`, or `DSTACK_DOCKER_*`
manually.

### `apps/oracle/.env.example`

| Name                       | Required                     | Description                                             |
| -------------------------- | ---------------------------- | ------------------------------------------------------- |
| `NETWORK`                  | Yes                          | `arbitrumSepolia`, `baseSepolia`, or `base`             |
| `RPC_URL_BASE`             | If `NETWORK=base`            | Base mainnet RPC                                        |
| `RPC_URL_BASE_SEPOLIA`     | If `NETWORK=baseSepolia`     | Base Sepolia RPC                                        |
| `RPC_URL_ARBITRUM_SEPOLIA` | If `NETWORK=arbitrumSepolia` | Arbitrum Sepolia RPC                                    |
| `PRIVATE_KEY`              | Yes                          | Oracle gas / validation signer; not the agent owner key |
| `LLM_API_KEY`              | Yes                          | LLM provider key for example handlers and `/validate`   |
| `LLM_API_BASE`             | Yes                          | OpenAI-compatible API base                              |
| `LLM_VALIDATION_MODEL`     | Yes                          | Model used by `/validate`                               |
| `TAVILY_API_KEY`           | Web research                 | Tavily key for prediction questions without url         |
| `RPC_URL_ZERO_G`           | Yes                          | 0G Storage EVM RPC                                      |
| `INDEXER_URL_ZERO_G`       | Yes                          | 0G Storage indexer                                      |
| `PORT`                     | Yes                          | Oracle HTTP port; Phala compose uses `3001`             |
| `DSTACK_VERIFIER_URL`      | Yes                          | dstack verifier sidecar URL used by `/verify`           |

### `apps/dashboard/.env.example` (optional local dashboard)

| Name                                   | Required      | Description                                               |
| -------------------------------------- | ------------- | --------------------------------------------------------- |
| `PORT`                                 | Yes           | Local dashboard port                                      |
| `RPC_URL_BASE`                         | Network       | Server-side Base RPC for actions, indexing, cron          |
| `RPC_URL_BASE_SEPOLIA`                 | Network       | Server-side Base Sepolia RPC for actions, indexing, cron  |
| `RPC_URL_ARBITRUM_SEPOLIA`             | Network       | Server-side Arbitrum Sepolia RPC for actions and indexing |
| `PRIVATE_KEY`                          | Yes           | Backend signer for uploads and validation automation      |
| `VALIDATION_ORACLE_URLS`               | Validation    | Comma-separated `teeOracle` URLs this worker owns         |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | WalletConnect | WalletConnect project id                                  |
| `PINATA_JWT`                           | Yes           | Pinata JWT for IPFS agent metadata uploads                |
| `RPC_URL_ZERO_G`                       | Yes           | 0G Storage EVM RPC                                        |
| `INDEXER_URL_ZERO_G`                   | Yes           | 0G Storage indexer                                        |
| `UPSTASH_REDIS_REST_URL`               | No            | Optional Redis cache URL                                  |
| `UPSTASH_REDIS_REST_TOKEN`             | No            | Optional Redis cache token                                |
| `CRON_SECRET`                          | No            | Optional Vercel cron bearer token                         |

### `contracts/.env.example` (optional contract deployment)

| Name                       | Required | Description                     |
| -------------------------- | -------- | ------------------------------- |
| `TESTNET_PRIVATE_KEY`      | Yes      | Deployer key on Testnet         |
| `MAINNET_PRIVATE_KEY`      | Yes      | Deployer key on Mainnet         |
| `RPC_URL_BASE_SEPOLIA`     | Network  | Base Sepolia deployment RPC     |
| `RPC_URL_ARBITRUM_SEPOLIA` | Network  | Arbitrum Sepolia deployment RPC |
| `RPC_URL_BASE`             | Network  | Base mainnet deployment RPC     |
| `EXPLORER_API_KEY`         | No       | Basescan verification API key   |

---

## Standards

- ERC-8004: agent identity, services, validation, reputation
- ERC-7857: encrypted intelligent digital assets
- Intel TDX: hardware-isolated execution
- Automata DCAP: on-chain TDX quote verification
- 0G Storage: encrypted blob storage
- Pinata IPFS: public ERC-8004 metadata
