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
 *   ORACLE_PRIVATE_KEY   — oracle signer key (defaults to Hardhat account #1 locally)
 *   LOCAL_RPC_URL        — local RPC override (default: http://127.0.0.1:8545)
 *   BASE_SEPOLIA_RPC_URL — testnet RPC override (default: https://sepolia.base.org)
 */
import "dotenv/config";
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  parseEventLogs,
} from "viem";
import { baseSepolia, hardhat } from "viem/chains";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";
import {
  generateContentKey,
  encryptMetadata,
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

const ORACLE_PRIVATE_KEY = (
  isLocal ? HARDHAT_KEY_1 : process.env.ORACLE_PRIVATE_KEY
) as `0x${string}`;
if (!ORACLE_PRIVATE_KEY) throw new Error("ORACLE_PRIVATE_KEY not set in .env");

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
  "OpenAgentsToolkit#AgentRegistry"
] as `0x${string}`;
const TEE_VERIFIER_ADDRESS = deployedAddresses[
  "OpenAgentsToolkit#TeeVerifier"
] as `0x${string}`;
const VERIFIER_ADDRESS = deployedAddresses[
  "OpenAgentsToolkit#Verifier"
] as `0x${string}`;
const VALIDATION_REGISTRY_ADDRESS = deployedAddresses[
  "OpenAgentsToolkit#ValidationRegistry"
] as `0x${string}`;

/**
 * Official ERC-8004 singletons — deployed at the same address on every chain
 * via deterministic CREATE2. Not present on local Hardhat nodes.
 */
const IDENTITY_REGISTRY_ADDRESS =
  "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" as `0x${string}`;

const REPUTATION_REGISTRY_ADDRESS = (process.env.REPUTATION_REGISTRY_ADDRESS ??
  (isLocal ? undefined : "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63")) as
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
  if (isLocal) return publicClient.getTransactionReceipt({ hash });
  for (let attempt = 1; attempt <= 45; attempt++) {
    try {
      return await publicClient.getTransactionReceipt({ hash });
    } catch (err) {
      const msg = String(err);
      if (
        !msg.includes("TransactionReceiptNotFoundError") &&
        !msg.includes("could not be found")
      )
        throw err;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error(`Timed out waiting for receipt: ${label ?? hash}`);
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

function extractTokenId(logs: readonly unknown[]): bigint {
  const registered = parseEventLogs({
    abi: AGENT_REGISTRY_ABI,
    logs: logs as Parameters<typeof parseEventLogs>[0]["logs"],
    eventName: "Registered",
    strict: false,
  });
  const r = registered[0] as { args?: { agentId?: bigint } } | undefined;
  if (r?.args?.agentId !== undefined) return r.args.agentId;

  const transfers = parseEventLogs({
    abi: AGENT_REGISTRY_ABI,
    logs: logs as Parameters<typeof parseEventLogs>[0]["logs"],
    eventName: "Transfer",
    strict: false,
  });
  const mint = transfers.find((l) => {
    const tl = l as { args?: { from?: `0x${string}` } };
    return (
      tl.args?.from?.toLowerCase() ===
      "0x0000000000000000000000000000000000000000"
    );
  }) as { args?: { tokenId?: bigint } } | undefined;
  if (mint?.args?.tokenId !== undefined) return mint.args.tokenId;

  throw new Error("Could not extract tokenId from receipt");
}

// ── Proof builder ─────────────────────────────────────────────────────────────

async function buildTransferProofs(params: {
  tokenId: bigint;
  from: `0x${string}`;
  to: `0x${string}`;
  dataHashes: readonly `0x${string}`[];
  deadline: bigint;
}) {
  const { tokenId, from, to, dataHashes, deadline } = params;
  const abiCoder = ethers.AbiCoder.defaultAbiCoder();
  const oracleSigner = new ethers.SigningKey(ORACLE_PRIVATE_KEY);
  const recipientSigningKey = new ethers.SigningKey(recipientPrivKey);
  const targetPubkeyHex = recipientSigningKey.compressedPublicKey;
  const targetPubkey = targetPubkeyHex as `0x${string}`;
  const sealedKey = "0x" as `0x${string}`;

  return Promise.all(
    dataHashes.map(async (dataHash, i) => {
      // Access proof: signed by recipient
      // Domain: chainId + verifier + registry + tokenId + from + to + deadline + fields
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
            dataHash,
            targetPubkey,
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
      const accessProofSig = ethers.Signature.from(
        recipientSigningKey.sign(accessMessageHash),
      ).serialized as `0x${string}`;

      // Ownership proof: signed by oracle
      // Domain: chainId + verifier + registry + tokenId + from + to + deadline + fields
      const ownershipNonce = keccak256(
        `0x${Buffer.from(`ownership:${tokenId}:${i}:${Date.now()}`).toString("hex")}` as `0x${string}`,
      );
      const ownershipInnerHash = ethers.keccak256(
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
            dataHash,
            sealedKey,
            targetPubkey,
            ownershipNonce,
          ],
        ),
      );
      const messageHash = ethers.keccak256(
        ethers.concat([
          ethers.toUtf8Bytes("\x19Ethereum Signed Message:\n66"),
          ethers.toUtf8Bytes(ownershipInnerHash),
        ]),
      );
      const ownershipSig = ethers.Signature.from(oracleSigner.sign(messageHash))
        .serialized as `0x${string}`;

      return {
        accessProof: {
          dataHash,
          targetPubkey,
          nonce: accessNonce,
          proof: accessProofSig as `0x${string}`,
        },
        ownershipProof: {
          oracleType: 0 as number,
          dataHash,
          sealedKey,
          targetPubkey,
          nonce: ownershipNonce,
          proof: ownershipSig,
        },
        from,
        to,
        tokenId,
        deadline,
      };
    }),
  );
}

// ── Test 1: Simple mint + transferFrom ────────────────────────────────────────

async function testSimpleTransfer() {
  console.log(
    "\n── Test 1: Simple mint + transferFrom ───────────────────────────",
  );
  const mintFee = await getMintFee();
  const mintHash = await walletClient.writeContract({
    address: AGENT_REGISTRY_ADDRESS,
    abi: AGENT_REGISTRY_ABI,
    functionName: "mint",
    args: [account.address, "https://example.com/e2e-agent.json", "", []],
    account,
    chain,
    value: mintFee,
  });
  const mintReceipt = await waitForReceipt(mintHash, "mint simple agent");
  const tokenId = extractTokenId(mintReceipt.logs as readonly unknown[]);
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

  // Register oracle
  const oracleAddress = privateKeyToAccount(ORACLE_PRIVATE_KEY).address;
  console.log(`  Registering oracle: ${oracleAddress}`);
  const regHash = await walletClient.writeContract({
    address: TEE_VERIFIER_ADDRESS,
    abi: TEE_VERIFIER_ABI,
    functionName: "updateOracleAddress",
    args: [oracleAddress],
    account,
    chain,
  });
  await waitForReceipt(regHash, "updateOracleAddress");
  console.log(`  ✔ oracle registered`);

  const dummyBlob = {
    name: "system-prompt",
    ciphertext: Buffer.from("test system prompt").toString("base64"),
    iv: Buffer.alloc(12).toString("base64"),
    publicKey: "0x",
  };
  const blobUri = `data:application/json;base64,${Buffer.from(JSON.stringify(dummyBlob)).toString("base64")}`;
  const dataHash = keccak256(
    `0x${Buffer.from(JSON.stringify(dummyBlob)).toString("hex")}` as `0x${string}`,
  );

  const mintFee = await getMintFee();
  const mintHash = await walletClient.writeContract({
    address: AGENT_REGISTRY_ADDRESS,
    abi: AGENT_REGISTRY_ABI,
    functionName: "mint",
    args: [
      account.address,
      "https://example.com/e2e-secure-agent.json",
      blobUri,
      [{ dataDescription: blobUri, dataHash }],
    ],
    account,
    chain,
    value: mintFee,
  });
  const mintReceipt = await waitForReceipt(mintHash, "mint secure agent");
  const tokenId = extractTokenId(mintReceipt.logs as readonly unknown[]);
  console.log(`  ✔ minted — tokenId: ${tokenId}`);

  const intelligentDatas = (await publicClient.readContract({
    address: AGENT_REGISTRY_ADDRESS,
    abi: AGENT_REGISTRY_ABI,
    functionName: "intelligentDatasOf",
    args: [tokenId],
  })) as Array<{ dataDescription: string; dataHash: `0x${string}` }>;
  const dataHashes = intelligentDatas.map((d) => d.dataHash);
  console.log(`  On-chain data hashes: ${dataHashes.length}`);

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const proofs = await buildTransferProofs({
    tokenId,
    from: account.address,
    to: recipient,
    dataHashes,
    deadline,
  });
  console.log(`  Built ${proofs.length} transfer proof(s)`);

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

// ── Test 3: Encrypt/decrypt skill payload ─────────────────────────────────────

async function testEncryptDecryptSkill() {
  console.log(
    "\n── Test 3: Encrypt/decrypt skill payload ────────────────────────",
  );

  const skill = {
    name: "web-search",
    description: "Search the web for information",
    version: "1.0.0",
    systemPrompt: "You are a helpful web search assistant.",
    tools: [{ name: "search", endpoint: "https://api.example.com/search" }],
  };

  // ECIES key pair: use the sender's secp256k1 key
  const signingKey = new ethers.SigningKey(PRIVATE_KEY);
  const pubKeyHex = signingKey.compressedPublicKey; // "0x02..."
  const privKeyBytes = Buffer.from(PRIVATE_KEY.slice(2), "hex");

  const contentKey = generateContentKey();
  const blob = encryptMetadata(
    "web-search-skill",
    skill,
    contentKey,
    pubKeyHex,
  );
  console.log(
    `  ✔ encrypted — ${blob.ciphertext.length / 2} bytes ciphertext, algorithm: ${blob.algorithm}`,
  );

  // Decrypt: unwrap the content key, then decrypt the payload
  const recoveredKey = decryptContentKey(blob, privKeyBytes);
  const decrypted = decryptMetadata<typeof skill>(blob, recoveredKey);

  if (
    decrypted.name !== skill.name ||
    decrypted.systemPrompt !== skill.systemPrompt ||
    decrypted.tools.length !== skill.tools.length
  ) {
    throw new Error(
      `Test 3 FAILED: decrypted data does not match original — got ${JSON.stringify(decrypted)}`,
    );
  }
  console.log(
    `  ✔ decrypted — skill: "${decrypted.name}", tools: ${decrypted.tools.length}`,
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
  const mintFee = await getMintFee();
  const mintHash = await walletClient.writeContract({
    address: AGENT_REGISTRY_ADDRESS,
    abi: AGENT_REGISTRY_ABI,
    functionName: "mint",
    args: [
      account.address,
      "https://example.com/validation-test-agent.json",
      "",
      [],
    ],
    account,
    chain,
    value: mintFee,
  });
  const mintReceipt = await waitForReceipt(mintHash, "mint validation agent");
  const tokenId = extractTokenId(mintReceipt.logs as readonly unknown[]);
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
  const mintFee = await getMintFee();
  const mintHash = await walletClient.writeContract({
    address: AGENT_REGISTRY_ADDRESS,
    abi: AGENT_REGISTRY_ABI,
    functionName: "mint",
    args: [
      account.address,
      "https://example.com/reputation-test-agent.json",
      "",
      [],
    ],
    account,
    chain,
    value: mintFee,
  });
  const mintReceipt = await waitForReceipt(mintHash, "mint reputation agent");
  const tokenId = extractTokenId(mintReceipt.logs as readonly unknown[]);
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
    args: [erc8004AgentId, [], "", ""],
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

// ── Run ───────────────────────────────────────────────────────────────────────

await testSimpleTransfer();
await testIntelligentTransfer();
await testEncryptDecryptSkill();
await testValidationRegistry();
await testReputationFeedback();
console.log("\n✔ All tests passed");
