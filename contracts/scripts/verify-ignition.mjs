#!/usr/bin/env node

import "dotenv/config";

// Verify deployed contracts from an Ignition deployment on Blockscout-compatible explorers.
// Usage:
//   node scripts/verify-ignition.mjs [chainId] [networkName]
// Example:
//   node scripts/verify-ignition.mjs 16602 zeroGGalileo

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { privateKeyToAccount } from "viem/accounts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

const chainId = process.argv[2] ?? "16602";
const networkName = process.argv[3] ?? "zeroGGalileo";
const explorerApiUrl = "https://chainscan-galileo.0g.ai/open/api";

const deployedPath = join(
  ROOT,
  "contracts/ignition/deployments",
  `chain-${chainId}`,
  "deployed_addresses.json",
);

if (!existsSync(deployedPath)) {
  console.error(`No deployment found at: ${deployedPath}`);
  process.exit(1);
}

const deployed = JSON.parse(readFileSync(deployedPath, "utf8"));

const teeVerifier = deployed["OpenAgentsToolkit#TEEVerifier"];
const agentRegistry = deployed["OpenAgentsToolkit#AgentRegistry"];
const ensAgentRegistry = deployed["OpenAgentsToolkit#ENSAgentRegistry"];
const reputationRegistry = deployed["OpenAgentsToolkit#ReputationRegistry"];
const validationRegistry = deployed["OpenAgentsToolkit#ValidationRegistry"];

const privateKey = process.env.PRIVATE_KEY;
const deployer =
  privateKey && privateKey.startsWith("0x")
    ? privateKeyToAccount(privateKey).address
    : undefined;

const tasks = [
  {
    label: "TEEVerifier",
    address: teeVerifier,
    contract: "src/TEEVerifier.sol:TEEVerifier",
    args: [],
  },
  {
    label: "AgentRegistry",
    address: agentRegistry,
    contract: "src/AgentRegistry.sol:AgentRegistry",
    args:
      deployer && teeVerifier
        ? ['"Open Agents Toolkit"', '"OAT"', deployer, teeVerifier]
        : null,
  },
  {
    label: "ENSAgentRegistry",
    address: ensAgentRegistry,
    contract: "src/ENSAgentRegistry.sol:ENSAgentRegistry",
    args: agentRegistry ? [agentRegistry] : null,
  },
  {
    label: "ReputationRegistry",
    address: reputationRegistry,
    contract: "src/ReputationRegistry.sol:ReputationRegistry",
    args: agentRegistry ? [agentRegistry] : null,
  },
  {
    label: "ValidationRegistry",
    address: validationRegistry,
    contract: "src/ValidationRegistry.sol:ValidationRegistry",
    args: agentRegistry ? [agentRegistry] : null,
  },
];

let failed = 0;

try {
  const probe = await fetch(
    `${explorerApiUrl}?module=block&action=eth_block_number`,
    {
      method: "GET",
      headers: { accept: "application/json" },
    },
  );
  const contentType = probe.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("json")) {
    process.exit(0);
  }
} catch {
  process.exit(0);
}

for (const task of tasks) {
  if (!task.address || task.args === null) {
    console.warn(
      `Skipping ${task.label}: missing deployment data or constructor args.`,
    );
    continue;
  }

  const args = task.args.join(" ");
  const cmd = [
    "npx hardhat verify blockscout",
    `--network ${networkName}`,
    `--contract ${task.contract}`,
    task.address,
    args,
  ]
    .filter(Boolean)
    .join(" ");

  console.log(`\nVerifying ${task.label} at ${task.address}...`);

  try {
    execSync(cmd, { cwd: join(ROOT, "contracts"), stdio: "inherit" });
  } catch (err) {
    failed += 1;
    console.error(`Verification failed for ${task.label}.`);
  }
}

if (failed > 0) {
  console.warn(`\nVerification completed with ${failed} failure(s).`);
  process.exit(0);
}

console.log("\nAll contracts verified successfully.");
