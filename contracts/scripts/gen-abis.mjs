#!/usr/bin/env node
// Regenerates ABI JSON files from compiled Hardhat artifacts.
// Run after `hardhat compile`: node contracts/scripts/gen-abis.mjs
//
// Writes:
//   packages/agent/src/abis/AgentRegistry.json
//   packages/agent/src/abis/TEEVerifier.json
//   packages/agent/src/abis/ValidationRegistry.json
//
// NOTE: packages/agent/src/abis/ReputationRegistry.json is NOT generated here.
//       It is the official ERC-8004 ABI from https://github.com/erc-8004/erc-8004-contracts
//       and must be updated manually when the upstream contract changes.
//
// packages/agent/src/abis.ts imports these JSON files directly — no code-gen needed.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const artifactsDir = resolve(__dirname, "../artifacts/src");
const abisDir = resolve(__dirname, "../../packages/agent/src/abis");

function readArtifactAbi(contractPath) {
  const json = JSON.parse(
    readFileSync(resolve(artifactsDir, contractPath), "utf8"),
  );
  return json.abi;
}

const contracts = [
  {
    artifact: "AgentRegistry.sol/AgentRegistry.json",
    out: "AgentRegistry.json",
  },
  {
    artifact: "verifiers/TeeVerifier.sol/TeeVerifier.json",
    out: "TEEVerifier.json",
  },
  {
    artifact: "ValidationRegistry.sol/ValidationRegistry.json",
    out: "ValidationRegistry.json",
  },
];

for (const { artifact, out } of contracts) {
  const abi = readArtifactAbi(artifact);
  const outPath = resolve(abisDir, out);
  writeFileSync(outPath, JSON.stringify(abi, null, 2) + "\n", "utf8");
  console.log(`Written: ${outPath}`);
}
