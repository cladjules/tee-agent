#!/usr/bin/env node
// setup-env.mjs
// Reads Hardhat Ignition deployed_addresses.json and writes shared deployment JSON
//
// Usage:
//   node contracts/scripts/setup-env.mjs

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

const deploymentsRoot = join(ROOT, "contracts/ignition/deployments");
const localOracleMode = process.env.LOCAL_ORACLE?.trim();
const arbitrumSepoliaOracleMode = process.env.ARBITRUM_SEPOLIA_ORACLE?.trim();
const LOCAL_DEPLOYMENT_IDS = {
  local: "chain-31337-local-oracle",
};
const ARBITRUM_SEPOLIA_DEPLOYMENT_IDS = {
  local: "arbitrum-sepolia-local-oracle",
  remote: "arbitrum-sepolia-remote-oracle",
};
const selectedLocalDeploymentId = localOracleMode
  ? LOCAL_DEPLOYMENT_IDS[localOracleMode]
  : undefined;
const selectedArbitrumSepoliaDeploymentId = arbitrumSepoliaOracleMode
  ? ARBITRUM_SEPOLIA_DEPLOYMENT_IDS[arbitrumSepoliaOracleMode]
  : undefined;

if (localOracleMode && !Object.hasOwn(LOCAL_DEPLOYMENT_IDS, localOracleMode)) {
  console.error("LOCAL_ORACLE must be local when provided.");
  process.exit(1);
}

if (
  arbitrumSepoliaOracleMode &&
  !Object.hasOwn(ARBITRUM_SEPOLIA_DEPLOYMENT_IDS, arbitrumSepoliaOracleMode)
) {
  console.error(
    "ARBITRUM_SEPOLIA_ORACLE must be local or remote when provided.",
  );
  process.exit(1);
}

const chainNames = {
  31337: "local",
  421614: "arbitrumSepolia",
  8453: "base",
  84532: "arbitrumSepolia",
};

// Map Ignition module keys → shared deployment contract keys
const KEY_MAP = {
  "TeeAgent#AgentRegistry": "agentRegistry",
  "TeeAgent#MockDcapAttestation": "mockDcapAttestation",
  "TeeAgent#TeeVerifier": "teeVerifier",
  "TeeAgent#ValidationRegistry": "validationRegistry",
};

const REQUIRED_KEYS = ["agentRegistry", "teeVerifier", "validationRegistry"];

function parseDeploymentBlock(journalPath) {
  let deploymentBlock = null;
  if (!existsSync(journalPath)) return deploymentBlock;

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
  return deploymentBlock;
}

function parseChainId(journalPath, fallbackChainId) {
  if (!existsSync(journalPath)) return fallbackChainId;

  const lines = readFileSync(journalPath, "utf8").trim().split("\n");
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      const chainId = entry?.chainId;
      if (typeof chainId === "number" || typeof chainId === "string") {
        return String(chainId);
      }
    } catch {}
  }
  return fallbackChainId;
}

function readDeploymentFromPath(deploymentPath, fallbackChainId) {
  const deployedPath = join(deploymentPath, "deployed_addresses.json");
  if (!existsSync(deployedPath)) {
    return null;
  }

  const raw = JSON.parse(readFileSync(deployedPath, "utf8"));
  const resolvedContracts = {};
  for (const [ignitionKey, contractKey] of Object.entries(KEY_MAP)) {
    if (typeof raw[ignitionKey] === "string") {
      resolvedContracts[contractKey] = raw[ignitionKey];
    }
  }
  for (const key of REQUIRED_KEYS) {
    if (typeof resolvedContracts[key] !== "string") {
      throw new Error(
        `Missing required Ignition deployment contract ${key} in ${deployedPath}`,
      );
    }
  }

  const journalPath = join(deploymentPath, "journal.jsonl");
  const chainId = parseChainId(journalPath, fallbackChainId);
  if (!chainId) {
    throw new Error(`Could not determine chain ID for ${deploymentPath}`);
  }
  const deploymentBlock = parseDeploymentBlock(journalPath);

  return { chainId, deployedPath, resolvedContracts, deploymentBlock };
}

function deploymentDirs() {
  if (!existsSync(deploymentsRoot)) return [];
  return readdirSync(deploymentsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function fallbackChainIdForDeploymentId(id) {
  return id.match(/^chain-(\d+)/)?.[1];
}

function readDeploymentId(id) {
  return readDeploymentFromPath(
    join(deploymentsRoot, id),
    fallbackChainIdForDeploymentId(id),
  );
}

function allDeploymentEntries() {
  return deploymentDirs()
    .map((id) => {
      const deployment = readDeploymentId(id);
      return deployment ? { id, ...deployment } : null;
    })
    .filter((entry) => entry !== null);
}

function selectDeployments(entries) {
  let selectedEntries = entries;
  if (selectedLocalDeploymentId) {
    const selected = readDeploymentId(selectedLocalDeploymentId);
    if (!selected) {
      throw new Error(
        `Missing Ignition deployment id: ${selectedLocalDeploymentId}`,
      );
    }
    selectedEntries = [
      ...selectedEntries.filter((entry) => entry.chainId !== "31337"),
      { id: selectedLocalDeploymentId, ...selected },
    ];
  }

  if (selectedArbitrumSepoliaDeploymentId) {
    const selected = readDeploymentId(selectedArbitrumSepoliaDeploymentId);
    if (!selected) {
      throw new Error(
        `Missing Ignition deployment id: ${selectedArbitrumSepoliaDeploymentId}`,
      );
    }
    return [
      ...selectedEntries.filter((entry) => entry.chainId !== "84532"),
      { id: selectedArbitrumSepoliaDeploymentId, ...selected },
    ];
  }

  const hasChainArbitrumSepolia = selectedEntries.some(
    (entry) => entry.chainId === "84532" && entry.id === "chain-84532",
  );
  const arbitrumSepoliaNamed = selectedEntries.filter(
    (entry) =>
      entry.chainId === "84532" &&
      Object.values(ARBITRUM_SEPOLIA_DEPLOYMENT_IDS).includes(entry.id),
  );

  if (!hasChainArbitrumSepolia && arbitrumSepoliaNamed.length > 1) {
    throw new Error(
      "ARBITRUM_SEPOLIA_ORACLE must be local or remote when both Base Sepolia deployment modes exist.",
    );
  }

  return selectedEntries.filter((entry) => {
    if (entry.chainId !== "84532") return true;
    if (entry.id === "chain-84532") return true;
    return !hasChainArbitrumSepolia && arbitrumSepoliaNamed.length === 1;
  });
}

let foundDeployments;
try {
  foundDeployments = selectDeployments(allDeploymentEntries());
} catch (err) {
  console.error(`\nERROR: ${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
}

if (foundDeployments.length === 0) {
  console.error("\nERROR: No Ignition deployments found.\n");
  if (selectedArbitrumSepoliaDeploymentId) {
    console.error(
      `Missing Ignition deployment id: ${selectedArbitrumSepoliaDeploymentId}\n`,
    );
  } else if (selectedLocalDeploymentId) {
    console.error(
      `Missing Ignition deployment id: ${selectedLocalDeploymentId}\n`,
    );
  } else {
    console.error(
      `Run: cd contracts && npx hardhat ignition deploy ignition/modules/... --network <name>\n`,
    );
  }
  process.exit(1);
}

const deploymentsPath = join(ROOT, "deployments.json");
const deployments = existsSync(deploymentsPath)
  ? JSON.parse(readFileSync(deploymentsPath, "utf8"))
  : {};
for (const {
  id,
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
  id,
  chainId,
  resolvedContracts,
  deploymentBlock,
} of foundDeployments) {
  console.log(`  ${chainNames[chainId] ?? chainId} (${chainId})`);
  console.log(`    deploymentId=${id}`);
  if (localOracleMode && chainId === "31337") {
    console.log(`    localOracle=${localOracleMode}`);
  }
  if (arbitrumSepoliaOracleMode) {
    console.log(`    arbitrumSepoliaOracle=${arbitrumSepoliaOracleMode}`);
  }
  for (const [k, v] of Object.entries(resolvedContracts)) {
    console.log(`    ${k}=${v}`);
  }
  if (deploymentBlock !== null) {
    console.log(`    fromBlock=${deploymentBlock}`);
  }
}
console.log();
