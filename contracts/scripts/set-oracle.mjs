#!/usr/bin/env node
// set-oracle.mjs
// Fetches the TEE oracle address from GET /address and writes it into:
//   - contracts/ignition/parameters.<network>.json  (for setOracle Ignition module)
//   - apps/dashboard/.env (or .env.local)           (NEXT_PUBLIC_TEE_VERIFIER_ADDRESS is
//                                                    set separately; oracle addr is for info)
//
// Usage:
//   node contracts/scripts/set-oracle.mjs [network] [oracleUrl]
//   node contracts/scripts/set-oracle.mjs baseSepolia http://localhost:3001
//   node contracts/scripts/set-oracle.mjs base https://<app-id>-3000.dstack.host

import { readFileSync, writeFileSync, existsSync } from "node:fs";
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
params["SetOracle"] = { ...params["SetOracle"], oracleAddress };
writeFileSync(paramsPath, JSON.stringify(params, null, 2) + "\n");
console.log(`✔ Updated ${paramsPath.replace(ROOT + "/", "")}`);

// Update dashboard .env / .env.local
const envPath = join(ROOT, "apps/dashboard/.env");
const envLocalPath = join(ROOT, "apps/dashboard/.env.local");
const targetPath = existsSync(envPath)
  ? envPath
  : existsSync(envLocalPath)
    ? envLocalPath
    : null;

if (targetPath) {
  let existing = readFileSync(targetPath, "utf8");
  const key = "NEXT_PUBLIC_ORACLE_URL";
  const line = `${key}=${oracleUrl}`;
  const regex = new RegExp(`^${key}=.*$`, "m");
  existing = regex.test(existing)
    ? existing.replace(regex, line)
    : existing + `\n${line}`;
  writeFileSync(targetPath, existing);
  console.log(
    `✔ Set ${key}=${oracleUrl} in ${targetPath.replace(ROOT + "/", "")}`,
  );
}

console.log(`\nNext: run   npm run setOracle:${network} --prefix contracts\n`);
