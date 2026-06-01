#!/usr/bin/env node
// setup-env.mjs
// Reads Hardhat Ignition deployed_addresses.json and writes apps/dashboard/.env.local
//
// Usage:
//   node contracts/scripts/setup-env.mjs [chainId]
//   node contracts/scripts/setup-env.mjs 84532   # default Base Sepolia

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

const chainId = process.argv[2] ?? "84532";

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

// Map Ignition module keys → env var names
const KEY_MAP = {
  "TeeAgent#AgentRegistry": "NEXT_PUBLIC_AGENT_REGISTRY_ADDRESS",
  "TeeAgent#ValidationRegistry": "NEXT_PUBLIC_VALIDATION_REGISTRY_ADDRESS",
  "TeeAgent#TeeVerifier": "NEXT_PUBLIC_TEE_VERIFIER_ADDRESS",
};

const resolved = {};
for (const [ignitionKey, envKey] of Object.entries(KEY_MAP)) {
  if (raw[ignitionKey]) {
    resolved[envKey] = raw[ignitionKey];
  }
}

if (Object.keys(resolved).length === 0) {
  console.error(
    "ERROR: No matching contract addresses found in deployed_addresses.json",
  );
  process.exit(1);
}

// Write to .env if it exists, otherwise .env.local
const envPath = join(ROOT, "apps/dashboard/.env");
const envLocalPath = join(ROOT, "apps/dashboard/.env.local");
const targetPath = existsSync(envPath) ? envPath : envLocalPath;

// Read existing file or start fresh
let existing = existsSync(targetPath) ? readFileSync(targetPath, "utf8") : "";

// Upsert each env var
for (const [key, value] of Object.entries(resolved)) {
  const regex = new RegExp(`^${key}=.*$`, "m");
  if (regex.test(existing)) {
    existing = existing.replace(regex, `${key}=${value}`);
  } else {
    existing += `\n${key}=${value}`;
  }
}

const networkByChainId = {
  1: "mainnet",
  8453: "base",
  84532: "baseSepolia",
};
const network = networkByChainId[chainId] ?? "baseSepolia";
const networkRegex = /^NEXT_PUBLIC_NETWORK=.*$/m;
if (networkRegex.test(existing)) {
  existing = existing.replace(networkRegex, `NEXT_PUBLIC_NETWORK=${network}`);
} else {
  existing += `\nNEXT_PUBLIC_NETWORK=${network}`;
}

if (deploymentBlock !== null) {
  const fromBlockRegex = /^AGENT_REGISTRY_FROM_BLOCK=.*$/m;
  if (fromBlockRegex.test(existing)) {
    existing = existing.replace(
      fromBlockRegex,
      `AGENT_REGISTRY_FROM_BLOCK=${deploymentBlock}`,
    );
  } else {
    existing += `\nAGENT_REGISTRY_FROM_BLOCK=${deploymentBlock}`;
  }
}

const targetFile =
  targetPath === envPath ? "apps/dashboard/.env" : "apps/dashboard/.env.local";
writeFileSync(targetPath, existing.trimStart() + "\n");

console.log(`\n✓ Written to ${targetFile} (chain ${chainId})\n`);
for (const [k, v] of Object.entries(resolved)) {
  console.log(`  ${k}=${v}`);
}
console.log();

// Also write AGENT_REGISTRY_ADDRESS to apps/oracle/.env or .env.local
if (resolved.NEXT_PUBLIC_AGENT_REGISTRY_ADDRESS) {
  const oracleEnvPath = join(ROOT, "apps/oracle/.env");
  const oracleEnvLocalPath = join(ROOT, "apps/oracle/.env.local");
  const oracleTargetPath = existsSync(oracleEnvPath)
    ? oracleEnvPath
    : oracleEnvLocalPath;

  let oracleExisting = existsSync(oracleTargetPath)
    ? readFileSync(oracleTargetPath, "utf8")
    : "";

  const oracleKey = "AGENT_REGISTRY_ADDRESS";
  const oracleRegex = new RegExp(`^${oracleKey}=.*$`, "m");
  if (oracleRegex.test(oracleExisting)) {
    oracleExisting = oracleExisting.replace(
      oracleRegex,
      `${oracleKey}=${resolved.NEXT_PUBLIC_AGENT_REGISTRY_ADDRESS}`,
    );
  } else {
    oracleExisting += `\n${oracleKey}=${resolved.NEXT_PUBLIC_AGENT_REGISTRY_ADDRESS}`;
  }

  const oracleTargetFile =
    oracleTargetPath === oracleEnvPath
      ? "apps/oracle/.env"
      : "apps/oracle/.env.local";
  writeFileSync(oracleTargetPath, oracleExisting.trimStart() + "\n");

  console.log(`✓ Written to ${oracleTargetFile} (chain ${chainId})\n`);
  console.log(
    `  AGENT_REGISTRY_ADDRESS=${resolved.NEXT_PUBLIC_AGENT_REGISTRY_ADDRESS}`,
  );
  console.log();
}
