#!/usr/bin/env node
// set-oracle.mjs
// Fetches the TEE oracle address from GET /address and writes it into:
//   - contracts/ignition/parameters.<network>.json  (TeeAgent.oracleAddress — used at deploy
//                                                    time and by the SetOracle module for updates)
//
// Usage:
//   node contracts/scripts/set-oracle.mjs [network] [oracleUrl]
//   node contracts/scripts/set-oracle.mjs baseSepolia http://localhost:3001
//   node contracts/scripts/set-oracle.mjs base https://<app-id>-3000.dstack.host

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

const network = process.argv[2] ?? "baseSepolia";
const oracleUrl = (process.argv[3] ?? "http://localhost:3001").replace(
  /\/$/,
  "",
);

const PARAMS_FILE = {
  baseSepolia: join(ROOT, "contracts/ignition/parameters.baseSepolia.json"),
  base: join(ROOT, "contracts/ignition/parameters.base.json"),
};

const paramsPath = PARAMS_FILE[network];
if (!paramsPath) {
  console.error(`Unknown network "${network}". Use baseSepolia or base.`);
  process.exit(1);
}

console.log(`Fetching oracle address from ${oracleUrl}/address …`);
let oracleAddress;
try {
  const res = await fetch(`${oracleUrl}/address`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  ({ address: oracleAddress } = await res.json());
  if (!oracleAddress) throw new Error("Response missing 'address' field");
} catch (err) {
  console.error(`\nERROR: Could not reach oracle at ${oracleUrl}/address`);
  console.error(`  ${err.message}`);
  console.error(`\nMake sure the oracle is running:`);
  console.error(`  npm run dev:prediction-market --prefix apps/oracle\n`);
  process.exit(1);
}

console.log(`Oracle address: ${oracleAddress}`);

// Update parameters JSON
const params = JSON.parse(readFileSync(paramsPath, "utf8"));
params["TeeAgent"] = { ...params["TeeAgent"], oracleAddress };
writeFileSync(paramsPath, JSON.stringify(params, null, 2) + "\n");
console.log(`✔ Updated ${paramsPath.replace(ROOT + "/", "")}`);

console.log(
  `\nNext: redeploy or run   npm run setOracle:${network} --prefix contracts\n`,
);
