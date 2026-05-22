# Open Agents Toolkit

Create, own, and manage AI agents on-chain with verifiable identity, private encrypted data, and transparent reputation.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.35-blue)](https://soliditylang.org)

---

## What is it?

Open Agents Toolkit (OAT) is a full-stack framework for deploying AI agents as sovereign on-chain entities. Each agent is an ERC-721 NFT on **Base** or **Base Sepolia** with private encrypted data managed through a TEE oracle.

**Architecture:** The frontend (Next.js dashboard) owns all contract writes directly via viem. The SDK packages provide read-only clients, encryption/decryption utilities, and server-side helpers for data preparation.

---

## Core Pillars

### 1. On-Chain Agent Identity — ERC-721 + ERC-8004

Every agent is minted as an **ERC-721 NFT** on Base. Ownership is registered on-chain with an **EIP-712 typed-data proof**, ensuring the agent wallet signature is verifiable by anyone.

- Agent identity is tied to the NFT token ID — transferable and composable with existing NFT infrastructure
- Agents are discoverable on-chain via `AgentRegistry` (ERC-8004)
- Service endpoints (MCP, A2A, web, DID, etc.) are defined on-chain with the agent

### 2. Private Intelligent Data — ERC-7857 + TEE Oracle

Sensitive agent data — system prompts, agent definitions, API keys, knowledge bases — is stored as **Intelligent Data** per the [ERC-7857](https://eips.ethereum.org/EIPS/eip-7857) standard. All data is AES-256-GCM encrypted and uploaded to **0G Storage** (a decentralised, content-addressed storage network). The `zerog://` URI and a content hash are anchored on-chain.

- Data is encrypted with **AES-256-GCM**, with sealed keys managed by a **TEE Oracle** (Intel TDX via Phala Cloud)
- Only the current owner (or explicitly approved wallets) can decrypt and use the agent's private data
- **Approve** another wallet to access your agent's data without transferring ownership
- **Transfer** the NFT — private data is automatically re-encrypted for the new owner inside the TEE, verified on-chain by `TEEVerifier`. No plaintext ever leaves the secure enclave.

### 3. On-Chain Reputation & Services — ERC-8004

Agents earn a verifiable, tamper-proof reputation through the [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) standard. Other agents and clients can submit scored feedback on-chain, building a trustless track record.

- **Reputation scores** are fixed-point values (int128 × 10^decimals) stored on-chain with Sybil-resistant client filtering
- Define **service endpoints** directly on-chain: MCP, A2A, web, DID, email, and custom protocols
- Reputation and service definitions travel with the agent NFT — new owners inherit the agent's full history

---

## Full Lifecycle

1. **Register** — Mint an ERC-721 NFT on Base. Sign an EIP-712 proof to link the agent wallet on-chain.
2. **Encrypt & Store** — Private data (prompts, config, API keys) is AES-256-GCM encrypted and uploaded to **0G Storage** (decentralised content-addressed storage). The `zerog://` URI and a content hash are anchored on-chain.
3. **Define Services** — Publish MCP, A2A, web, and other endpoints on-chain so other agents and clients can discover and connect to your agent.
4. **Approve or Transfer** — Approve other wallets to access your agent's private data, or transfer the NFT entirely. On transfer, the TEE re-encrypts all private data for the new owner — verified on-chain.
5. **Earn Reputation** — Other agents and clients submit feedback scores on-chain. Reputation accumulates on the agent NFT and persists across ownership changes.
6. **Discover** — Browse all registered agents, filter by reputation, and connect via their published service endpoints.

---

## Repository Structure

```
open-agents-toolkit/
├── packages/
│   └── agent/         # Types, encryption/decryption, ABIs, registry client
├── contracts/         # Solidity 0.8.35 (Hardhat + viaIR)
│   ├── src/
│   │   ├── AgentRegistry.sol   # ERC-8004 + ERC-721 — core agent NFT + identity
│   │   ├── ERC7857.sol         # ERC-7857 Intelligent Digital Asset base
│   │   ├── TeeVerifier.sol     # ECDSA attestation verifier for TEE oracle proofs
│   │   └── Verifier.sol        # ERC-7857 data verifier (wraps TeeVerifier)
│   ├── test/           # Contract tests (node:test + viem)
│   └── ignition/       # Hardhat Ignition deployment modules
└── apps/
    ├── dashboard/      # Next.js 16 App Router — agent management UI
    └── oracle/         # Phala Cloud TEE re-encryption oracle server
```

---

## Networks

| Network      | Chain ID | RPC                      | Explorer                     |
| ------------ | -------- | ------------------------ | ---------------------------- |
| Base         | 8453     | https://mainnet.base.org | https://basescan.org         |
| Base Sepolia | 84532    | https://sepolia.base.org | https://sepolia.basescan.org |

Set `NEXT_PUBLIC_NETWORK=base` or `NEXT_PUBLIC_NETWORK=baseSepolia` (default: `baseSepolia`).

---

## Smart Contracts

| Contract        | Standard           | Description                                                           |
| --------------- | ------------------ | --------------------------------------------------------------------- |
| `AgentRegistry` | ERC-8004 / ERC-721 | Core agent identity — mint NFT, store metadata URI, on-chain services |
| `TeeVerifier`   | ERC-7857           | ECDSA attestation verifier for TEE oracle signing keys                |
| `Verifier`      | ERC-7857           | ERC-7857 data verifier that wraps `TeeVerifier`                       |

Contract ABIs are exported from `@open-agents-toolkit/agent`:

```typescript
// Server-side
import {
  AGENT_REGISTRY_ABI,
  AGENT_NFT_ABI,
  TEE_VERIFIER_ABI,
  VERIFIER_ABI,
} from "@open-agents-toolkit/agent/abis";

// Browser / frontend (no Node.js deps)
import { AGENT_REGISTRY_ABI } from "@open-agents-toolkit/agent/browser";
```

---

## SDK — `@open-agents-toolkit/agent`

TypeScript client for ERC-8004 registry queries, AES-256-GCM encryption, 0G Storage uploads, and server-side data preparation.

### `AgentRegistry` — registry reads

```typescript
import { AgentRegistry } from "@open-agents-toolkit/agent/registry";

const registry = new AgentRegistry({
  agentRegistryAddress: "0x...",
  publicClient,
});

// Resolve agent + fetch metadata
const agent = await registry.resolve(agentId);
```

### Encryption utilities

```typescript
import {
  encryptIntelligentData, // AES-256-GCM encrypt system prompt + character def (in-memory)
  readJsonFromUri, // fetch JSON from data: or HTTPS URIs
  buildAccessPayloads, // build owner-signed access proofs for transfer
  buildDecryptMessage, // build EIP-191 message for key request
} from "@open-agents-toolkit/agent/encryption";
```

### 0G Storage — `ZeroGStorageClient`

Encrypted private blobs and public metadata are stored on **0G Storage** — a decentralised, content-addressed storage network. The returned `zerog://` URIs are anchored on-chain.

```typescript
import {
  ZeroGStorageClient,
  uploadEncryptedIntelligentData,
} from "@open-agents-toolkit/agent/zero-g";

// Upload a JSON object and get a zerog:// URI
const client = new ZeroGStorageClient({ privateKey: "0x..." });
const uri = await client.uploadJSON({ name: "my-agent", version: "1" });
// uri = "zerog://0x<rootHash>"
```

**Mint flow:**

```typescript
// 1. Server action — encrypt + upload private blobs to 0G Storage
const intelligentData = await uploadEncryptedIntelligentData({
  systemPrompt,
  characterDef,
  keyEncryptionPublicKey,
  zeroGPrivateKey: process.env.ZERO_G_PRIVATE_KEY,
});
// intelligentData = [{ name, uri: "zerog://0x...", hash: "0x..." }, ...]

// 2. Upload public metadata to 0G Storage
const metadataUri = await client.uploadJSON(agentMetadata);
// metadataUri = "zerog://0x..."

// 3. Frontend — mint via viem
await walletClient.writeContract({
  address: registryAddress,
  abi: AGENT_REGISTRY_ABI,
  functionName: "mint",
  args: [
    agentWallet,
    tokenUri,
    metadataUri,
    intelligentData.map((d) => ({ dataDescription: d.uri, dataHash: d.hash })),
  ],
});
```

---

## Dashboard

The `apps/dashboard` Next.js 16 app is the primary UI. Connects to Base or Base Sepolia.

- All contract writes execute in the browser via viem — no backend proxy
- Server Actions (`/lib/actions/`) handle encryption and oracle calls
- No API routes for internal use

---

## Quick Start

### Prerequisites

- Node.js ≥ 20
- npm ≥ 10
- A wallet funded on Base Sepolia (faucet: https://www.coinbase.com/faucets/base-ethereum-goerli-faucet)

### 1. Install and build packages

```bash
npm install
npm run build --prefix packages
```

### 2. Fund 0G testnet wallet

Private blob and metadata uploads require a small amount of 0G testnet tokens. Use the same key as `ZERO_G_PRIVATE_KEY` (or `PRIVATE_KEY`):

- Faucet: https://faucet.0g.ai
- 0G testnet RPC: `https://evmrpc-testnet.0g.ai`

### 3. Deploy contracts to Base Sepolia

```bash
cd contracts
npm test                         # run contract tests first
npm run deploy:baseSepolia
npm run setOracle:baseSepolia    # register the TEE oracle address
```

Copy the deployed contract addresses into your dashboard env.

### 4. Configure environment

```bash
cd apps/dashboard
cp .env.example .env
```

```env
# Chain
NEXT_PUBLIC_NETWORK=baseSepolia
RPC_URL=https://sepolia.base.org

# Contracts (from deployment above)
AGENT_REGISTRY_ADDRESS=0x...
NEXT_PUBLIC_TEE_VERIFIER_ADDRESS=0x...

# Deployer / signer
PRIVATE_KEY=0x...

# 0G Storage (for encrypted blob uploads — falls back to PRIVATE_KEY)
ZERO_G_PRIVATE_KEY=0x...
# ZERO_G_RPC_URL=https://evmrpc-testnet.0g.ai
# ZERO_G_INDEXER_URL=https://indexer-storage-testnet-standard.0g.ai

# Phala oracle (for secure NFT transfers — leave unset to skip)
ORACLE_URL=https://<app-id>-3000.dstack.host
```

### 5. Start the dashboard

```bash
cd apps/dashboard && npm run dev
```

---

## Environment Variables

| Variable                           | Required | Description                                                    |
| ---------------------------------- | -------- | -------------------------------------------------------------- |
| `NEXT_PUBLIC_NETWORK`              | Yes      | `base` or `baseSepolia` (default: `baseSepolia`)               |
| `RPC_URL`                          | Yes      | EVM RPC endpoint for the app chain                             |
| `AGENT_REGISTRY_ADDRESS`           | Yes      | Deployed `AgentRegistry` contract address                      |
| `NEXT_PUBLIC_TEE_VERIFIER_ADDRESS` | No       | Deployed `TEEVerifier` address                                 |
| `PRIVATE_KEY`                      | Yes      | Deployer / server-side signer key                              |
| `ZERO_G_PRIVATE_KEY`               | Yes      | Key for 0G Storage uploads (falls back to `PRIVATE_KEY`)       |
| `ZERO_G_RPC_URL`                   | No       | 0G Storage EVM RPC (default: `https://evmrpc-testnet.0g.ai`)   |
| `ZERO_G_INDEXER_URL`               | No       | 0G Indexer URL (default: 0G testnet standard indexer)          |
| `ORACLE_PRIVATE_KEY`               | No       | Local oracle key for dev/testing (falls back to `PRIVATE_KEY`) |
| `ORACLE_URL`                       | No       | Phala Cloud CVM URL. When set, uses remote TEE for transfers   |

---

## Open Standards

- **[ERC-8004](https://eips.ethereum.org/EIPS/eip-8004)** — Trustless Agent Registry (identity, reputation, validation)
- **[ERC-7857](https://eips.ethereum.org/EIPS/eip-7857)** — Intelligent Digital Assets (ownable AI agents with encrypted private metadata)
