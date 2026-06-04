#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const oracleRoot = path.resolve(__dirname, "..");
const srcRoot = path.join(oracleRoot, "src");
const distRoot = path.join(oracleRoot, "dist");

function usage() {
  console.error(`
Usage:
  npm run deploy -- <oracle-entry> [--env <file>] [--no-wait] [--dry-run]

Examples:
  npm run deploy -- src/examples/prediction-market.ts
  npm run deploy -- examples/prediction-market.js
  npm run deploy -- /absolute/path/to/apps/oracle/src/examples/web-data-oracle.ts

The entry must point to a file under apps/oracle/src. It is compiled into dist
inside the CVM image and passed to Phala as ORACLE_ENTRY.
`);
}

function fail(message) {
  console.error(`deploy-cvm: ${message}`);
  usage();
  process.exit(1);
}

function parseArgs(argv) {
  const result = {
    entry: undefined,
    envFile: ".env",
    wait: true,
    dryRun: false,
    passthrough: [],
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") {
      result.passthrough.push(...argv.slice(i + 1));
      break;
    }
    if (arg === "--env") {
      const value = argv[++i];
      if (!value) fail("--env requires a file path.");
      result.envFile = value;
      continue;
    }
    if (arg === "--no-wait") {
      result.wait = false;
      continue;
    }
    if (arg === "--dry-run") {
      result.dryRun = true;
      continue;
    }
    if (arg.startsWith("--")) fail(`unknown option: ${arg}`);
    if (result.entry) fail("only one oracle entry path can be provided.");
    result.entry = arg;
  }

  if (!result.entry) fail("oracle entry path is required.");
  return result;
}

function stripDotSlash(value) {
  return value.replace(/^\.?\//, "");
}

function toEntryPath(input) {
  const normalizedInput = stripDotSlash(input.trim());
  if (!normalizedInput) fail("oracle entry path is required.");

  const absoluteInput = path.isAbsolute(normalizedInput)
    ? normalizedInput
    : path.resolve(oracleRoot, normalizedInput);

  let sourcePath;
  let distEntry;

  if (absoluteInput.startsWith(`${srcRoot}${path.sep}`)) {
    sourcePath = absoluteInput;
    distEntry = path.relative(srcRoot, absoluteInput);
  } else if (absoluteInput.startsWith(`${distRoot}${path.sep}`)) {
    distEntry = path.relative(distRoot, absoluteInput);
    sourcePath = path.join(srcRoot, distEntry).replace(/\.[cm]?js$/, ".ts");
  } else if (normalizedInput.startsWith("src/")) {
    sourcePath = path.resolve(oracleRoot, normalizedInput);
    distEntry = path.relative(srcRoot, sourcePath);
  } else if (normalizedInput.startsWith("dist/")) {
    distEntry = path.relative(distRoot, path.resolve(oracleRoot, normalizedInput));
    sourcePath = path.join(srcRoot, distEntry).replace(/\.[cm]?js$/, ".ts");
  } else if (/\.[cm]?ts$/.test(normalizedInput)) {
    sourcePath = path.resolve(srcRoot, normalizedInput);
    distEntry = path.relative(srcRoot, sourcePath);
  } else if (/\.[cm]?js$/.test(normalizedInput)) {
    distEntry = normalizedInput;
    sourcePath = path.join(srcRoot, distEntry).replace(/\.[cm]?js$/, ".ts");
  } else {
    fail("oracle entry must be a .ts source path or compiled .js entry path.");
  }

  const relativeSource = path.relative(srcRoot, sourcePath);
  if (relativeSource.startsWith("..") || path.isAbsolute(relativeSource)) {
    fail("oracle entry must resolve inside apps/oracle/src.");
  }
  if (!existsSync(sourcePath)) {
    fail(`oracle source file does not exist: ${sourcePath}`);
  }

  distEntry = distEntry.replace(/\.[cm]?ts$/, ".js").replaceAll(path.sep, "/");
  if (distEntry.startsWith("../") || path.isAbsolute(distEntry)) {
    fail("compiled oracle entry must stay inside apps/oracle/dist.");
  }

  return { sourcePath, distEntry };
}

const args = parseArgs(process.argv.slice(2));
const envPath = path.isAbsolute(args.envFile)
  ? args.envFile
  : path.resolve(oracleRoot, args.envFile);
if (!existsSync(envPath)) {
  fail(`env file does not exist: ${envPath}`);
}

const { sourcePath, distEntry } = toEntryPath(args.entry);
const phalaArgs = [
  "deploy",
  "-e",
  envPath,
  "-e",
  `ORACLE_ENTRY=${distEntry}`,
  ...args.passthrough,
];
if (args.wait) phalaArgs.push("--wait");

console.log(`Oracle source: ${path.relative(oracleRoot, sourcePath)}`);
console.log(`CVM entry:     dist/${distEntry}`);
console.log(`Env file:      ${path.relative(oracleRoot, envPath)}`);
console.log(`Command:       phala ${phalaArgs.map((v) => JSON.stringify(v)).join(" ")}`);

if (args.dryRun) process.exit(0);

const result = spawnSync("phala", phalaArgs, {
  cwd: oracleRoot,
  stdio: "inherit",
  env: process.env,
});

if (result.error) {
  console.error(`deploy-cvm: failed to start phala: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
