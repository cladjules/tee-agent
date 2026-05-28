/**
 * SDK E2E test: exercises the full @tee-agent/sdk public API against a live chain.
 *
 * Everything is imported from @tee-agent/sdk — no direct agent package imports.
 * This validates the SDK layer: createAgentSdk, TX builders, EIP-712 builders,
 * signAccessPayloads, and the bound factory methods.
 *
 * Usage:
 *   npm run e2e-sdk:local          # against local Hardhat node (chain 31337)
 *   npm run e2e-sdk:baseSepolia    # against Base Sepolia (chain 84532)
 */
import "dotenv/config";
import {
  createWalletClient,
  createPublicClient,
  http,
  parseAbi,
  parseEventLogs,
  zeroAddress,
} from "viem";
import { base, baseSepolia, hardhat } from "viem/chains";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { ethers } from "ethers";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, execSync } from "node:child_process";
import {
  createAgentSdk,
  buildMintTxArgs,
  buildTransferTxArgs,
  buildUpdateServicesTxArgs,
  buildReencryptTypedData,
  buildRunTypedData,
  buildValidateTypedData,
  signAccessPayloads,
  generateContentKey,
  encryptMetadata,
  hashEncryptedBlob,
  defaultIdentityRegistry,
  defaultReputationRegistry,
  AgentRegistry,
  TEE_VERIFIER_ABI,
} from "@tee-agent/sdk";
import type { AgentConfig } from "@tee-agent/sdk";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Network selection ─────────────────────────────────────────────────────────

const NETWORK = process.argv[2] ?? process.env.NETWORK ?? "local";
const isLocal = NETWORK === "local";

// ── Config ────────────────────────────────────────────────────────────────────

const CHAIN_ID = isLocal ? 31337 : 84532;
const RPC_URL = isLocal
  ? (process.env.LOCAL_RPC_URL ?? "http://127.0.0.1:8545")
  : (process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org");

const HARDHAT_KEY_0 =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const PRIVATE_KEY = (
  isLocal ? HARDHAT_KEY_0 : process.env.PRIVATE_KEY
) as `0x${string}`;
if (!PRIVATE_KEY) throw new Error("PRIVATE_KEY not set in .env");

const ORACLE_URL = process.env.ORACLE_URL ?? "http://localhost:3001";

const chain = isLocal
  ? ({ ...hardhat, rpcUrls: { default: { http: [RPC_URL] } } } as const)
  : ({ ...baseSepolia, rpcUrls: { default: { http: [RPC_URL] } } } as const);

// ── Load deployed addresses ───────────────────────────────────────────────────

const deployedAddresses = JSON.parse(
  readFileSync(
    resolve(
      __dirname,
      `../ignition/deployments/chain-${CHAIN_ID}/deployed_addresses.json`,
    ),
    "utf8",
  ),
);

const AGENT_REGISTRY_ADDRESS = deployedAddresses[
  "TeeAgent#AgentRegistry"
] as `0x${string}`;
const TEE_VERIFIER_ADDRESS = deployedAddresses[
  "TeeAgent#TeeVerifier"
] as `0x${string}`;

// ── Clients + accounts ────────────────────────────────────────────────────────

const account = privateKeyToAccount(PRIVATE_KEY);
const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });
const walletClient = createWalletClient({
  account,
  chain,
  transport: http(RPC_URL),
});

const recipientPrivKey = generatePrivateKey();
const recipientAccount = privateKeyToAccount(recipientPrivKey);
const recipientWalletClient = createWalletClient({
  account: recipientAccount,
  chain,
  transport: http(RPC_URL),
});

console.log(`Network:       ${NETWORK} (chain ${CHAIN_ID})`);
console.log(`AgentRegistry: ${AGENT_REGISTRY_ADDRESS}`);
console.log(`Sender:        ${account.address}`);
console.log(`Recipient:     ${recipientAccount.address}`);

// ── Registry client ──────────────────────────────────────────────────────────

const agentRegistry = new AgentRegistry({
  agentRegistryAddress: AGENT_REGISTRY_ADDRESS,
  publicClient: publicClient as any,
});

// ── SDK instance ──────────────────────────────────────────────────────────────

const sdkConfig: AgentConfig = {
  chain: chain as typeof baseSepolia,
  rpcUrl: RPC_URL,
  registryAddress: AGENT_REGISTRY_ADDRESS,
  oracleUrl: ORACLE_URL,
  ...(isLocal
    ? {}
    : {
        identityRegistryAddress: defaultIdentityRegistry(
          NETWORK === "base" ? base : baseSepolia,
        ),
        reputationRegistryAddress: defaultReputationRegistry(
          NETWORK === "base" ? base : baseSepolia,
        ),
      }),
};
const sdk = createAgentSdk(sdkConfig);

// ── Helpers ───────────────────────────────────────────────────────────────────

async function waitForReceipt(hash: `0x${string}`, label?: string) {
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

async function getOracleInfo(): Promise<{
  address: `0x${string}`;
  publicKey: string;
}> {
  const res = await fetch(`${ORACLE_URL}/address`);
  if (!res.ok)
    throw new Error(
      `Oracle unreachable at ${ORACLE_URL}/address — start the oracle`,
    );
  return (await res.json()) as { address: `0x${string}`; publicKey: string };
}

// ── Test 1: Mint via SDK ──────────────────────────────────────────────────────

async function testSdkMint(): Promise<bigint> {
  console.log(
    "\n── Test 1: Mint via SDK ─────────────────────────────────────",
  );

  const oracle = await getOracleInfo();
  const contentKey = generateContentKey();
  const blob = encryptMetadata(
    "skill.md",
    "# SDK E2E Agent\nYou are a helpful assistant.",
    contentKey,
    oracle.publicKey,
  );
  const blobHash = await hashEncryptedBlob(blob);
  const blobUri = `data:application/json;base64,${Buffer.from(
    JSON.stringify(blob),
  ).toString("base64")}`;

  const mintResult = await sdk.prepareMint({
    name: "SDK E2E Agent",
    description: "Created by e2e-sdk.ts",
    ownerAddress: account.address,
    agentType: "assistant",
    privateEntries: [
      {
        name: "skill.md",
        data: "# SDK E2E Agent\nYou are a helpful assistant.",
      },
    ],
  });
  if ("error" in mintResult)
    throw new Error(`Mint prep failed: ${mintResult.error}`);

  const hash = await walletClient.writeContract({
    ...buildMintTxArgs(mintResult, account.address),
    account,
    chain,
  });
  const receipt1 = await waitForReceipt(hash, "SDK mint");

  const transferLogs1 = parseEventLogs({
    abi: parseAbi([
      "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
    ]),
    eventName: "Transfer",
    logs: receipt1.logs,
  }).filter((l) => l.args.from === zeroAddress);
  if (transferLogs1.length === 0)
    throw new Error(`No Transfer(0x0 → ...) log found in SDK mint receipt`);
  const tokenId = transferLogs1[0]!.args.tokenId;
  console.log(`  ✔ minted — tokenId: ${tokenId}`);

  // resolveAgent round-trip
  const resolved = await sdk.resolveAgent(tokenId);
  if (!resolved) throw new Error(`Test 1 FAILED: resolveAgent returned null`);
  console.log(`  ✔ resolveAgent — owner: ${resolved.owner.slice(0, 10)}...`);

  // Verify on-chain intelligent data count matches what we minted
  const intelligentDatas = await agentRegistry.intelligentDatasOf(tokenId);
  console.log(
    `  ✔ on-chain intelligent data entries: ${intelligentDatas.length}`,
  );

  console.log(`  ✔ PASSED`);
  return tokenId;
}

// ── Test 2: EIP-712 builder shape validation ──────────────────────────────────

async function testEip712Builders() {
  console.log(
    "\n── Test 2: EIP-712 builder shapes ──────────────────────────────",
  );

  const oracle = await getOracleInfo();
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

  // buildReencryptTypedData — via bound sdk method (chainId pre-filled)
  const reencryptTd = sdk.buildReencryptTypedData({
    oracleAddress: oracle.address,
    tokenId: 1n,
    from: account.address,
    to: recipientAccount.address,
    deadline,
  });
  if (
    reencryptTd.primaryType !== "ReencryptRequest" ||
    reencryptTd.domain.chainId !== BigInt(CHAIN_ID)
  )
    throw new Error("Test 2 FAILED: reencrypt typed data malformed");
  console.log(
    `  ✔ buildReencryptTypedData — primaryType: ${reencryptTd.primaryType}`,
  );

  // buildRunTypedData
  const runTd = buildRunTypedData({
    oracleAddress: oracle.address,
    chainId: CHAIN_ID,
    agentId: 1n,
    payload: { task: "hello" },
    deadline,
  });
  if (runTd.primaryType !== "RunRequest")
    throw new Error("Test 2 FAILED: run typed data malformed");
  console.log(`  ✔ buildRunTypedData — primaryType: ${runTd.primaryType}`);

  // buildValidateTypedData
  const validateTd = buildValidateTypedData({
    oracleAddress: oracle.address,
    chainId: CHAIN_ID,
    agentId: 1n,
    requestHash: ("0x" + "ab".repeat(32)) as `0x${string}`,
    payload: { score: 95 },
    deadline,
  });
  if (validateTd.primaryType !== "ValidateRequest")
    throw new Error("Test 2 FAILED: validate typed data malformed");
  console.log(
    `  ✔ buildValidateTypedData — primaryType: ${validateTd.primaryType}`,
  );

  console.log(`  ✔ PASSED`);
}

// ── Test 3: Secure transfer via SDK ──────────────────────────────────────────

async function testSdkSecureTransfer(tokenId: bigint) {
  console.log(
    "\n── Test 3: Secure transfer via SDK ─────────────────────────────",
  );

  const oracle = await getOracleInfo();

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

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

  // Get recipient compressed public key for re-encryption
  const recipientSigningKey = new ethers.SigningKey(recipientPrivKey);
  const newOwnerPublicKey =
    recipientSigningKey.compressedPublicKey as `0x${string}`;

  // Owner signs the EIP-712 ReencryptRequest using buildReencryptTypedData
  const reencryptTd = buildReencryptTypedData({
    oracleAddress: oracle.address,
    chainId: CHAIN_ID,
    tokenId,
    from: account.address,
    to: recipientAccount.address,
    deadline,
  });
  const oracleSignature = await walletClient.signTypedData({
    ...reencryptTd,
    account,
  });
  console.log(`  ✔ owner signed ReencryptRequest`);

  // prepareTransfer calls the oracle internally with the signature
  const transferResult = await sdk.prepareTransfer({
    tokenId: tokenId.toString(),
    to: recipientAccount.address,
    newOwnerPublicKey,
    oracleSignature,
    oracleDeadline: deadline.toString(),
  });
  if ("error" in transferResult)
    throw new Error(`Transfer prep failed: ${transferResult.error}`);
  console.log(
    `  ✔ prepareTransfer — ${transferResult.accessPayloads.length} access payload(s)`,
  );

  // Recipient signs access payloads via signAccessPayloads
  const proofs = await signAccessPayloads(
    (digest) =>
      recipientWalletClient.signMessage({
        account: recipientAccount,
        message: digest,
      }),
    transferResult.accessPayloads,
    transferResult.ownershipProofs,
    {
      from: transferResult.from!,
      to: transferResult.to,
      tokenId,
      deadline,
    },
  );
  console.log(`  ✔ signAccessPayloads — ${proofs.length} proof(s) assembled`);

  // Execute the transfer
  const transferHash = await walletClient.writeContract({
    ...buildTransferTxArgs(transferResult, account.address, proofs),
    account,
    chain,
  });
  await waitForReceipt(transferHash, "SDK iTransferFrom");
  console.log(`  ✔ iTransferFrom — tx: ${transferHash.slice(0, 10)}...`);

  // Verify ownership changed
  const owner = await agentRegistry.ownerOf(tokenId);
  if (owner.toLowerCase() !== recipientAccount.address.toLowerCase())
    throw new Error(
      `Test 3 FAILED: expected ${recipientAccount.address}, got ${owner}`,
    );
  console.log(`  ✔ ownership verified — new owner: ${owner.slice(0, 10)}...`);
  console.log(`  ✔ PASSED`);
}

// ── Test 4: Update services via SDK ──────────────────────────────────────────

async function testSdkUpdateServices() {
  console.log(
    "\n── Test 4: Update services via SDK ─────────────────────────────",
  );

  if (!sdkConfig.identityRegistryAddress) {
    console.log(
      `  ⚠ SKIPPED — identityRegistryAddress not set (local Hardhat)`,
    );
    return;
  }

  // Mint a fresh agent to own for this test
  const mintResult = await sdk.prepareMint({
    name: "Services Test Agent",
    description: "For service update test",
    ownerAddress: account.address,
    agentType: "assistant",
    privateEntries: [],
  });
  if ("error" in mintResult)
    throw new Error(`Mint prep failed: ${mintResult.error}`);

  const mintHash = await walletClient.writeContract({
    ...buildMintTxArgs(mintResult, account.address),
    account,
    chain,
  });
  const mintReceipt = await waitForReceipt(
    mintHash,
    "SDK mint for services test",
  );

  const transferLogs2 = parseEventLogs({
    abi: parseAbi([
      "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
    ]),
    eventName: "Transfer",
    logs: mintReceipt.logs,
  }).filter((l) => l.args.from === zeroAddress);
  if (transferLogs2.length === 0)
    throw new Error(
      `No Transfer(0x0 → ...) log found in services mint receipt`,
    );
  const tokenId = transferLogs2[0]!.args.tokenId;
  console.log(`  ✔ minted — tokenId: ${tokenId}`);

  const servicesJson = JSON.stringify([
    {
      name: "sdk-e2e-service",
      endpoint: "https://example.com/sdk-service",
      version: "2.0",
      skills: ["inference", "search"],
    },
  ]);

  const updateResult = await sdk.prepareUpdateServices({
    tokenId: tokenId.toString(),
    servicesJson,
  });
  if ("error" in updateResult)
    throw new Error(`Update prep failed: ${updateResult.error}`);
  console.log(
    `  ✔ prepareUpdateServices — URI length: ${updateResult.tokenUri.length}`,
  );

  const updateHash = await walletClient.writeContract({
    ...buildUpdateServicesTxArgs(updateResult),
    account,
    chain,
  });
  await waitForReceipt(updateHash, "SDK setAgentURI");
  console.log(`  ✔ setAgentURI tx committed`);

  // Verify via fetchAgentServices
  const fetched = await sdk.fetchAgentServices({
    tokenId: tokenId.toString(),
    ownerAddress: account.address,
  });
  if ("error" in fetched)
    throw new Error(`fetchAgentServices failed: ${fetched.error}`);
  if (!fetched.services.some((s) => s.name === "sdk-e2e-service"))
    throw new Error(`Test 4 FAILED: expected sdk-e2e-service in services`);
  console.log(
    `  ✔ fetchAgentServices — found ${fetched.services.length} service(s)`,
  );
  console.log(`  ✔ PASSED`);
}

// ── Oracle auto-start (reused from e2e.ts pattern) ────────────────────────────

async function ensureOracleRunning(): Promise<(() => void) | null> {
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
  try {
    execSync(
      "docker start tappd-sim 2>/dev/null || docker run -d -p 8090:8090 --name tappd-sim phalanetwork/tappd-simulator:latest",
      { stdio: "ignore" },
    );
  } catch {
    // ignore
  }

  await new Promise((r) => setTimeout(r, 1_500));

  const oracleDir = resolve(__dirname, "../../apps/oracle");
  const child = spawn("npm", ["run", "start"], {
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

  // Poll until the oracle is accepting requests (up to 60 s)
  for (let i = 0; i < 60; i++) {
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
    if (i === 59) {
      child.kill();
      throw new Error("Oracle failed to start within 60 s");
    }
  }
  return () => child.kill();
}

// ── Run ───────────────────────────────────────────────────────────────────────

const stopOracle = await ensureOracleRunning();
try {
  const tokenId = await testSdkMint();
  await testEip712Builders();
  await testSdkSecureTransfer(tokenId);
  await testSdkUpdateServices();
  console.log("\n✔ All SDK tests passed");
} finally {
  stopOracle?.();
}
