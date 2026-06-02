#!/usr/bin/env node

import "dotenv/config";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const CONTRACTS_ROOT = join(ROOT, "contracts");

const AUTOMATA_DCAP_ADDRESS = "0xaDdeC7e85c2182202b66E331f2a4A0bBB2cEEa1F";

const NETWORKS = {
  local: {
    chainId: "31337",
    name: "local",
    rpcEnv: "LOCAL_RPC_URL",
  },
  baseSepolia: {
    chainId: "84532",
    name: "baseSepolia",
    rpcEnv: "BASE_SEPOLIA_RPC_URL",
  },
  base: {
    chainId: "8453",
    name: "base",
    rpcEnv: "BASE_RPC_URL",
  },
};
const DEPLOYMENT_CONTRACT_KEYS = [
  "agentRegistry",
  "verifier",
  "teeVerifier",
  "validationRegistry",
];

function pickDeploymentContracts(contracts) {
  const picked = {};
  for (const key of DEPLOYMENT_CONTRACT_KEYS) {
    if (typeof contracts[key] === "string") {
      picked[key] = contracts[key];
    }
  }
  return picked;
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`Missing ${name}.`);
    process.exit(1);
  }
  return value;
}

const networkName = requiredEnv("NETWORK");
const network = NETWORKS[networkName];
if (!network) {
  console.error(
    `Unknown NETWORK=${networkName}. Expected one of: ${Object.keys(NETWORKS).join(", ")}`,
  );
  process.exit(1);
}

const mode = requiredEnv("TEE_VERIFIER_MODE");
if (mode !== "real" && mode !== "fakeDcap") {
  console.error("TEE_VERIFIER_MODE must be real or fakeDcap.");
  process.exit(1);
}
if (network.name === "local" && mode !== "fakeDcap") {
  console.error("NETWORK=local always uses TEE_VERIFIER_MODE=fakeDcap.");
  process.exit(1);
}
if (network.name === "base" && mode !== "real") {
  console.error("NETWORK=base only supports TEE_VERIFIER_MODE=real.");
  process.exit(1);
}
function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readArtifact(relativePath) {
  const path = join(CONTRACTS_ROOT, "artifacts", relativePath);
  if (!existsSync(path)) {
    console.error(`Missing artifact: ${path}`);
    console.error("Run: npm run build --prefix contracts");
    process.exit(1);
  }
  return readJson(path);
}

function readIgnitionContracts(chainId) {
  const path = join(
    CONTRACTS_ROOT,
    "ignition/deployments",
    `chain-${chainId}`,
    "deployed_addresses.json",
  );
  if (!existsSync(path)) return {};

  const raw = readJson(path);
  const contracts = {};
  const keyMap = {
    "TeeAgent#AgentRegistry": "agentRegistry",
    "TeeAgent#Verifier": "verifier",
    "TeeAgent#TeeVerifier": "teeVerifier",
    "TeeAgent#ValidationRegistry": "validationRegistry",
  };

  for (const [ignitionKey, contractKey] of Object.entries(keyMap)) {
    if (raw[ignitionKey]) contracts[contractKey] = raw[ignitionKey];
  }

  return contracts;
}

function readDeployments() {
  const path = join(ROOT, "deployments.json");
  return existsSync(path) ? readJson(path) : {};
}

function writeDeployments(deployments) {
  const path = join(ROOT, "deployments.json");
  writeFileSync(path, `${JSON.stringify(deployments, null, 2)}\n`);
}

const deployments = readDeployments();
const existingDeployment = deployments[network.chainId] ?? {};
const ignitionContracts = readIgnitionContracts(network.chainId);
const existingContracts = {
  ...ignitionContracts,
  ...pickDeploymentContracts(existingDeployment.contracts ?? {}),
};

const verifierAddress = existingContracts.verifier;
if (!verifierAddress) {
  console.error(
    "Missing Verifier address. Run a full deployment first.",
  );
  process.exit(1);
}

const rpcUrl = requiredEnv(network.rpcEnv);

const privateKey = requiredEnv("PRIVATE_KEY");

const provider = new ethers.JsonRpcProvider(rpcUrl);
const wallet = new ethers.Wallet(privateKey, provider);

const teeVerifierArtifact = readArtifact(
  "src/verifiers/TeeVerifier.sol/TeeVerifier.json",
);
const verifierArtifact = readArtifact(
  "src/verifiers/Verifier.sol/Verifier.json",
);

let dcapAttestationAddress =
  mode === "real" ? AUTOMATA_DCAP_ADDRESS : undefined;

if (mode === "fakeDcap" && !dcapAttestationAddress) {
  const mockArtifact = readArtifact(
    "src/verifiers/MockDcapAttestation.sol/MockDcapAttestation.json",
  );
  const mockFactory = new ethers.ContractFactory(
    mockArtifact.abi,
    mockArtifact.bytecode,
    wallet,
  );
  console.log(`[replace-tee] deploying MockDcapAttestation on ${network.name}`);
  const mock = await mockFactory.deploy();
  await mock.waitForDeployment();
  dcapAttestationAddress = await mock.getAddress();
  console.log(`[replace-tee] MockDcapAttestation=${dcapAttestationAddress}`);
}

console.log(`[replace-tee] deploying TeeVerifier (${mode}) on ${network.name}`);
console.log(`[replace-tee] DCAP_ATTESTATION=${dcapAttestationAddress}`);

const teeVerifierFactory = new ethers.ContractFactory(
  teeVerifierArtifact.abi,
  teeVerifierArtifact.bytecode,
  wallet,
);
const teeVerifier = await teeVerifierFactory.deploy(
  wallet.address,
  dcapAttestationAddress,
);
await teeVerifier.waitForDeployment();
const teeVerifierAddress = await teeVerifier.getAddress();
const receipt = await teeVerifier.deploymentTransaction()?.wait();
console.log(`[replace-tee] TeeVerifier=${teeVerifierAddress}`);
if (
  receipt?.blockNumber === undefined &&
  existingDeployment.fromBlock === undefined
) {
  console.error("Missing TeeVerifier deployment block number.");
  process.exit(1);
}

const verifier = new ethers.Contract(
  verifierAddress,
  verifierArtifact.abi,
  wallet,
);
console.log(`[replace-tee] updating Verifier ${verifierAddress}`);
const tx = await verifier.updateTeeVerifier(teeVerifierAddress);
await tx.wait();
console.log(`[replace-tee] Verifier.updateTeeVerifier tx=${tx.hash}`);

if (network.name === "local") {
  console.log("[replace-tee] local deployment not written to deployments.json");
} else {
  deployments[network.chainId] = {
    ...existingDeployment,
    name: network.name,
    contracts: {
      ...pickDeploymentContracts(existingContracts),
      verifier: verifierAddress,
      teeVerifier: teeVerifierAddress,
    },
    fromBlock: existingDeployment.fromBlock ?? String(receipt.blockNumber),
  };

  writeDeployments(deployments);
  console.log("[replace-tee] deployments.json updated");
}
