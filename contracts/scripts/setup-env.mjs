#!/usr/bin/env node
// setup-env.mjs
// Reads Hardhat Ignition deployed_addresses.json and writes shared deployment JSON
//
// Usage:
//   node contracts/scripts/setup-env.mjs

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

const SUPPORTED_CHAIN_IDS = ["8453", "84532"];

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
function readDeployment(chainId) {
  const deployedPath = join(
    ROOT,
    "contracts/ignition/deployments",
    `chain-${chainId}`,
    "deployed_addresses.json",
  );

  if (!existsSync(deployedPath)) {
    return null;
  }

  const raw = JSON.parse(readFileSync(deployedPath, "utf8"));
  const resolvedContracts = {};
  for (const [ignitionKey, contractKey] of Object.entries(KEY_MAP)) {
    if (typeof raw[ignitionKey] !== "string") {
      throw new Error(
        `Missing required Ignition deployment key ${ignitionKey} for chain ${chainId}`,
      );
    }
    resolvedContracts[contractKey] = raw[ignitionKey];
  }

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

  return { chainId, deployedPath, resolvedContracts, deploymentBlock };
}

const foundDeployments = SUPPORTED_CHAIN_IDS.map((chainId) =>
  readDeployment(chainId),
).filter((deployment) => deployment !== null);

if (foundDeployments.length === 0) {
  console.error("\nERROR: No supported deployments found.\n");
  console.error(
    `Run: cd contracts && npx hardhat ignition deploy ignition/modules/... --network <name>\n`,
  );
  process.exit(1);
}

const deploymentsPath = join(ROOT, "deployments.json");
const deployments = existsSync(deploymentsPath)
  ? JSON.parse(readFileSync(deploymentsPath, "utf8"))
  : {};
for (const {
  chainId,
  resolvedContracts,
  deploymentBlock,
} of foundDeployments) {
  const existingDeployment = deployments[chainId] ?? {};
  const nextDeployment = {
    ...existingDeployment,
    name: chainNames[chainId] ?? existingDeployment.name,
    contracts: resolvedContracts,
  };
  if (deploymentBlock !== null) {
    nextDeployment.fromBlock = String(deploymentBlock);
  }

  deployments[chainId] = nextDeployment;
}

writeFileSync(deploymentsPath, `${JSON.stringify(deployments, null, 2)}\n`);

console.log(
  `\n✓ Written to deployments.json (${foundDeployments.length} chain${
    foundDeployments.length === 1 ? "" : "s"
  })\n`,
);
for (const {
  chainId,
  resolvedContracts,
  deploymentBlock,
} of foundDeployments) {
  console.log(`  ${chainNames[chainId] ?? chainId} (${chainId})`);
  for (const [k, v] of Object.entries(resolvedContracts)) {
    console.log(`    ${k}=${v}`);
  }
  if (deploymentBlock !== null) {
    console.log(`    fromBlock=${deploymentBlock}`);
  }
}
console.log();
