/**
 * E2E script: mint an agent and transfer it, always including the ERC-7857
 * secure transfer path (oracle test is never skipped).
 *
 * Usage:
 *   npm run e2e:local          # against local Hardhat node (chain 31337)
 *   npm run e2e:arbitrumSepolia     # against Arbitrum Sepolia (chain 421614)
 *
 * Environment variables:
 *   PRIVATE_KEY          — sender key
 *   LOCAL_RPC_URL        — local RPC
 *   RPC_URL_ARBITRUM_SEPOLIA  — Arbitrum Sepolia RPC
 *   ORACLE_URL           — unused by e2e; tests run a localhost oracle
 *   PINATA_JWT           — Pinata JWT for IPFS metadata
 *   RPC_URL_ZERO_G       — 0G Storage RPC for encrypted blobs
 *   INDEXER_URL_ZERO_G   — 0G Storage indexer for encrypted blobs
 */
import { config as loadEnv } from "dotenv";
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  parseAbi,
  parseEventLogs,
  toBytes,
  zeroAddress,
} from "viem";
import type { Address, Hex } from "viem";
import type { EncryptedBlob } from "../packages/agent/dist/types.js";
import { arbitrumSepolia, hardhat } from "viem/chains";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";
import {
  generateContentKey,
  encryptMetadata,
  hashEncryptedBlob,
  decryptContentKey,
  decryptMetadata,
  readJsonFromUri,
} from "../packages/agent/dist/crypto.js";
import { NETWORK_CONFIG } from "../packages/agent/dist/network.js";
import {
  AGENT_REGISTRY_ABI,
  VALIDATION_REGISTRY_ABI,
  REPUTATION_REGISTRY_ABI,
  IDENTITY_REGISTRY_ABI,
} from "../packages/agent/dist/abis.js";
import {
  AgentRegistry,
  IdentityRegistry,
  ReputationRegistry,
  TeeVerifierRegistry,
  ValidationRegistry,
} from "../packages/agent/dist/registry/index.js";
import { createTransferOffer } from "../packages/agent/dist/ops/transfer.js";
import {
  buildTransferAcceptance,
  buildTransferTxArgs,
  getTransferAccessPayloadsToSign,
} from "../packages/agent/dist/ops/transfer-acceptance.js";
import { prepareMint } from "../packages/agent/dist/ops/mint.js";
import {
  fetchAgentServices,
  prepareUpdateServices,
} from "../packages/agent/dist/ops/services.js";
import { prepareFeedback } from "../packages/agent/dist/ops/feedback.js";
import { prepareValidation } from "../packages/agent/dist/ops/validate.js";
import { readZeroGBytes } from "../packages/agent/dist/storage/zero-g.js";
import {
  buildReencryptTypedData,
  buildRunTypedData,
} from "../packages/agent/dist/typed-data.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const envPaths = [
  resolve(repoRoot, ".env"),
  resolve(repoRoot, "apps/dashboard/.env"),
  resolve(repoRoot, "contracts/.env"),
  resolve(repoRoot, "apps/oracle/.env"),
];
for (const envPath of envPaths) {
  loadEnv({ path: envPath, quiet: true });
}
loadEnv({ path: resolve(__dirname, ".env"), quiet: true, override: true });

// ── Network selection ─────────────────────────────────────────────────────────

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

const NETWORK = process.argv[2];
if (NETWORK !== "local" && NETWORK !== "arbitrumSepolia") {
  throw new Error("Usage: npm run e2e:local or npm run e2e:arbitrumSepolia");
}
const isLocal = NETWORK === "local";

// ── Config ────────────────────────────────────────────────────────────────────

const CHAIN_ID = isLocal ? 31337 : 421614;
const RPC_URL = requiredEnv(
  isLocal ? "LOCAL_RPC_URL" : "RPC_URL_ARBITRUM_SEPOLIA",
);
const PRIVATE_KEY = requiredEnv("PRIVATE_KEY") as `0x${string}`;
const ORACLE_URL = "http://localhost:3001";
const NORMALIZED_ORACLE_URL = ORACLE_URL.replace(/\/+$/, "");

const chain = isLocal
  ? ({ ...hardhat, rpcUrls: { default: { http: [RPC_URL] } } } as const)
  : ({
      ...arbitrumSepolia,
      rpcUrls: { default: { http: [RPC_URL] } },
    } as const);

// ── Local node setup ────────────────────────────────────────────────────────
if (isLocal) {
  try {
    const res = await fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "eth_blockNumber",
        params: [],
        id: 1,
      }),
      signal: AbortSignal.timeout(2_000),
    });
    if (!res.ok) throw new Error();
  } catch {
    throw new Error(
      `Hardhat node is not running at ${RPC_URL}.\n` +
        `Start it manually: cd contracts && npx hardhat node`,
    );
  }
}

function runRequiredCommand(
  label: string,
  command: string,
  args: string[],
  extraEnv: Record<string, string> = {},
  hint = `Run local deploy first: npm --workspace @tee-agent/contracts run deploy:localOracle`,
): void {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: { ...process.env, ...extraEnv },
    encoding: "utf8",
  });
  if (result.status === 0) return;

  const details = [result.stdout, result.stderr]
    .filter((value) => value && value.trim())
    .join("\n")
    .trim();
  throw new Error(`${label} failed.${details ? `\n${details}` : ""}\n` + hint);
}

if (isLocal) {
  runRequiredCommand(
    "setup-env:localOracle",
    "npm",
    ["--workspace", "@tee-agent/contracts", "run", "setup-env:localOracle"],
    { LOCAL_ORACLE: "local" },
  );
} else {
  runRequiredCommand(
    "setup-env",
    "npm",
    ["--workspace", "@tee-agent/contracts", "run", "setup-env"],
    {},
    "Deploy the Arbitrum Sepolia remote-oracle contract set first: npm --workspace @tee-agent/contracts run deploy:arbitrumSepolia",
  );
}

// ── Load deployed addresses ───────────────────────────────────────────────────

type DeploymentJson = Record<
  string,
  {
    contracts?: Record<string, string | undefined>;
    fromBlock?: string | number;
  }
>;

const rootDeployments = JSON.parse(
  readFileSync(resolve(__dirname, "../deployments.json"), "utf8"),
) as DeploymentJson;
const rootDeployment = rootDeployments?.[String(CHAIN_ID)];
const deploymentContracts = rootDeployment?.contracts;
const deploymentFromBlock =
  rootDeployment?.fromBlock !== undefined
    ? BigInt(rootDeployment.fromBlock)
    : undefined;
if (!isLocal && deploymentFromBlock === undefined) {
  throw new Error(`Missing deployment entry for chain ${CHAIN_ID}: fromBlock`);
}
const sealedKeyFromBlock = deploymentFromBlock ?? 0n;

function requiredDeploymentAddress(key: string): `0x${string}` {
  const value = deploymentContracts?.[key];
  if (!value) {
    throw new Error(
      `Missing deployment entry for chain ${CHAIN_ID}: contracts.${key}`,
    );
  }
  return value as `0x${string}`;
}

const AGENT_REGISTRY_ADDRESS = requiredDeploymentAddress("agentRegistry");
const teeVerifierAddress = requiredDeploymentAddress("teeVerifier");
const VALIDATION_REGISTRY_ADDRESS =
  requiredDeploymentAddress("validationRegistry");

/**
 * Official ERC-8004 singletons.
 * Mainnet (Base):          identity 0x8004A169…  reputation 0x8004BAa1…
 * Testnets: identity 0x8004A818…  reputation 0x8004B663…
 * Not present on local Hardhat nodes.
 */
const identityRegistryAddress = isLocal
  ? ("0x0000000000000000000000000000000000000000" as `0x${string}`)
  : NETWORK_CONFIG.arbitrumSepolia.identityRegistryAddress;

const REPUTATION_REGISTRY_ADDRESS = (
  isLocal ? undefined : NETWORK_CONFIG.arbitrumSepolia.reputationRegistryAddress
) as `0x${string}` | undefined;

// ── Clients ───────────────────────────────────────────────────────────────────

const account = privateKeyToAccount(PRIVATE_KEY);
const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });
const walletClient = createWalletClient({
  account,
  chain,
  transport: http(RPC_URL),
});

const recipientPrivKey = generatePrivateKey();
const recipientAccount = privateKeyToAccount(recipientPrivKey);
const recipient = recipientAccount.address;
const recipientWalletClient = createWalletClient({
  account: recipientAccount,
  chain,
  transport: http(RPC_URL),
});

console.log(`Network:       ${NETWORK} (chain ${CHAIN_ID})`);
console.log(`AgentRegistry: ${AGENT_REGISTRY_ADDRESS}`);
console.log(`TEEVerifier:   ${teeVerifierAddress}`);
console.log(`Sender:        ${account.address}`);
console.log(`Recipient:     ${recipient}`);

// ── Registry clients ──────────────────────────────────────────────────────────

const agentRegistry = new AgentRegistry({
  address: AGENT_REGISTRY_ADDRESS,
  chainId: CHAIN_ID,
  rpcUrl: RPC_URL,
});
const identityRegistry = new IdentityRegistry({
  chainId: CHAIN_ID,
  rpcUrl: RPC_URL,
});
const teeVerifierRegistry = new TeeVerifierRegistry({
  address: teeVerifierAddress,
  chainId: CHAIN_ID,
  rpcUrl: RPC_URL,
});
const validationRegistry = new ValidationRegistry({
  address: VALIDATION_REGISTRY_ADDRESS,
  chainId: CHAIN_ID,
  rpcUrl: RPC_URL,
});
const sdkConfig = {
  chain,
  rpcUrl: RPC_URL,
  registryAddress: AGENT_REGISTRY_ADDRESS,
  teeVerifierAddress,
  ...(identityRegistryAddress !== "0x0000000000000000000000000000000000000000"
    ? { identityRegistryAddress }
    : {}),
  ...(REPUTATION_REGISTRY_ADDRESS
    ? { reputationRegistryAddress: REPUTATION_REGISTRY_ADDRESS }
    : {}),
  validationRegistryAddress: VALIDATION_REGISTRY_ADDRESS,
  pinataJwt: requiredEnv("PINATA_JWT"),
  privateKey: PRIVATE_KEY,
  zeroGRpcUrl: requiredEnv("RPC_URL_ZERO_G"),
  zeroGIndexerUrl: requiredEnv("INDEXER_URL_ZERO_G"),
};
const reputationRegistry = REPUTATION_REGISTRY_ADDRESS
  ? new ReputationRegistry({
      chainId: CHAIN_ID,
      rpcUrl: RPC_URL,
    })
  : undefined;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function waitForReceipt(hash: `0x${string}`, label?: string) {
  // Use confirmations: 2 on testnet so we wait for 2 blocks after inclusion,
  // giving every node in the load-balanced RPC cluster time to catch up before
  // we make further reads/writes.
  const confirmations = isLocal ? 0 : 2;
  const r = await publicClient.waitForTransactionReceipt({
    hash,
    confirmations,
    timeout: 120_000,
    retryCount: 60,
    retryDelay: 2_000,
  });
  if (r.status === "reverted") throw new Error(`Tx reverted: ${label ?? hash}`);
  return r;
}

async function getMintFee(): Promise<bigint> {
  return 0n;
}

function jsonDataUri(data: unknown): string {
  return `data:application/json;base64,${Buffer.from(JSON.stringify(data)).toString("base64")}`;
}

/**
 * Write a mint call and return the actual minted tokenId read from on-chain
 * state after the transaction is confirmed (with 1 extra confirmation on
 * testnet so every node in the RPC cluster has caught up).
 */
async function mintAgentToken(
  mintArgs: [
    `0x${string}`,
    string,
    string,
    Array<{ dataDescription: string; dataHash: `0x${string}` }>,
  ],
  label: string,
): Promise<bigint> {
  const mintFee = await getMintFee();

  const hash = await walletClient.writeContract({
    address: AGENT_REGISTRY_ADDRESS,
    abi: AGENT_REGISTRY_ABI,
    functionName: "mint",
    args: mintArgs,
    account,
    chain,
    value: mintFee,
  });
  const receipt = await waitForReceipt(hash, label);

  // Parse the tokenId from the ERC-721 Transfer(0x0 → to) event in the receipt.
  // This is reliable regardless of concurrent minting or RPC load-balancing.
  const transferLogs = parseEventLogs({
    abi: parseAbi([
      "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
    ]),
    eventName: "Transfer",
    logs: receipt.logs,
  }).filter((l) => l.args.from === zeroAddress);

  if (transferLogs.length === 0)
    throw new Error(`No Transfer(0x0 → ...) log found in mint receipt ${hash}`);

  return transferLogs[0]!.args.tokenId;
}

async function readEncryptedBlob(uri: string): Promise<EncryptedBlob> {
  if (uri.startsWith("data:")) {
    const [, base64] = uri.split(",");
    if (!base64) throw new Error(`Encrypted blob URI is invalid: ${uri}`);
    return JSON.parse(Buffer.from(base64, "base64").toString("utf8"));
  }
  if (uri.startsWith("zerog://")) {
    const bytes = await readZeroGBytes(uri, requiredEnv("INDEXER_URL_ZERO_G"));
    return JSON.parse(Buffer.from(bytes).toString("utf8"));
  }
  throw new Error(`Unsupported encrypted blob URI: ${uri}`);
}

async function mintPreparedAgent(params: {
  name: string;
  description: string;
  ownerAddress: `0x${string}`;
  privateEntries?: Array<{ name: string; data: string }>;
  services?: Array<{
    name: string;
    endpoint: string;
    version?: string;
    skills?: string[];
    domains?: string[];
  }>;
  oasfSkills?: string[];
  oasfDomains?: string[];
}): Promise<{
  tokenId: bigint;
  prepared: Awaited<ReturnType<typeof prepareMint>>;
}> {
  const prepared = await prepareMint(sdkConfig, {
    agentType: "assistant",
    imageUrl: "https://placehold.co/512x512/png?text=Tee+Agent+E2E",
    services: [
      {
        name: "teeOracle",
        endpoint: NORMALIZED_ORACLE_URL,
        version: "1.0",
      },
      ...(params.services ?? []),
    ],
    privateEntries: params.privateEntries ?? [],
    oasfSkills: params.oasfSkills ?? [],
    oasfDomains: params.oasfDomains ?? [],
    name: params.name,
    description: params.description,
    ownerAddress: params.ownerAddress,
  });

  if (!prepared.publicMetadataUri.startsWith("ipfs://")) {
    throw new Error(
      `prepareMint public metadata must use IPFS, got ${prepared.publicMetadataUri}`,
    );
  }
  if (!prepared.agentMetadataUri.startsWith("ipfs://")) {
    throw new Error(
      `prepareMint agent metadata must use IPFS, got ${prepared.agentMetadataUri}`,
    );
  }

  const tokenId = await mintAgentToken(
    [
      params.ownerAddress,
      prepared.publicMetadataUri,
      prepared.agentMetadataUri,
      prepared.intelligentData,
    ],
    `mint ${params.name}`,
  );
  return { tokenId, prepared };
}

async function assertPreparedAgentMetadata(params: {
  tokenId: bigint;
  prepared: Awaited<ReturnType<typeof prepareMint>>;
  expectedName: string;
  expectedPrivateEntryCount: number;
}) {
  const publicUri = await agentRegistry.tokenURI(params.tokenId);
  const metadataUri = await agentRegistry.getMetadataUri(params.tokenId);
  const oracle = await getOracleInfo();
  if (
    params.prepared.teeOracleAddress.toLowerCase() !==
    oracle.address.toLowerCase()
  ) {
    throw new Error(
      `Prepared teeOracle address mismatch: ${params.prepared.teeOracleAddress} != ${oracle.address}`,
    );
  }
  if (publicUri !== params.prepared.publicMetadataUri) {
    throw new Error(`Public metadata URI mismatch for token ${params.tokenId}`);
  }
  if (metadataUri !== params.prepared.agentMetadataUri) {
    throw new Error(`Agent metadata URI mismatch for token ${params.tokenId}`);
  }

  const metadata = await readJsonFromUri<{
    name?: string;
    services?: Array<{ name?: string; endpoint?: string }>;
    registrations?: unknown[];
    supportedTrust?: string[];
    publicMetadataUri?: string;
  }>(metadataUri);
  if (metadata.name !== params.expectedName) {
    throw new Error(`Agent metadata name mismatch: ${metadata.name}`);
  }
  if (metadata.publicMetadataUri !== params.prepared.publicMetadataUri) {
    throw new Error("Agent metadata missing publicMetadataUri link.");
  }
  const teeOracle = metadata.services?.find(
    (service) => service.name === "teeOracle",
  );
  if (teeOracle?.endpoint !== NORMALIZED_ORACLE_URL) {
    throw new Error(
      `teeOracle service mismatch: expected ${ORACLE_URL}, got ${teeOracle?.endpoint}`,
    );
  }
  if (!metadata.supportedTrust?.includes("validation")) {
    throw new Error("Agent metadata missing validation support.");
  }

  const intelligentDatas = await agentRegistry.intelligentDatasOf(
    params.tokenId,
  );
  if (intelligentDatas.length !== params.expectedPrivateEntryCount) {
    throw new Error(
      `Expected ${params.expectedPrivateEntryCount} intelligent data entries, got ${intelligentDatas.length}`,
    );
  }
  for (const entry of intelligentDatas) {
    if (!entry.dataDescription.startsWith("zerog://")) {
      throw new Error(
        `Encrypted intelligent data must use 0G, got ${entry.dataDescription}`,
      );
    }
  }
}

// ── Oracle helpers ────────────────────────────────────────────────────────────

async function getOracleInfo(): Promise<{
  address: `0x${string}`;
  publicKey: string;
}> {
  const res = await fetch(`${ORACLE_URL}/address`);
  if (!res.ok)
    throw new Error(
      `Oracle unreachable at ${ORACLE_URL}/address — start the oracle (npm run dev --prefix apps/oracle)`,
    );
  return (await res.json()) as { address: `0x${string}`; publicKey: string };
}

async function runOracleAgent(params: {
  oracleAddress: `0x${string}`;
  tokenId: bigint;
  payload: Record<string, unknown>;
}) {
  const deadline = Math.floor(Date.now() / 1000) + 300;
  const typedData = buildRunTypedData({
    oracleAddress: params.oracleAddress,
    chainId: CHAIN_ID,
    agentId: params.tokenId,
    payload: params.payload,
    deadline,
  });
  const signature = await walletClient.signTypedData({
    account,
    ...typedData,
  });

  const res = await fetch(`${ORACLE_URL}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      agentId: params.tokenId.toString(),
      payload: params.payload,
      signature,
      deadline,
      registryAddress: AGENT_REGISTRY_ADDRESS,
    }),
  });
  const body = (await res.json()) as {
    error?: string;
    agentId?: string;
    result?: Record<string, unknown>;
    timestamp?: number;
    proof?: {
      type: "dstack-tdx";
      quote: string;
      event_log: string;
      vm_config: string;
    };
  };
  if (!res.ok || body.error) {
    throw new Error(body.error ?? `Oracle /run failed: ${res.status}`);
  }
  if (body.agentId !== params.tokenId.toString()) {
    throw new Error(`Oracle /run returned wrong agentId: ${body.agentId}`);
  }
  if (!body.result || !body.timestamp || !body.proof) {
    throw new Error(`Oracle /run response is incomplete.`);
  }
  return {
    result: body.result,
    timestamp: body.timestamp,
    proof: body.proof,
  };
}

/**
 * Build the SDK transfer offer/acceptance pair.
 *
 * This mirrors the dashboard/library flow:
 *   1. Sender signs ReencryptRequest for the current oracle.
 *   2. SDK calls /reencrypt and creates a JSON-safe offer.
 *   3. Recipient signs one access proof per encrypted data entry.
 */
async function buildAcceptedTransferOffer(params: {
  oracleAddress: `0x${string}`;
  recipientPublicKey: `0x${string}`;
  tokenId: bigint;
  from: `0x${string}`;
  to: `0x${string}`;
  deadline: bigint;
}) {
  const { oracleAddress, recipientPublicKey, tokenId, from, to, deadline } =
    params;

  // Sign the EIP-712 ReencryptRequest so the oracle can verify the caller is
  // the token owner (signer must match `from`).
  const typedData = buildReencryptTypedData({
    oracleAddress,
    chainId: CHAIN_ID,
    tokenId,
    from,
    to,
    deadline,
  });
  const oracleSignature = await walletClient.signTypedData({
    account,
    ...typedData,
  });

  const offer = await createTransferOffer(
    {
      chain,
      rpcUrl: RPC_URL,
      registryAddress: AGENT_REGISTRY_ADDRESS,
    },
    {
      tokenId: tokenId.toString(),
      to,
      oracleUrl: ORACLE_URL,
      recipientPublicKey,
      oracleSignature,
      oracleDeadline: deadline.toString(),
    },
  );
  if (offer.from.toLowerCase() !== from.toLowerCase()) {
    throw new Error(`Transfer offer from mismatch: ${offer.from} != ${from}`);
  }
  if (offer.to.toLowerCase() !== to.toLowerCase()) {
    throw new Error(`Transfer offer to mismatch: ${offer.to} != ${to}`);
  }
  console.log(
    `  SDK offer built — accessPayloads=${offer.accessPayloads.length}, ownershipProofs=${offer.ownershipProofs.length}`,
  );

  const signatureRequests = getTransferAccessPayloadsToSign(offer);
  const accessSignatures = await Promise.all(
    signatureRequests.map(async ({ index, digest }) => ({
      index,
      proof: await recipientWalletClient.signMessage({
        account: recipientAccount,
        message: digest,
      }),
    })),
  );
  const acceptance = buildTransferAcceptance(offer, accessSignatures);
  console.log(`  SDK acceptance signed — proofs=${acceptance.proofs.length}`);
  return acceptance;
}

async function approveLinkedIdentityForTransfer(
  tokenId: bigint,
): Promise<bigint> {
  const erc8004AgentId = await agentRegistry.getERC8004AgentId(tokenId);
  if (
    identityRegistryAddress === "0x0000000000000000000000000000000000000000" ||
    erc8004AgentId === 0n
  ) {
    return 0n;
  }

  const identityOwner = await identityRegistry.ownerOf(erc8004AgentId);
  if (identityOwner.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error(
      `Linked ERC-8004 owner mismatch before transfer: ${identityOwner}`,
    );
  }

  const approvalHash = await walletClient.writeContract({
    address: identityRegistryAddress,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: "approve",
    args: [AGENT_REGISTRY_ADDRESS, erc8004AgentId],
    account,
    chain,
  });
  await waitForReceipt(approvalHash, "approve linked ERC-8004 identity");
  console.log(`  ✔ approved linked ERC-8004 agent #${erc8004AgentId}`);
  return erc8004AgentId;
}

async function assertLinkedIdentityOwner(
  erc8004AgentId: bigint,
  expectedOwner: `0x${string}`,
) {
  if (erc8004AgentId === 0n) return;
  const identityOwner = await identityRegistry.ownerOf(erc8004AgentId);
  if (identityOwner.toLowerCase() !== expectedOwner.toLowerCase()) {
    throw new Error(
      `Linked ERC-8004 owner mismatch: expected ${expectedOwner}, got ${identityOwner}`,
    );
  }
  console.log(`  ✔ linked ERC-8004 owner moved to recipient`);
}

const MAX_LOG_BLOCK_RANGE = 1_900n;

type PublishedSealedKeyLog = {
  args?: {
    sealedKeys?: readonly Hex[];
  };
};

async function getPublishedSealedKeys(params: {
  registryAddress: Address;
  tokenId: bigint;
  to: Address;
  fromBlock: bigint;
  toBlock: bigint | "latest";
}): Promise<Hex[]> {
  const finalBlock =
    params.toBlock === "latest"
      ? await publicClient.getBlockNumber()
      : params.toBlock;
  let latestSealedKeys: readonly Hex[] | undefined;
  for (
    let fromBlock = params.fromBlock;
    fromBlock <= finalBlock;
    fromBlock += MAX_LOG_BLOCK_RANGE + 1n
  ) {
    const toBlock =
      fromBlock + MAX_LOG_BLOCK_RANGE > finalBlock
        ? finalBlock
        : fromBlock + MAX_LOG_BLOCK_RANGE;
    const chunkLogs = await publicClient.getContractEvents({
      address: params.registryAddress,
      abi: AGENT_REGISTRY_ABI,
      eventName: "PublishedSealedKey",
      args: {
        to: params.to,
        tokenId: params.tokenId,
      },
      fromBlock,
      toBlock,
    });
    for (const log of chunkLogs as readonly PublishedSealedKeyLog[]) {
      const sealedKeys = log.args?.sealedKeys;
      if (sealedKeys?.length) latestSealedKeys = sealedKeys;
    }
  }
  if (!latestSealedKeys) {
    throw new Error(
      `No PublishedSealedKey event found for token ${params.tokenId.toString()} and recipient ${params.to}.`,
    );
  }
  return [...latestSealedKeys];
}

async function assertTransferSealedKeys(params: {
  tokenId: bigint;
  to: `0x${string}`;
  expectedCount: number;
  blobs: Array<{ uri: string; expected: unknown }>;
  recipientPrivKey: `0x${string}`;
  fromBlock?: bigint;
}) {
  const sealedKeys = await getPublishedSealedKeys({
    registryAddress: AGENT_REGISTRY_ADDRESS,
    tokenId: params.tokenId,
    to: params.to,
    fromBlock: params.fromBlock ?? sealedKeyFromBlock,
    toBlock: "latest",
  });
  if (sealedKeys.length !== params.expectedCount) {
    throw new Error(
      `PublishedSealedKey count mismatch: expected ${params.expectedCount}, got ${sealedKeys.length}`,
    );
  }
  const recipientPrivKeyBytes = Buffer.from(
    params.recipientPrivKey.slice(2),
    "hex",
  );
  for (let i = 0; i < params.blobs.length; i++) {
    const blobData = params.blobs[i];
    const sealedKey = sealedKeys[i];
    if (!blobData || !sealedKey) {
      throw new Error(`Missing transferred blob/sealed key at index ${i}`);
    }
    const blob = await readEncryptedBlob(blobData.uri);
    const contentKey = decryptContentKey(
      { encryptedKey: sealedKey },
      recipientPrivKeyBytes,
    );
    const decrypted = decryptMetadata<unknown>(blob, contentKey);
    if (JSON.stringify(decrypted) !== JSON.stringify(blobData.expected)) {
      throw new Error(
        `Transferred blob ${i} decrypt mismatch: ${JSON.stringify(decrypted)}`,
      );
    }
  }
  console.log(`  ✔ PublishedSealedKey decrypts ${sealedKeys.length} blob(s)`);
}

async function assertOwnershipProofSealedKeys(params: {
  ownershipProofs: Array<{ sealedKey: `0x${string}` }>;
  blobs: Array<{ uri: string; expected: unknown }>;
  recipientPrivKey: `0x${string}`;
}) {
  if (params.ownershipProofs.length !== params.blobs.length) {
    throw new Error(
      `Ownership proof count mismatch: expected ${params.blobs.length}, got ${params.ownershipProofs.length}`,
    );
  }
  const recipientPrivKeyBytes = Buffer.from(
    params.recipientPrivKey.slice(2),
    "hex",
  );
  for (let i = 0; i < params.blobs.length; i++) {
    const proof = params.ownershipProofs[i];
    const blobData = params.blobs[i];
    if (!proof || !blobData) {
      throw new Error(`Missing ownership proof/blob at index ${i}`);
    }
    const blob = await readEncryptedBlob(blobData.uri);
    const contentKey = decryptContentKey(
      { encryptedKey: proof.sealedKey },
      recipientPrivKeyBytes,
    );
    const decrypted = decryptMetadata<unknown>(blob, contentKey);
    if (JSON.stringify(decrypted) !== JSON.stringify(blobData.expected)) {
      throw new Error(
        `Ownership proof sealed key ${i} decrypt mismatch: ${JSON.stringify(decrypted)}`,
      );
    }
  }
  console.log(
    `  ✔ oracle ownership proofs decrypt ${params.ownershipProofs.length} blob(s)`,
  );
}

async function assertOracleRegistered(oracleAddress: `0x${string}`) {
  const registered =
    await teeVerifierRegistry.isOracleRegistered(oracleAddress);
  if (!registered) {
    throw new Error(
      `Oracle ${oracleAddress} is not registered in TeeVerifier ${teeVerifierAddress}`,
    );
  }
  console.log(`  ✔ oracle registered in TeeVerifier`);
}

// ── Test 1: Simple mint + transferFrom ────────────────────────────────────────

async function testSimpleTransfer() {
  console.log(
    "\n── Test 1: Simple mint + transferFrom ───────────────────────────",
  );
  const tokenId = await mintAgentToken(
    [
      account.address,
      jsonDataUri({
        name: "E2E Simple Transfer Agent",
        description: "Minimal ERC-721 transfer smoke test agent.",
      }),
      "",
      [],
    ],
    "mint simple agent",
  );
  console.log(`  ✔ minted — tokenId: ${tokenId}`);

  const transferHash = await walletClient.writeContract({
    address: AGENT_REGISTRY_ADDRESS,
    abi: AGENT_REGISTRY_ABI,
    functionName: "transferFrom",
    args: [account.address, recipient, tokenId],
    account,
    chain,
  });
  await waitForReceipt(transferHash, "transferFrom simple agent");

  const ownerAfter = await agentRegistry.ownerOf(tokenId);
  if (ownerAfter.toLowerCase() !== recipient.toLowerCase())
    throw new Error(`Test 1 FAILED: expected ${recipient}, got ${ownerAfter}`);
  console.log(`  ✔ PASSED`);
}

// ── Test 2: SDK two-party transfer + ownership proofs ─────────────────────────

async function testIntelligentTransfer() {
  console.log(
    "\n── Test 2: SDK two-party ERC-7857 transfer ──────────────────────",
  );

  // Get oracle address + public key from the running oracle server
  const oracle = await getOracleInfo();
  console.log(`  Oracle: ${oracle.address}`);
  await assertOracleRegistered(oracle.address);

  const instructions =
    "You are a market-resolution agent. Return a JSON verdict with evidence.";
  const runtimeConfig = {
    model: "google/gemma-4-31b-it",
    temperature: 0,
    top_p: 1,
    outputSchema: {
      verdict: "YES | NO | UNKNOWN",
      confidence: "number",
      evidence: "string[]",
    },
  };

  const { tokenId, prepared } = await mintPreparedAgent({
    name: "E2E Prediction Market Agent",
    description:
      "E2E agent with real teeOracle service, IPFS metadata, and 0G private data.",
    ownerAddress: account.address,
    services: [
      {
        name: "MCP",
        endpoint: "https://example.com/mcp",
        version: "2026-06",
        skills: ["prediction_market_resolution"],
      },
    ],
    oasfSkills: ["text_generation", "question_answering"],
    oasfDomains: ["finance", "web3"],
    privateEntries: [
      {
        name: "instructions",
        data: instructions,
      },
      {
        name: "runtime-config",
        data: JSON.stringify(runtimeConfig),
      },
    ],
  });
  console.log(`  ✔ minted — tokenId: ${tokenId}`);
  await assertPreparedAgentMetadata({
    tokenId,
    prepared,
    expectedName: "E2E Prediction Market Agent",
    expectedPrivateEntryCount: 2,
  });
  const erc8004ServicesAgentId = await agentRegistry.getERC8004AgentId(tokenId);
  if (erc8004ServicesAgentId === 0n) {
    throw new Error(
      `Test 2 FAILED: erc8004AgentId is 0 — identity co-registration failed`,
    );
  }
  const services = await fetchAgentServices(sdkConfig, {
    tokenId: erc8004ServicesAgentId.toString(),
    expectedOwner: account.address,
  });
  if (services.teeOracleUrl !== NORMALIZED_ORACLE_URL) {
    throw new Error(`SDK service fetch returned wrong teeOracle URL.`);
  }
  if (services.metadataStorage !== "ipfs") {
    throw new Error(`Expected IPFS metadata, got ${services.metadataStorage}`);
  }
  console.log(
    `  ✔ SDK metadata/services verified — services=${services.services.length}`,
  );

  const intelligentDatas = await agentRegistry.intelligentDatasOf(tokenId);
  const currentHashes = intelligentDatas.map((d) => d.dataHash);
  console.log(`  On-chain data hashes: ${currentHashes.length}`);

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const recipientSigningKey = new ethers.SigningKey(recipientPrivKey);
  const acceptance = await buildAcceptedTransferOffer({
    oracleAddress: oracle.address,
    recipientPublicKey:
      recipientSigningKey.compressedPublicKey as `0x${string}`,
    tokenId,
    from: account.address,
    to: recipient,
    deadline,
  });
  await assertOwnershipProofSealedKeys({
    ownershipProofs: acceptance.offer.ownershipProofs,
    blobs: [
      { uri: intelligentDatas[0]!.dataDescription, expected: instructions },
      { uri: intelligentDatas[1]!.dataDescription, expected: runtimeConfig },
    ],
    recipientPrivKey,
  });
  const transferTxArgs = buildTransferTxArgs(acceptance);
  const proofs = transferTxArgs.args[3];

  const erc8004AgentId = await approveLinkedIdentityForTransfer(tokenId);
  const transferLabel =
    erc8004AgentId === 0n ? "iTransferFrom" : "iTransferFromWithIdentity";
  const transferHash =
    erc8004AgentId === 0n
      ? await walletClient.writeContract({
          address: AGENT_REGISTRY_ADDRESS,
          abi: AGENT_REGISTRY_ABI,
          functionName: "iTransferFrom",
          args: [account.address, recipient, tokenId, proofs],
          account,
          chain,
        })
      : await walletClient.writeContract({
          address: AGENT_REGISTRY_ADDRESS,
          abi: AGENT_REGISTRY_ABI,
          functionName: "iTransferFromWithIdentity",
          args: transferTxArgs.args,
          account,
          chain,
        });
  const transferReceipt = await waitForReceipt(transferHash, transferLabel);
  console.log(`  ✔ ${transferLabel} tx: ${transferHash}`);

  const ownerAfter = await agentRegistry.ownerOf(tokenId);
  if (ownerAfter.toLowerCase() !== recipient.toLowerCase())
    throw new Error(`Test 2 FAILED: expected ${recipient}, got ${ownerAfter}`);
  await assertLinkedIdentityOwner(erc8004AgentId, recipient);
  await assertTransferSealedKeys({
    tokenId,
    to: recipient,
    expectedCount: intelligentDatas.length,
    blobs: [
      { uri: intelligentDatas[0]!.dataDescription, expected: instructions },
      { uri: intelligentDatas[1]!.dataDescription, expected: runtimeConfig },
    ],
    recipientPrivKey,
    fromBlock: transferReceipt.blockNumber,
  });
  console.log(`  ✔ PASSED`);
}

// ── Test 3: Encrypt/decrypt private-entry pattern ────────────────────────────

async function testEncryptDecryptPrivateEntries() {
  console.log(
    "\n── Test 3: Encrypt/decrypt private entries ──────────────────────",
  );

  const instructions =
    "Resolve claims with cited evidence and return a structured verdict.";
  const runtimeConfig = {
    model: "google/gemma-4-31b-it",
    temperature: 0,
    allowedDomains: ["example.com"],
  };

  // ECIES key pair: use the sender's secp256k1 key
  const signingKey = new ethers.SigningKey(PRIVATE_KEY);
  const pubKeyHex = signingKey.compressedPublicKey; // "0x02..."
  const privKeyBytes = Buffer.from(PRIVATE_KEY.slice(2), "hex");

  const contentKey = generateContentKey();
  const instructionsBlob = encryptMetadata(
    "instructions",
    instructions,
    contentKey,
    pubKeyHex,
  );
  const configBlob = encryptMetadata(
    "runtime-config",
    runtimeConfig,
    contentKey,
    pubKeyHex,
  );
  console.log(
    `  ✔ encrypted — instructions: ${instructionsBlob.ciphertext.length / 2}B, config: ${configBlob.ciphertext.length / 2}B`,
  );

  // Decrypt both with the same content key
  const recoveredKey = decryptContentKey(instructionsBlob, privKeyBytes);
  const decryptedInstructions = decryptMetadata<string>(
    instructionsBlob,
    recoveredKey,
  );
  const decryptedConfig = decryptMetadata<typeof runtimeConfig>(
    configBlob,
    recoveredKey,
  );

  if (decryptedInstructions !== instructions) {
    throw new Error(
      `Test 3 FAILED: instructions mismatch — got ${JSON.stringify(decryptedInstructions)}`,
    );
  }
  if (
    decryptedConfig.model !== runtimeConfig.model ||
    decryptedConfig.temperature !== runtimeConfig.temperature ||
    decryptedConfig.allowedDomains.length !==
      runtimeConfig.allowedDomains.length
  ) {
    throw new Error(
      `Test 3 FAILED: config mismatch — got ${JSON.stringify(decryptedConfig)}`,
    );
  }
  console.log(
    `  ✔ decrypted — instructions: ${decryptedInstructions.length} chars, model: ${decryptedConfig.model}`,
  );
  console.log(`  ✔ PASSED`);
}

// ── Test 4: ValidationRegistry — request + EOA response + status ───────────────

async function testValidationRegistry() {
  console.log(
    "\n── Test 4: ValidationRegistry run outcome ───────────────────────",
  );
  console.log(`  ValidationRegistry: ${VALIDATION_REGISTRY_ADDRESS}`);

  const { tokenId, prepared } = await mintPreparedAgent({
    name: "E2E Validation Agent",
    description: "E2E agent used for run-shaped validation requests.",
    ownerAddress: account.address,
    privateEntries: [
      {
        name: "instructions",
        data: "You verify prediction-market claims. Return JSON only. The verdict field MUST be exactly one of YES, NO, or INVALID. Use NO for false claims, YES for true claims, and INVALID only when the claim cannot be evaluated. Include confidence and reasoning.",
      },
      {
        name: "runtime-config",
        data: JSON.stringify({
          model: "google/gemma-4-31b-it",
          temperature: 0,
          top_p: 1,
        }),
      },
    ],
    oasfSkills: ["classification", "question_answering"],
    oasfDomains: ["prediction_markets"],
  });
  console.log(`  ✔ minted — tokenId: ${tokenId}`);
  await assertPreparedAgentMetadata({
    tokenId,
    prepared,
    expectedName: "E2E Validation Agent",
    expectedPrivateEntryCount: 2,
  });

  const erc8004AgentId = await agentRegistry.getERC8004AgentId(tokenId);
  const validationAgentId = erc8004AgentId === 0n ? tokenId : erc8004AgentId;
  const oracle = await getOracleInfo();
  const runPayload = {
    claim: "Was Ethereum above $2,000 on January 1, 2023?",
    evidence: "ETH traded below $2,000 on January 1, 2023.",
  };
  const run = await runOracleAgent({
    oracleAddress: oracle.address,
    tokenId,
    payload: runPayload,
  });
  console.log(`  ✔ oracle run completed — timestamp: ${run.timestamp}`);

  const runMeta = {
    payload: runPayload,
    outcome: run.result,
    proof: run.proof,
    timestamp: run.timestamp,
    agentId: validationAgentId.toString(),
  };
  const requestURI = `data:application/json;base64,${Buffer.from(
    JSON.stringify(runMeta),
  ).toString("base64")}`;
  const preparedValidation = prepareValidation(sdkConfig, {
    agentId: validationAgentId.toString(),
    validatorAddress: account.address,
    requestURI,
  });
  if (preparedValidation.requestHash !== keccak256(toBytes(requestURI))) {
    throw new Error("Validation request hash is not derived from requestURI.");
  }

  const reqTx = await walletClient.writeContract({
    address: preparedValidation.contractAddress,
    abi: VALIDATION_REGISTRY_ABI,
    functionName: "validationRequest",
    args: [
      preparedValidation.validatorAddress,
      BigInt(preparedValidation.agentId),
      preparedValidation.requestURI,
      preparedValidation.requestHash,
    ],
    account,
    chain,
  });
  await waitForReceipt(reqTx, "validationRequest");
  console.log(
    `  ✔ validation requested — hash: ${preparedValidation.requestHash.slice(0, 10)}...`,
  );

  const evidence = {
    score: 92,
    reasoning:
      "The run outcome matches the historical ETH price for the requested date.",
    evaluatedAt: new Date().toISOString(),
  };
  const responseJson = JSON.stringify(evidence);
  const responseURI = `data:application/json;base64,${Buffer.from(
    responseJson,
  ).toString("base64")}`;
  const responseHash = keccak256(toBytes(responseJson));

  const respTx = await walletClient.writeContract({
    address: VALIDATION_REGISTRY_ADDRESS,
    abi: VALIDATION_REGISTRY_ABI,
    functionName: "validationResponse",
    args: [
      preparedValidation.requestHash,
      92, // response score 0-100
      responseURI,
      responseHash,
      "run-outcome",
      "0x" as `0x${string}`, // proof (empty for EOA validator)
    ],
    account,
    chain,
  });
  await waitForReceipt(respTx, "validationResponse");
  console.log(
    `  ✔ validation response submitted — score: 92/100, tag: "run-outcome"`,
  );

  // Verify status
  const validationStatus = await validationRegistry.getValidationStatus(
    preparedValidation.requestHash,
  );
  const {
    validatorAddress: validatorAddr,
    agentId: storedAgentId,
    response: score,
    responseHash: storedResponseHash,
    tag,
  } = validationStatus;

  if (validatorAddr.toLowerCase() !== account.address.toLowerCase())
    throw new Error(
      `Test 4 FAILED: wrong validator, expected ${account.address} got ${validatorAddr}`,
    );
  if (storedAgentId !== validationAgentId) {
    throw new Error(
      `Test 4 FAILED: wrong validation agent id, expected ${validationAgentId} got ${storedAgentId}`,
    );
  }
  if (score !== 92)
    throw new Error(`Test 4 FAILED: expected score 92, got ${score}`);
  if (storedResponseHash !== responseHash || tag !== "run-outcome") {
    throw new Error(
      `Test 4 FAILED: response metadata mismatch hash=${storedResponseHash} tag=${tag}`,
    );
  }
  console.log(
    `  ✔ status confirmed — validator: ${validatorAddr.slice(0, 10)}..., score: ${score}/100`,
  );

  const requestHashes =
    await validationRegistry.getAgentValidations(validationAgentId);
  if (!requestHashes.includes(preparedValidation.requestHash)) {
    throw new Error("Test 4 FAILED: validation request not indexed by agent.");
  }

  // Check getSummary
  const { count, averageResponse: avgScore } =
    await validationRegistry.getSummary(validationAgentId, [], "");

  if (count !== 1n || avgScore !== 92)
    throw new Error(`Test 4 FAILED: summary count=${count} avg=${avgScore}`);
  console.log(`  ✔ summary — count: ${count}, avg score: ${avgScore}/100`);
  console.log(`  ✔ PASSED`);
}

// ── Test 5: ERC-8004 identity co-registration + reputation feedback ───────────

async function testReputationFeedback() {
  console.log(
    "\n── Test 5: ERC-8004 identity + reputation ───────────────────────",
  );

  if (!REPUTATION_REGISTRY_ADDRESS) {
    console.log(
      `  ⚠ SKIPPED — ERC-8004 singletons not present on chain ${CHAIN_ID}`,
    );
    console.log(`    (Run on arbitrumSepolia or Base mainnet to test)`);
    return;
  }
  console.log(`  IdentityRegistry:   ${identityRegistryAddress}`);
  console.log(`  ReputationRegistry: ${REPUTATION_REGISTRY_ADDRESS}`);

  const { tokenId, prepared } = await mintPreparedAgent({
    name: "E2E Reputation Agent",
    description: "E2E agent used for ERC-8004 reputation feedback.",
    ownerAddress: recipient,
    privateEntries: [
      {
        name: "instructions",
        data: "Answer with short, factual responses.",
      },
    ],
    oasfSkills: ["question_answering"],
    oasfDomains: ["customer_support"],
  });
  console.log(`  ✔ minted — tokenId: ${tokenId}`);
  await assertPreparedAgentMetadata({
    tokenId,
    prepared,
    expectedName: "E2E Reputation Agent",
    expectedPrivateEntryCount: 1,
  });

  // Read the ERC-8004 agentId that was assigned during mint
  const erc8004AgentId = await agentRegistry.getERC8004AgentId(tokenId);
  if (erc8004AgentId === 0n)
    throw new Error(
      `Test 5 FAILED: erc8004AgentId is 0 — identity co-registration failed`,
    );
  console.log(`  ✔ ERC-8004 agentId: ${erc8004AgentId}`);

  const preparedFeedback = await prepareFeedback(sdkConfig, {
    agentId: erc8004AgentId.toString(),
    value: 0.9,
    tag1: "helpful",
    tag2: "question-answering",
    feedbackJson: JSON.stringify({
      summary: "Accurate answer with usable evidence.",
      validation: {
        score: 92,
        requestHash: "e2e",
      },
    }),
  });

  const feedbackTx = await walletClient.writeContract({
    address: preparedFeedback.contractAddress,
    abi: REPUTATION_REGISTRY_ABI,
    functionName: "giveFeedback",
    args: [
      erc8004AgentId,
      BigInt(preparedFeedback.value),
      preparedFeedback.valueDecimals,
      preparedFeedback.tag1,
      preparedFeedback.tag2,
      "", // endpoint
      preparedFeedback.feedbackURI,
      ("0x" + "00".repeat(32)) as `0x${string}`, // feedbackHash
    ],
    account,
    chain,
  });
  await waitForReceipt(feedbackTx, "giveFeedback");
  console.log(
    `  ✔ feedback submitted — value: ${preparedFeedback.value}, tags: ${preparedFeedback.tag1}/${preparedFeedback.tag2}`,
  );

  // Read back the feedback entry
  const lastIndex = await reputationRegistry!.getLastIndex(
    erc8004AgentId,
    account.address,
  );

  const { value, tag1, tag2, isRevoked } =
    await reputationRegistry!.readFeedback(
      erc8004AgentId,
      account.address,
      lastIndex,
    );

  if (value !== BigInt(preparedFeedback.value) || isRevoked)
    throw new Error(`Test 5 FAILED: value=${value} isRevoked=${isRevoked}`);
  console.log(
    `  ✔ feedback read — value: ${value}, tag1: "${tag1}", tag2: "${tag2}"`,
  );

  // Aggregate summary
  const { count, summaryValue } = await reputationRegistry!.getSummary(
    erc8004AgentId,
    [account.address],
    "",
    "",
  );

  if (count < 1n)
    throw new Error(
      `Test 5 FAILED: expected at least 1 feedback, got ${count}`,
    );
  console.log(
    `  ✔ summary — feedback count: ${count}, total value: ${summaryValue}`,
  );
  console.log(`  ✔ PASSED`);
}

// ── Test 6: updateServices — ERC-8004 setAgentURI ────────────────────────────

async function testUpdateServices() {
  console.log(
    "\n── Test 6: updateServices (ERC-8004 setAgentURI) ───────────────",
  );

  if (
    !REPUTATION_REGISTRY_ADDRESS ||
    identityRegistryAddress === "0x0000000000000000000000000000000000000000"
  ) {
    console.log(
      `  ⚠ SKIPPED — ERC-8004 singletons not present on chain ${CHAIN_ID}`,
    );
    return;
  }
  console.log(`  IdentityRegistry: ${identityRegistryAddress}`);

  const { tokenId, prepared } = await mintPreparedAgent({
    name: "E2E Services Agent",
    description: "E2E agent used for ERC-8004 service updates.",
    ownerAddress: account.address,
    privateEntries: [
      {
        name: "instructions",
        data: "Expose services for MCP and OASF discovery.",
      },
    ],
    oasfSkills: ["tool_use"],
    oasfDomains: ["developer_tools"],
  });
  console.log(`  ✔ minted — tokenId: ${tokenId}`);
  await assertPreparedAgentMetadata({
    tokenId,
    prepared,
    expectedName: "E2E Services Agent",
    expectedPrivateEntryCount: 1,
  });

  // Read the ERC-8004 agentId
  const erc8004AgentId = await agentRegistry.getERC8004AgentId(tokenId);
  if (erc8004AgentId === 0n)
    throw new Error(
      `Test 6 FAILED: erc8004AgentId is 0 — identity co-registration failed`,
    );
  console.log(`  ✔ ERC-8004 agentId: ${erc8004AgentId}`);

  const services = [
    {
      name: "teeOracle",
      endpoint: NORMALIZED_ORACLE_URL,
      version: "1.0",
    },
    {
      name: "MCP",
      endpoint: "https://example.com/mcp",
      version: "2026-06",
      skills: ["tool_use"],
    },
    {
      name: "OASF",
      endpoint: "https://example.com/oasf-profile.json",
      version: "0.8",
      skills: ["tool_use"],
      domains: ["developer_tools"],
    },
  ];
  const update = await prepareUpdateServices(sdkConfig, {
    tokenId: tokenId.toString(),
    servicesJson: services,
  });
  if (!update.tokenUri.startsWith("ipfs://")) {
    throw new Error(`Service update should use IPFS, got ${update.tokenUri}`);
  }

  const updateTx = await walletClient.writeContract({
    address: identityRegistryAddress,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: "setAgentURI",
    args: [erc8004AgentId, update.tokenUri],
    account,
    chain,
  });
  await waitForReceipt(updateTx, "setAgentURI");
  console.log(`  ✔ services updated — URI: ${update.tokenUri}`);

  // Verify the URI was set
  const storedUri = await identityRegistry.tokenURI(erc8004AgentId);
  if (storedUri !== update.tokenUri)
    throw new Error(`Test 6 FAILED: tokenURI mismatch`);

  const storedMetadata = await readJsonFromUri<{
    services?: Array<{ name?: string; endpoint?: string }>;
    registrations?: Array<{ agentId?: number; agentRegistry?: string }>;
  }>(storedUri);
  const storedTeeOracle = storedMetadata.services?.find(
    (service) => service.name === "teeOracle",
  );
  if (storedTeeOracle?.endpoint !== NORMALIZED_ORACLE_URL) {
    throw new Error(
      `Test 6 FAILED: teeOracle endpoint mismatch: ${storedTeeOracle?.endpoint}`,
    );
  }
  const storedMcp = storedMetadata.services?.find(
    (service) => service.name === "MCP",
  );
  if (storedMcp?.endpoint !== "https://example.com/mcp") {
    throw new Error(`Test 6 FAILED: MCP service missing from metadata`);
  }
  console.log(`  ✔ tokenURI verified with teeOracle service`);
  console.log(`  ✔ PASSED`);
}

// ── Oracle health-check ──────────────────────────────────────────────────────

let localOracleProcess: ChildProcess | null = null;
let stoppingLocalOracle = false;
let localOracleSpawnError = "";

async function assertOracleRunning(): Promise<void> {
  try {
    const res = await fetch(`${NORMALIZED_ORACLE_URL}/address`, {
      signal: AbortSignal.timeout(2_000),
    });
    if (res.ok) return;
  } catch {
    // not running
  }
  throw new Error(
    `Oracle is not reachable at ${NORMALIZED_ORACLE_URL}.\n` +
      `Check the local oracle startup logs above.`,
  );
}

async function waitForOracleRunning(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";

  while (Date.now() < deadline) {
    if (localOracleSpawnError) {
      throw new Error(localOracleSpawnError);
    }
    if (localOracleProcess?.exitCode !== null) {
      throw new Error(`Local oracle exited before it became ready.`);
    }

    try {
      await assertOracleRunning();
      return;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      await delay(500);
    }
  }

  throw new Error(`Local oracle did not become ready.\n${lastError}`);
}

async function startLocalOracle(): Promise<void> {
  runRequiredCommand(
    "oracle dev services",
    "npm",
    ["--workspace", "@tee-agent/oracle", "run", "dev:up"],
    {},
    "Make sure Docker is running, then retry npm run e2e:local.",
  );

  const oracleUrl = new URL(NORMALIZED_ORACLE_URL);
  const port = oracleUrl.port || "3001";
  const oracleEnv = {
    ...process.env,
    NETWORK: isLocal ? "local" : "arbitrumSepolia",
    LOCAL_RPC_URL: RPC_URL,
    RPC_URL_ARBITRUM_SEPOLIA: RPC_URL,
    PORT: port,
    DSTACK_SIMULATOR_ENDPOINT: "http://localhost:8090",
    DSTACK_VERIFIER_URL:
      process.env.DSTACK_VERIFIER_URL?.trim() || "http://localhost:8080",
  };

  localOracleProcess = spawn(
    "node",
    ["--import", "tsx", "src/examples/prediction-market.ts"],
    {
      cwd: resolve(repoRoot, "apps/oracle"),
      env: oracleEnv,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  localOracleProcess.stdout?.on("data", (chunk: Buffer) => {
    process.stdout.write(chunk);
  });
  localOracleProcess.stderr?.on("data", (chunk: Buffer) => {
    process.stderr.write(chunk);
  });
  localOracleProcess.on("exit", (code, signal) => {
    if (!stoppingLocalOracle) {
      console.error(
        `Local oracle exited unexpectedly: code=${code ?? "null"} signal=${signal ?? "null"}`,
      );
    }
  });
  localOracleProcess.on("error", (err) => {
    localOracleSpawnError = `Local oracle failed to start: ${err.message}`;
  });

  await waitForOracleRunning(60_000);
}

async function stopLocalOracle(): Promise<void> {
  stoppingLocalOracle = true;
  const child = localOracleProcess;
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await Promise.race([
      new Promise<void>((resolveStop) =>
        child.once("exit", () => resolveStop()),
      ),
      delay(5_000).then(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
      }),
    ]);
  }

  try {
    runRequiredCommand(
      "oracle dev services shutdown",
      "npm",
      ["--workspace", "@tee-agent/oracle", "run", "dev:down"],
      {},
      "Stop Docker dev services manually with: npm --workspace @tee-agent/oracle run dev:down",
    );
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
  }
}

// ── Run ───────────────────────────────────────────────────────────────────────

try {
  await startLocalOracle();
  await assertOracleRunning();
  await testSimpleTransfer();
  await testIntelligentTransfer();
  await testEncryptDecryptPrivateEntries();
  await testValidationRegistry();
  await testReputationFeedback();
  await testUpdateServices();
  console.log("\n✔ All tests passed");
} finally {
  await stopLocalOracle();
}
