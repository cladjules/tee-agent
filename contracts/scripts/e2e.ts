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
import { createPublicClient, createWalletClient, http, keccak256 } from "viem";
import { baseSepolia, hardhat } from "viem/chains";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, execSync } from "node:child_process";
import { ethers } from "ethers";
import {
  generateContentKey,
  encryptMetadata,
  hashEncryptedBlob,
  decryptContentKey,
  decryptMetadata,
} from "@open-agents-toolkit/agent/encryption";

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
  "ArcaneAgents#AgentRegistry"
] as `0x${string}`;
const TEE_VERIFIER_ADDRESS = deployedAddresses[
  "ArcaneAgents#TeeVerifier"
] as `0x${string}`;
const VERIFIER_ADDRESS = deployedAddresses[
  "ArcaneAgents#Verifier"
] as `0x${string}`;
const VALIDATION_REGISTRY_ADDRESS = deployedAddresses[
  "ArcaneAgents#ValidationRegistry"
] as `0x${string}`;

/**
 * Official ERC-8004 singletons.
 * Mainnet (Base):          identity 0x8004A169…  reputation 0x8004BAa1…
 * Testnets (Base Sepolia): identity 0x8004A818…  reputation 0x8004B663…
 * Not present on local Hardhat nodes.
 */
const IDENTITY_REGISTRY_ADDRESS = isLocal
  ? ("0x0000000000000000000000000000000000000000" as `0x${string}`)
  : ("0x8004A818BFB912233c491871b3d84c89A494BD9e" as `0x${string}`);

const REPUTATION_REGISTRY_ADDRESS = (process.env.REPUTATION_REGISTRY_ADDRESS ??
  (isLocal ? undefined : "0x8004B663056A597Dffe9eCcC1965A193B7388713")) as
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
  try {
    return (await publicClient.readContract({
      address: AGENT_REGISTRY_ADDRESS,
      abi: AGENT_REGISTRY_ABI,
      functionName: "getMintFee",
    })) as bigint;
  } catch {
    return 0n;
  }
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
  void receipt; // receipt confirms the tx; confirmations:1 ensures state is stable

  // Read totalSupply at `latest` — safe because waitForReceipt already waited
  // for 1 extra confirmation (the block after inclusion), so every RPC node in
  // the cluster has caught up and `latest` reflects the minted token.
  const totalSupply = (await publicClient.readContract({
    address: AGENT_REGISTRY_ADDRESS,
    abi: AGENT_REGISTRY_ABI,
    functionName: "totalSupply",
  })) as bigint;
  return totalSupply - 1n;
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
  tokenId: bigint;
  from: `0x${string}`;
  to: `0x${string}`;
  currentHashes: readonly `0x${string}`[];
  blobUris: string[];
  contentKey: Uint8Array;
  deadline: bigint;
  recipientPrivKey: `0x${string}`;
}) {
  const {
    tokenId,
    from,
    to,
    currentHashes,
    blobUris,
    contentKey,
    deadline,
    recipientPrivKey: recipPrivKey,
  } = params;

  const recipientSigningKey = new ethers.SigningKey(recipPrivKey);
  const targetPubkey = recipientSigningKey.compressedPublicKey as `0x${string}`;
  const contentKeyB64 = Buffer.from(contentKey).toString("base64");

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

  const ownerAfter = (await publicClient.readContract({
    address: AGENT_REGISTRY_ADDRESS,
    abi: AGENT_REGISTRY_ABI,
    functionName: "ownerOf",
    args: [tokenId],
  })) as `0x${string}`;
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

  const intelligentDatas = (await publicClient.readContract({
    address: AGENT_REGISTRY_ADDRESS,
    abi: AGENT_REGISTRY_ABI,
    functionName: "intelligentDatasOf",
    args: [tokenId],
  })) as Array<{ dataDescription: string; dataHash: `0x${string}` }>;
  const currentHashes = intelligentDatas.map((d) => d.dataHash);
  console.log(`  On-chain data hashes: ${currentHashes.length}`);

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const proofs = await buildTransferProofsViaOracle({
    tokenId,
    from: account.address,
    to: recipient,
    currentHashes,
    blobUris: [skillBlobUri, configBlobUri],
    contentKey,
    deadline,
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

  const ownerAfter = (await publicClient.readContract({
    address: AGENT_REGISTRY_ADDRESS,
    abi: AGENT_REGISTRY_ABI,
    functionName: "ownerOf",
    args: [tokenId],
  })) as `0x${string}`;
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
  const [validatorAddr, , score] = (await publicClient.readContract({
    address: VALIDATION_REGISTRY_ADDRESS,
    abi: VALIDATION_REGISTRY_ABI,
    functionName: "getValidationStatus",
    args: [requestHash],
  })) as [`0x${string}`, bigint, number, `0x${string}`, string, bigint];

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

  // Mint — AgentRegistry auto-registers in the Identity Registry during mint
  const tokenId = await mintAgentToken(
    [account.address, "https://example.com/reputation-test-agent.json", "", []],
    "mint reputation agent",
  );
  console.log(`  ✔ minted — tokenId: ${tokenId}`);

  // Read the ERC-8004 agentId that was assigned during mint
  const erc8004AgentId = (await publicClient.readContract({
    address: AGENT_REGISTRY_ADDRESS,
    abi: AGENT_REGISTRY_ABI,
    functionName: "getERC8004AgentId",
    args: [tokenId],
  })) as bigint;
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

// ── Oracle auto-start ─────────────────────────────────────────────────────────

/**
 * If the oracle isn't reachable, start tappd-sim in Docker and spawn the oracle
 * server. Only auto-starts when ORACLE_URL is localhost:3001 (i.e. not a remote
 * CVM). Returns a cleanup function to kill the spawned process, or null if the
 * oracle was already running.
 */
async function ensureOracleRunning(): Promise<(() => void) | null> {
  // Check if already up
  try {
    const res = await fetch(`${ORACLE_URL}/address`, {
      signal: AbortSignal.timeout(2_000),
    });
    if (res.ok) {
      console.log(`Oracle already running at ${ORACLE_URL}`);
      return null;
    }
  } catch {
    // not running
  }

  if (
    !ORACLE_URL.startsWith("http://localhost") &&
    !ORACLE_URL.startsWith("http://127.0.0.1")
  ) {
    throw new Error(
      `Oracle not reachable at ${ORACLE_URL} and it's a remote URL — cannot auto-start.`,
    );
  }

  console.log("Auto-starting oracle (tappd-sim + oracle server)...");

  // Start or reuse the tappd-sim Docker container
  try {
    execSync(
      "docker start tappd-sim 2>/dev/null || docker run -d -p 8090:8090 --name tappd-sim phalanetwork/tappd-simulator:latest",
      { stdio: "ignore" },
    );
  } catch {
    // ignore — tappd-sim may already be running
  }

  // Give Docker container a moment to bind the port
  await new Promise((r) => setTimeout(r, 1_500));

  const oracleDir = resolve(__dirname, "../../apps/oracle");
  const child = spawn("npx", ["tsx", "src/index.ts"], {
    cwd: oracleDir,
    env: {
      ...process.env,
      PORT: "3001",
      DSTACK_SIMULATOR_ENDPOINT: "http://localhost:8090",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout?.on("data", (d: Buffer) =>
    process.stdout.write(`  [oracle] ${d}`),
  );
  child.stderr?.on("data", (d: Buffer) =>
    process.stderr.write(`  [oracle] ${d}`),
  );

  // Poll until the oracle is accepting requests (up to 30 s)
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1_000));
    try {
      const res = await fetch(`${ORACLE_URL}/address`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (res.ok) {
        console.log(`  ✔ Oracle ready at ${ORACLE_URL}`);
        return () => child.kill();
      }
    } catch {
      // not ready yet
    }
    if (i === 29) {
      child.kill();
      throw new Error("Oracle failed to start within 30 s");
    }
  }

  return () => child.kill();
}

// ── Run ───────────────────────────────────────────────────────────────────────

const stopOracle = await ensureOracleRunning();
try {
  await testSimpleTransfer();
  await testIntelligentTransfer();
  await testEncryptDecryptSkill();
  await testValidationRegistry();
  await testReputationFeedback();
  console.log("\n✔ All tests passed");
} finally {
  stopOracle?.();
}
