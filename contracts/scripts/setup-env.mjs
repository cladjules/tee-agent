#!/usr/bin/env node
// setup-env.mjs
// Reads Hardhat Ignition deployed_addresses.json and writes shared deployment JSON
//
// Usage:
//   node contracts/scripts/setup-env.mjs [network|chainId]
//   node contracts/scripts/setup-env.mjs baseSepolia   # default
//   node contracts/scripts/setup-env.mjs base

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

const networkOrChainId = process.argv[2] ?? "baseSepolia";
const CHAIN_ID_BY_NETWORK = {
  base: "8453",
  baseSepolia: "84532",
};
const chainId = CHAIN_ID_BY_NETWORK[networkOrChainId] ?? networkOrChainId;

if (!["8453", "84532"].includes(chainId)) {
  console.error(
    `Unknown network or chain ID "${networkOrChainId}". Use base, baseSepolia, 8453, or 84532.`,
  );
  process.exit(1);
}

const deployedPath = join(
  ROOT,
  "contracts/ignition/deployments",
  `chain-${chainId}`,
  "deployed_addresses.json",
);

if (!existsSync(deployedPath)) {
  console.error(`\nERROR: No deployment found at:\n  ${deployedPath}\n`);
  console.error(
    `Run: cd contracts && npx hardhat ignition deploy ignition/modules/... --network <name>\n`,
  );
  process.exit(1);
}

const raw = JSON.parse(readFileSync(deployedPath, "utf8"));

// Extract earliest deployment block from journal
const journalPath = join(
  ROOT,
  "contracts/ignition/deployments",
  `chain-${chainId}`,
  "journal.jsonl",
);
let deploymentBlock = null;
if (existsSync(journalPath)) {
  const lines = readFileSync(journalPath, "utf8").trim().split("\n");
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      const bn = entry?.receipt?.blockNumber;
      if (typeof bn === "number") {
        deploymentBlock = bn;
        break;
      }
    } catch {}
  }
}

const chainNames = {
  8453: "base",
  84532: "baseSepolia",
};

// Map Ignition module keys → shared deployment contract keys
const KEY_MAP = {
  "TeeAgent#AgentRegistry": "agentRegistry",
  "TeeAgent#TeeVerifier": "teeVerifier",
  "TeeAgent#ValidationRegistry": "validationRegistry",
};

const resolvedContracts = {};
for (const [ignitionKey, contractKey] of Object.entries(KEY_MAP)) {
  if (raw[ignitionKey]) {
    resolvedContracts[contractKey] = raw[ignitionKey];
  }
}

if (Object.keys(resolvedContracts).length === 0) {
  console.error(
    "ERROR: No matching contract addresses found in deployed_addresses.json",
  );
  process.exit(1);
}

const deploymentsPath = join(ROOT, "deployments.json");
const deployments = existsSync(deploymentsPath)
  ? JSON.parse(readFileSync(deploymentsPath, "utf8"))
  : {};

const existingDeployment = deployments[chainId] ?? {};
const nextDeployment = {
  ...existingDeployment,
  name: chainNames[chainId] ?? existingDeployment.name,
  contracts: {
    ...(existingDeployment.contracts ?? {}),
    ...resolvedContracts,
  },
};
delete nextDeployment.contracts.verifier;
if (deploymentBlock !== null) {
  nextDeployment.fromBlock = String(deploymentBlock);
}

deployments[chainId] = nextDeployment;
writeFileSync(deploymentsPath, `${JSON.stringify(deployments, null, 2)}\n`);

console.log(`\n✓ Written to deployments.json (chain ${chainId})\n`);
for (const [k, v] of Object.entries(resolvedContracts)) {
  console.log(`  ${k}=${v}`);
}
if (deploymentBlock !== null) {
  console.log(`  fromBlock=${deploymentBlock}`);
}
console.log();
