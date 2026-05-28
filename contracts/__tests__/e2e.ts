/**
 * E2E script: mint an agent and transfer it, always including the ERC-7857
 * secure transfer path (oracle test is never skipped).
 *
 * Usage:
 *   npm run e2e:local          # against local Hardhat node (chain 31337)
 *   npm run e2e:baseSepolia    # against Base Sepolia (chain 84532)
 *
 * Environment variables:
 *   PRIVATE_KEY          — sender key (defaults to Hardhat account #0 locally)
 *   LOCAL_RPC_URL        — local RPC override (default: http://127.0.0.1:8545)
 *   BASE_SEPOLIA_RPC_URL — testnet RPC override (default: https://sepolia.base.org)
 */
import "dotenv/config";
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  parseAbi,
  parseEventLogs,
  zeroAddress,
} from "viem";
import { base, baseSepolia, hardhat } from "viem/chains";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { ethers } from "ethers";
import {
  generateContentKey,
  encryptMetadata,
  hashEncryptedBlob,
  decryptContentKey,
  decryptMetadata,
} from "@tee-agent/agent/encryption";
import {
  defaultIdentityRegistry,
  defaultReputationRegistry,
} from "@tee-agent/agent/config";
import { IDENTITY_REGISTRY_ABI } from "@tee-agent/agent/abis";
import {
  AgentRegistry,
  IdentityRegistry,
  ValidationRegistry,
} from "@tee-agent/agent/registry";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Network selection ─────────────────────────────────────────────────────────

const NETWORK = process.argv[2] ?? process.env.NETWORK ?? "local";
const isLocal = NETWORK === "local";

// ── Config ────────────────────────────────────────────────────────────────────

const CHAIN_ID = isLocal ? 31337 : 84532;
const RPC_URL = isLocal
  ? (process.env.LOCAL_RPC_URL ?? "http://127.0.0.1:8545")
  : (process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org");

// Hardhat account #0 / #1 as defaults for local
const HARDHAT_KEY_0 =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const HARDHAT_KEY_1 =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

const PRIVATE_KEY = (
  isLocal ? HARDHAT_KEY_0 : process.env.PRIVATE_KEY
) as `0x${string}`;
if (!PRIVATE_KEY) throw new Error("PRIVATE_KEY not set in .env");

const ORACLE_URL = process.env.ORACLE_URL ?? "http://localhost:3001";

const chain = isLocal
  ? ({ ...hardhat, rpcUrls: { default: { http: [RPC_URL] } } } as const)
  : ({ ...baseSepolia, rpcUrls: { default: { http: [RPC_URL] } } } as const);

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

  // Always redeploy so deployed_addresses.json reflects the current node state.
  console.log("Deploying contracts to local node...");
  execSync("npm run deploy:local", {
    cwd: resolve(__dirname, ".."),
    stdio: "inherit",
  });
}

// ── Load deployed addresses + ABIs ────────────────────────────────────────────

const deployedAddresses = JSON.parse(
  readFileSync(
    resolve(
      __dirname,
      `../ignition/deployments/chain-${CHAIN_ID}/deployed_addresses.json`,
    ),
    "utf8",
  ),
);

const AGENT_REGISTRY_ABI = JSON.parse(
  readFileSync(
    resolve(__dirname, "../artifacts/src/AgentRegistry.sol/AgentRegistry.json"),
    "utf8",
  ),
).abi;

const TEE_VERIFIER_ABI = JSON.parse(
  readFileSync(
    resolve(
      __dirname,
      "../artifacts/src/verifiers/TeeVerifier.sol/TeeVerifier.json",
    ),
    "utf8",
  ),
).abi;

const VALIDATION_REGISTRY_ABI = JSON.parse(
  readFileSync(
    resolve(
      __dirname,
      "../artifacts/src/ValidationRegistry.sol/ValidationRegistry.json",
    ),
    "utf8",
  ),
).abi;

const REPUTATION_REGISTRY_ABI = JSON.parse(
  readFileSync(
    resolve(__dirname, "../../packages/agent/src/abis/ReputationRegistry.json"),
    "utf8",
  ),
);

const AGENT_REGISTRY_ADDRESS = deployedAddresses[
  "TeeAgent#AgentRegistry"
] as `0x${string}`;
const TEE_VERIFIER_ADDRESS = deployedAddresses[
  "TeeAgent#TeeVerifier"
] as `0x${string}`;
const VERIFIER_ADDRESS = deployedAddresses[
  "TeeAgent#Verifier"
] as `0x${string}`;
const VALIDATION_REGISTRY_ADDRESS = deployedAddresses[
  "TeeAgent#ValidationRegistry"
] as `0x${string}`;

/**
 * Official ERC-8004 singletons.
 * Mainnet (Base):          identity 0x8004A169…  reputation 0x8004BAa1…
 * Testnets (Base Sepolia): identity 0x8004A818…  reputation 0x8004B663…
 * Not present on local Hardhat nodes.
 */
const IDENTITY_REGISTRY_ADDRESS = isLocal
  ? ("0x0000000000000000000000000000000000000000" as `0x${string}`)
  : defaultIdentityRegistry(NETWORK === "base" ? base : baseSepolia);

const REPUTATION_REGISTRY_ADDRESS = (process.env.REPUTATION_REGISTRY_ADDRESS ??
  (isLocal
    ? undefined
    : defaultReputationRegistry(NETWORK === "base" ? base : baseSepolia))) as
  | `0x${string}`
  | undefined;

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

console.log(`Network:       ${NETWORK} (chain ${CHAIN_ID})`);
console.log(`AgentRegistry: ${AGENT_REGISTRY_ADDRESS}`);
console.log(`TEEVerifier:   ${TEE_VERIFIER_ADDRESS}`);
console.log(`Sender:        ${account.address}`);
console.log(`Recipient:     ${recipient}`);

// ── Registry clients ──────────────────────────────────────────────────────────

const agentRegistry = new AgentRegistry({
  agentRegistryAddress: AGENT_REGISTRY_ADDRESS,
  publicClient: publicClient as any,
});
const identityRegistry = new IdentityRegistry({
  address: IDENTITY_REGISTRY_ADDRESS,
  publicClient: publicClient as any,
});
const validationRegistry = new ValidationRegistry({
  address: VALIDATION_REGISTRY_ADDRESS,
  publicClient: publicClient as any,
});

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

// ── Oracle helpers ────────────────────────────────────────────────────────────

type OracleOwnershipProof = {
  oracleType: number;
  dataHash: `0x${string}`;
  sealedKey: `0x${string}`;
  targetPubkey: `0x${string}`;
  nonce: `0x${string}`;
  proof: `0x${string}`;
};

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

/**
 * Call the oracle's /reencrypt endpoint and build the full TransferValidityProof[] array.
 * Access proofs are signed locally by the recipient; ownership proofs come from the oracle.
 */
async function buildTransferProofsViaOracle(params: {
  oracleAddress: `0x${string}`;
  tokenId: bigint;
  from: `0x${string}`;
  to: `0x${string}`;
  currentHashes: readonly `0x${string}`[];
  blobUris: string[];
  contentKey: Uint8Array;
  deadline: bigint;
  senderPrivKey: `0x${string}`;
  recipientPrivKey: `0x${string}`;
}) {
  const {
    oracleAddress,
    tokenId,
    from,
    to,
    currentHashes,
    blobUris,
    contentKey,
    deadline,
    senderPrivKey,
    recipientPrivKey: recipPrivKey,
  } = params;

  const recipientSigningKey = new ethers.SigningKey(recipPrivKey);
  const targetPubkey = recipientSigningKey.compressedPublicKey as `0x${string}`;
  const contentKeyB64 = Buffer.from(contentKey).toString("base64");

  // Sign the EIP-712 ReencryptRequest so the oracle can verify the caller is
  // the token owner (signer must match `from`).
  const senderWallet = new ethers.Wallet(senderPrivKey);
  const eip712Domain = {
    name: "TeeAgentOracle",
    version: "1",
    chainId: BigInt(CHAIN_ID),
    verifyingContract: oracleAddress,
  };
  const signature = await senderWallet.signTypedData(
    eip712Domain,
    {
      ReencryptRequest: [
        { name: "tokenId", type: "uint256" },
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "deadline", type: "uint256" },
      ],
    },
    {
      tokenId,
      from,
      to,
      deadline,
    },
  );

  const oracleRes = await fetch(`${ORACLE_URL}/reencrypt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tokenId: tokenId.toString(),
      from,
      to,
      chainId: CHAIN_ID,
      verifierAddress: VERIFIER_ADDRESS,
      registryAddress: AGENT_REGISTRY_ADDRESS,
      deadline: Number(deadline),
      intelligentDataHashes: currentHashes,
      blobUris,
      contentKey: contentKeyB64,
      targetPubkey,
      signature,
    }),
  });
  if (!oracleRes.ok) {
    const text = await oracleRes.text().catch(() => "");
    throw new Error(
      `Oracle re-encryption failed (${oracleRes.status}): ${text}`,
    );
  }
  const { ownershipProofs } = (await oracleRes.json()) as {
    ownershipProofs: OracleOwnershipProof[];
  };
  console.log(`  Oracle returned ${ownershipProofs.length} ownership proof(s)`);

  // Build access proofs — signed by recipient using the same domain as Verifier.sol
  const abiCoder = ethers.AbiCoder.defaultAbiCoder();
  return ownershipProofs.map((ownershipProof, i) => {
    const accessNonce = keccak256(
      `0x${Buffer.from(`access:${tokenId}:${i}:${Date.now()}`).toString("hex")}` as `0x${string}`,
    );
    const accessInnerHash = ethers.keccak256(
      abiCoder.encode(
        [
          "uint256",
          "address",
          "address",
          "uint256",
          "address",
          "address",
          "uint256",
          "bytes32",
          "bytes",
          "bytes32",
        ],
        [
          CHAIN_ID,
          VERIFIER_ADDRESS,
          AGENT_REGISTRY_ADDRESS,
          tokenId,
          from,
          to,
          deadline,
          ownershipProof.dataHash,
          ownershipProof.targetPubkey,
          accessNonce,
        ],
      ),
    );
    const accessMessageHash = ethers.keccak256(
      ethers.concat([
        ethers.toUtf8Bytes("\x19Ethereum Signed Message:\n66"),
        ethers.toUtf8Bytes(accessInnerHash),
      ]),
    );
    const accessSig = ethers.Signature.from(
      recipientSigningKey.sign(accessMessageHash),
    ).serialized as `0x${string}`;

    return {
      accessProof: {
        dataHash: ownershipProof.dataHash,
        targetPubkey: ownershipProof.targetPubkey,
        nonce: accessNonce,
        proof: accessSig,
      },
      ownershipProof,
      from,
      to,
      tokenId,
      deadline,
    };
  });
}

// ── Test 1: Simple mint + transferFrom ────────────────────────────────────────

async function testSimpleTransfer() {
  console.log(
    "\n── Test 1: Simple mint + transferFrom ───────────────────────────",
  );
  const tokenId = await mintAgentToken(
    [account.address, "https://example.com/e2e-agent.json", "", []],
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

// ── Test 2: ERC-7857 mint + iTransferFrom ─────────────────────────────────────

async function testIntelligentTransfer() {
  console.log(
    "\n── Test 2: ERC-7857 mint + iTransferFrom ────────────────────────",
  );

  // Get oracle address + public key from the running oracle server
  const oracle = await getOracleInfo();
  console.log(`  Oracle: ${oracle.address}`);

  // Register oracle in TeeVerifier
  const regHash = await walletClient.writeContract({
    address: TEE_VERIFIER_ADDRESS,
    abi: TEE_VERIFIER_ABI,
    functionName: "updateOracleAddress",
    args: [oracle.address],
    account,
    chain,
  });
  await waitForReceipt(regHash, "updateOracleAddress");
  console.log(`  ✔ oracle registered`);

  // Create two encrypted blobs (AES-256-GCM) using the oracle's public key:
  //   iData[0]: SKILL.md markdown string
  //   iData[1]: agent config (model, temperature, etc. — no API keys)
  const contentKey = generateContentKey();

  const skillBlob = encryptMetadata(
    "skill.md",
    "# Helpful Assistant\nYou are a helpful assistant.",
    contentKey,
    oracle.publicKey,
  );
  const skillHash = await hashEncryptedBlob(skillBlob);
  const skillBlobUri = `data:application/json;base64,${Buffer.from(JSON.stringify(skillBlob)).toString("base64")}`;

  const configBlob = encryptMetadata(
    "config",
    { model: "phala/gemma-4-26b-a4b-uncensored", temperature: 0 },
    contentKey,
    oracle.publicKey,
  );
  const configHash = await hashEncryptedBlob(configBlob);
  const configBlobUri = `data:application/json;base64,${Buffer.from(JSON.stringify(configBlob)).toString("base64")}`;

  const tokenId = await mintAgentToken(
    [
      account.address,
      "https://example.com/e2e-secure-agent.json",
      skillBlobUri,
      [
        { dataDescription: skillBlobUri, dataHash: skillHash },
        { dataDescription: configBlobUri, dataHash: configHash },
      ],
    ],
    "mint secure agent",
  );
  console.log(`  ✔ minted — tokenId: ${tokenId}`);

  const intelligentDatas = await agentRegistry.intelligentDatasOf(tokenId);
  const currentHashes = intelligentDatas.map((d) => d.dataHash);
  console.log(`  On-chain data hashes: ${currentHashes.length}`);

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const proofs = await buildTransferProofsViaOracle({
    oracleAddress: oracle.address,
    tokenId,
    from: account.address,
    to: recipient,
    currentHashes,
    blobUris: [skillBlobUri, configBlobUri],
    contentKey,
    deadline,
    senderPrivKey: PRIVATE_KEY,
    recipientPrivKey: recipientPrivKey as `0x${string}`,
  });

  const transferHash = await walletClient.writeContract({
    address: AGENT_REGISTRY_ADDRESS,
    abi: AGENT_REGISTRY_ABI,
    functionName: "iTransferFrom",
    args: [account.address, recipient, tokenId, proofs],
    account,
    chain,
  });
  await waitForReceipt(transferHash, "iTransferFrom");
  console.log(`  ✔ iTransferFrom tx: ${transferHash}`);

  const ownerAfter = await agentRegistry.ownerOf(tokenId);
  if (ownerAfter.toLowerCase() !== recipient.toLowerCase())
    throw new Error(`Test 2 FAILED: expected ${recipient}, got ${ownerAfter}`);
  console.log(`  ✔ PASSED`);
}

// ── Test 3: Encrypt/decrypt two-blob pattern ─────────────────────────────────

async function testEncryptDecryptSkill() {
  console.log(
    "\n── Test 3: Encrypt/decrypt two-blob pattern ─────────────────────",
  );

  // Two blobs share one content key:
  //   blob[0]: SKILL.md — plain markdown string
  //   blob[1]: config   — JSON object (model, temperature, etc.)
  const skillContent =
    "# Web Search Agent\nYou are a helpful web search assistant.";
  const config = {
    model: "phala/gemma-4-26b-a4b-uncensored",
    temperature: 0,
    allowedDomains: ["example.com"],
  };

  // ECIES key pair: use the sender's secp256k1 key
  const signingKey = new ethers.SigningKey(PRIVATE_KEY);
  const pubKeyHex = signingKey.compressedPublicKey; // "0x02..."
  const privKeyBytes = Buffer.from(PRIVATE_KEY.slice(2), "hex");

  const contentKey = generateContentKey();
  const skillBlob = encryptMetadata(
    "skill.md",
    skillContent,
    contentKey,
    pubKeyHex,
  );
  const configBlob = encryptMetadata("config", config, contentKey, pubKeyHex);
  console.log(
    `  ✔ encrypted — skill: ${skillBlob.ciphertext.length / 2}B, config: ${configBlob.ciphertext.length / 2}B`,
  );

  // Decrypt both with the same content key
  const recoveredKey = decryptContentKey(skillBlob, privKeyBytes);
  const decryptedSkill = decryptMetadata<string>(skillBlob, recoveredKey);
  const decryptedConfig = decryptMetadata<typeof config>(
    configBlob,
    recoveredKey,
  );

  if (decryptedSkill !== skillContent) {
    throw new Error(
      `Test 3 FAILED: skill content mismatch — got ${JSON.stringify(decryptedSkill)}`,
    );
  }
  if (
    decryptedConfig.model !== config.model ||
    decryptedConfig.temperature !== config.temperature ||
    decryptedConfig.allowedDomains.length !== config.allowedDomains.length
  ) {
    throw new Error(
      `Test 3 FAILED: config mismatch — got ${JSON.stringify(decryptedConfig)}`,
    );
  }
  console.log(
    `  ✔ decrypted — skill: ${decryptedSkill.length} chars, model: ${decryptedConfig.model}`,
  );
  console.log(`  ✔ PASSED`);
}

// ── Test 4: ValidationRegistry — request + EOA response + status ───────────────

async function testValidationRegistry() {
  console.log(
    "\n── Test 4: ValidationRegistry skills ────────────────────────────",
  );
  console.log(`  ValidationRegistry: ${VALIDATION_REGISTRY_ADDRESS}`);

  // Mint a fresh agent for this test
  const tokenId = await mintAgentToken(
    [account.address, "https://example.com/validation-test-agent.json", "", []],
    "mint validation agent",
  );
  console.log(`  ✔ minted — tokenId: ${tokenId}`);

  // Submit a validation request; use account.address as the EOA validator
  const requestPayload = JSON.stringify({
    skill: "web-search",
    agentId: tokenId.toString(),
    ts: Date.now(),
  });
  const requestHash = keccak256(
    `0x${Buffer.from(requestPayload).toString("hex")}` as `0x${string}`,
  );

  const reqTx = await walletClient.writeContract({
    address: VALIDATION_REGISTRY_ADDRESS,
    abi: VALIDATION_REGISTRY_ABI,
    functionName: "validationRequest",
    args: [
      account.address, // validator = sender (EOA path)
      tokenId,
      "https://example.com/validation-request.json",
      requestHash,
    ],
    account,
    chain,
  });
  await waitForReceipt(reqTx, "validationRequest");
  console.log(
    `  ✔ validation requested — hash: ${requestHash.slice(0, 10)}...`,
  );

  // Respond as the EOA validator (score 92 out of 100)
  const respTx = await walletClient.writeContract({
    address: VALIDATION_REGISTRY_ADDRESS,
    abi: VALIDATION_REGISTRY_ABI,
    functionName: "validationResponse",
    args: [
      requestHash,
      92, // response score 0-100
      "https://example.com/validation-response.json",
      ("0x" + "00".repeat(32)) as `0x${string}`, // responseHash (empty)
      "skill-test", // tag
      "0x" as `0x${string}`, // proof (empty for EOA validator)
    ],
    account,
    chain,
  });
  await waitForReceipt(respTx, "validationResponse");
  console.log(
    `  ✔ validation response submitted — score: 92/100, tag: "skill-test"`,
  );

  // Verify status
  const { validatorAddress: validatorAddr, response: score } =
    await validationRegistry.getValidationStatus(requestHash);

  if (validatorAddr.toLowerCase() !== account.address.toLowerCase())
    throw new Error(
      `Test 4 FAILED: wrong validator, expected ${account.address} got ${validatorAddr}`,
    );
  if (score !== 92)
    throw new Error(`Test 4 FAILED: expected score 92, got ${score}`);
  console.log(
    `  ✔ status confirmed — validator: ${validatorAddr.slice(0, 10)}..., score: ${score}/100`,
  );

  // Check getSummary
  const [count, avgScore] = (await publicClient.readContract({
    address: VALIDATION_REGISTRY_ADDRESS,
    abi: VALIDATION_REGISTRY_ABI,
    functionName: "getSummary",
    args: [tokenId, [], ""],
  })) as [bigint, number];

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
    console.log(`    (Run on baseSepolia or Base mainnet to test)`);
    return;
  }
  console.log(`  IdentityRegistry:   ${IDENTITY_REGISTRY_ADDRESS}`);
  console.log(`  ReputationRegistry: ${REPUTATION_REGISTRY_ADDRESS}`);

  // Mint to recipient so account can give feedback without hitting self-feedback guard.
  // AgentRegistry auto-registers in the Identity Registry during mint.
  const tokenId = await mintAgentToken(
    [
      recipient,
      "https://example.com/reputation-test-agent.json",
      "https://example.com/reputation-test-agent.json",
      [],
    ],
    "mint reputation agent",
  );
  console.log(`  ✔ minted — tokenId: ${tokenId}`);

  // Read the ERC-8004 agentId that was assigned during mint
  const erc8004AgentId = await agentRegistry.getERC8004AgentId(tokenId);
  if (erc8004AgentId === 0n)
    throw new Error(
      `Test 5 FAILED: erc8004AgentId is 0 — identity co-registration failed`,
    );
  console.log(`  ✔ ERC-8004 agentId: ${erc8004AgentId}`);

  // Give reputation feedback keyed by the ERC-8004 agentId
  const feedbackTx = await walletClient.writeContract({
    address: REPUTATION_REGISTRY_ADDRESS,
    abi: REPUTATION_REGISTRY_ABI,
    functionName: "giveFeedback",
    args: [
      erc8004AgentId,
      90n, // value (int128)
      0, // valueDecimals
      "helpful", // tag1
      "web-search", // tag2
      "", // endpoint
      "", // feedbackURI
      ("0x" + "00".repeat(32)) as `0x${string}`, // feedbackHash
    ],
    account,
    chain,
  });
  await waitForReceipt(feedbackTx, "giveFeedback");
  console.log(`  ✔ feedback submitted — value: 90, tags: helpful/web-search`);

  // Read back the feedback entry
  const lastIndex = (await publicClient.readContract({
    address: REPUTATION_REGISTRY_ADDRESS,
    abi: REPUTATION_REGISTRY_ABI,
    functionName: "getLastIndex",
    args: [erc8004AgentId, account.address],
  })) as bigint;

  const [value, , tag1, tag2, isRevoked] = (await publicClient.readContract({
    address: REPUTATION_REGISTRY_ADDRESS,
    abi: REPUTATION_REGISTRY_ABI,
    functionName: "readFeedback",
    args: [erc8004AgentId, account.address, lastIndex],
  })) as [bigint, number, string, string, boolean];

  if (value !== 90n || isRevoked)
    throw new Error(`Test 5 FAILED: value=${value} isRevoked=${isRevoked}`);
  console.log(
    `  ✔ feedback read — value: ${value}, tag1: "${tag1}", tag2: "${tag2}"`,
  );

  // Aggregate summary
  const [count, summaryValue] = (await publicClient.readContract({
    address: REPUTATION_REGISTRY_ADDRESS,
    abi: REPUTATION_REGISTRY_ABI,
    functionName: "getSummary",
    args: [erc8004AgentId, [account.address], "", ""],
  })) as [bigint, bigint, number];

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
    IDENTITY_REGISTRY_ADDRESS === "0x0000000000000000000000000000000000000000"
  ) {
    console.log(
      `  ⚠ SKIPPED — ERC-8004 singletons not present on chain ${CHAIN_ID}`,
    );
    return;
  }
  console.log(`  IdentityRegistry: ${IDENTITY_REGISTRY_ADDRESS}`);

  // Mint a fresh agent
  const tokenId = await mintAgentToken(
    [
      account.address,
      "https://example.com/services-test-agent.json",
      "https://example.com/services-test-agent.json",
      [],
    ],
    "mint services agent",
  );
  console.log(`  ✔ minted — tokenId: ${tokenId}`);

  // Read the ERC-8004 agentId
  const erc8004AgentId = await agentRegistry.getERC8004AgentId(tokenId);
  if (erc8004AgentId === 0n)
    throw new Error(
      `Test 6 FAILED: erc8004AgentId is 0 — identity co-registration failed`,
    );
  console.log(`  ✔ ERC-8004 agentId: ${erc8004AgentId}`);

  // Build a new metadata URI with services
  const services = [
    {
      name: "e2e-test-service",
      endpoint: "https://example.com/api",
      version: "1.0",
      skills: ["inference"],
    },
  ];
  const metadata = {
    name: "E2E Test Agent",
    services,
    registrations: [
      {
        agentId: Number(tokenId),
        agentRegistry: `eip155:${CHAIN_ID}:${AGENT_REGISTRY_ADDRESS}`,
      },
      {
        agentId: Number(erc8004AgentId),
        agentRegistry: `eip155:${CHAIN_ID}:${IDENTITY_REGISTRY_ADDRESS}`,
      },
    ],
  };
  const tokenUri = `data:application/json;base64,${Buffer.from(
    JSON.stringify(metadata),
  ).toString("base64")}`;

  const updateTx = await walletClient.writeContract({
    address: IDENTITY_REGISTRY_ADDRESS,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: "setAgentURI",
    args: [erc8004AgentId, tokenUri],
    account,
    chain,
  });
  await waitForReceipt(updateTx, "setAgentURI");
  console.log(`  ✔ services updated — URI length: ${tokenUri.length}`);

  // Verify the URI was set
  const storedUri = await identityRegistry.tokenURI(erc8004AgentId);
  if (storedUri !== tokenUri)
    throw new Error(`Test 6 FAILED: tokenURI mismatch`);
  console.log(`  ✔ tokenURI verified`);
  console.log(`  ✔ PASSED`);
}

// ── Oracle health-check ──────────────────────────────────────────────────────

async function assertOracleRunning(): Promise<void> {
  try {
    const res = await fetch(`${ORACLE_URL}/address`, {
      signal: AbortSignal.timeout(2_000),
    });
    if (res.ok) return;
  } catch {
    // not running
  }
  throw new Error(
    `Oracle is not reachable at ${ORACLE_URL}.\n` +
      `Start it manually: cd apps/oracle && npm run dev`,
  );
}

// ── Run ───────────────────────────────────────────────────────────────────────

await assertOracleRunning();
try {
  await testSimpleTransfer();
  await testIntelligentTransfer();
  await testEncryptDecryptSkill();
  await testValidationRegistry();
  await testReputationFeedback();
  await testUpdateServices();
  console.log("\n✔ All tests passed");
} finally {
  // nothing to clean up
}
