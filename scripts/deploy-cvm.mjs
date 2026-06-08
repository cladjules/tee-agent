#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const oracleRoot = path.join(repoRoot, "apps/oracle");
const srcRoot = path.join(oracleRoot, "src");
const distRoot = path.join(oracleRoot, "dist");
const phalaTomlPath = path.join(oracleRoot, "phala.toml");
const composeTemplatePath = path.join(oracleRoot, "docker-compose.yml");
const rootEnvPath = path.join(repoRoot, ".env");
const deploymentsPath = path.join(repoRoot, "deployments.json");
const generatedDir = path.join(oracleRoot, ".phala");
const generatedComposePath = path.join(
  generatedDir,
  "docker-compose.generated.yml",
);
const sourceHashInputs = [
  "package.json",
  "package-lock.json",
  "tsconfig.base.json",
  "apps/oracle/Dockerfile",
  "apps/oracle/package.json",
  "apps/oracle/tsconfig.json",
  "apps/oracle/src",
  "packages/agent/package.json",
  "packages/agent/tsconfig.json",
  "packages/agent/src",
  "packages/server/package.json",
  "packages/server/tsconfig.json",
  "packages/server/src",
];

function usage() {
  console.error(`
Usage:
  npm run oracle:deploy -- <oracle-entry> [--env <file>] [--no-wait] [--dry-run]

Examples:
  npm run oracle:deploy -- src/examples/prediction-market.ts
`);
}

function fail(message, { showUsage = false } = {}) {
  console.error(`deploy-cvm: ${message}`);
  if (showUsage) usage();
  process.exit(1);
}

function failMissingEntry() {
  console.error("deploy-cvm: oracle entry path is required.");
  console.error("");
  console.error("Run one of:");
  console.error("  npm run oracle:deploy -- src/examples/prediction-market.ts");
  console.error("  npm run oracle:deploy -- src/examples/web-data-oracle.ts");
  console.error("");
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
      if (!value) fail("--env requires a file path.", { showUsage: true });
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
    if (arg.startsWith("--"))
      fail(`unknown option: ${arg}`, { showUsage: true });
    if (result.entry)
      fail("only one oracle entry path can be provided.", { showUsage: true });
    result.entry = arg;
  }

  if (!result.entry) failMissingEntry();
  return result;
}

function stripDotSlash(value) {
  return value.replace(/^\.?\//, "");
}

function toEntryPath(input) {
  const normalizedInput = stripDotSlash(input.trim());
  if (!normalizedInput)
    fail("oracle entry path is required.", { showUsage: true });

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
    distEntry = path.relative(
      distRoot,
      path.resolve(oracleRoot, normalizedInput),
    );
    sourcePath = path.join(srcRoot, distEntry).replace(/\.[cm]?js$/, ".ts");
  } else if (/\.[cm]?ts$/.test(normalizedInput)) {
    sourcePath = path.resolve(srcRoot, normalizedInput);
    distEntry = path.relative(srcRoot, sourcePath);
  } else if (/\.[cm]?js$/.test(normalizedInput)) {
    distEntry = normalizedInput;
    sourcePath = path.join(srcRoot, distEntry).replace(/\.[cm]?js$/, ".ts");
  } else {
    fail("oracle entry must be a .ts source path or compiled .js entry path.", {
      showUsage: true,
    });
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

function hasLinkedPhalaCvm() {
  if (!existsSync(phalaTomlPath)) return false;
  const contents = readFileSync(phalaTomlPath, "utf8");
  return /^\s*(app_id|name)\s*=\s*["']?[^"'\s#]+/m.test(contents);
}

function getLinkedPhalaCvmId() {
  if (!existsSync(phalaTomlPath)) return undefined;
  const contents = readFileSync(phalaTomlPath, "utf8");
  const appId = contents.match(/^\s*app_id\s*=\s*["']?([^"'\s#]+)/m)?.[1];
  const name = contents.match(/^\s*name\s*=\s*["']?([^"'\s#]+)/m)?.[1];
  return appId ?? name;
}

function removeLinkedPhalaCvm() {
  if (!existsSync(phalaTomlPath)) return;
  const contents = readFileSync(phalaTomlPath, "utf8");
  const next = contents
    .split("\n")
    .filter((line) => !/^\s*(app_id|name)\s*=/.test(line))
    .join("\n");
  writeFileSync(phalaTomlPath, next, "utf8");
}

function runPhalaDeploy() {
  const result = spawnSync("phala", phalaArgs, {
    cwd: oracleRoot,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 20 * 1024 * 1024,
    stdio: ["inherit", "pipe", "pipe"],
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  return result;
}

function runPhalaLink() {
  const result = spawnSync("phala", ["link"], {
    cwd: oracleRoot,
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    console.error(
      `deploy-cvm: failed to start phala link: ${result.error.message}`,
    );
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function getLinkedPhalaCvmStatus(cvmId) {
  return getLinkedPhalaCvmInfo(cvmId)?.status;
}

function getLinkedPhalaCvmInfo(cvmId) {
  const result = spawnSync("phala", ["cvms", "get", cvmId, "--json"], {
    cwd: oracleRoot,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 20 * 1024 * 1024,
    stdio: ["inherit", "pipe", "pipe"],
  });

  if (result.status !== 0) return undefined;

  try {
    return JSON.parse(result.stdout);
  } catch {
    return undefined;
  }
}

function getCvmIngress(info) {
  const endpoint = info?.endpoints?.[0]?.app;
  return typeof endpoint === "string" && endpoint.trim()
    ? endpoint.trim()
    : undefined;
}

function getCvmDisplayId(info, fallback) {
  const appId = info?.app_id;
  if (typeof appId === "string" && appId.trim()) return appId.trim();
  const id = info?.id;
  if (typeof id === "string" && id.trim()) return id.trim();
  return fallback;
}

function printLinkedPhalaCvmIngress(cvmId = getLinkedPhalaCvmId()) {
  if (!cvmId) return;
  const info = getLinkedPhalaCvmInfo(cvmId);
  const displayId = getCvmDisplayId(info, cvmId);
  const ingress = getCvmIngress(info);
  if (ingress) {
    console.log(`deploy-cvm: oracle URL: ${ingress}`);
    return;
  }
  console.log(
    `deploy-cvm: oracle URL not ready; inspect with: npx phala cvms get ${displayId}`,
  );
}

function printLinkedPhalaCvmCommand() {
  const cvmId = getLinkedPhalaCvmId();
  if (!cvmId) return;
  const info = getLinkedPhalaCvmInfo(cvmId);
  const displayId = getCvmDisplayId(info, cvmId);
  const ingress = getCvmIngress(info);
  if (ingress) {
    console.log(`deploy-cvm: oracle URL: ${ingress}`);
    return;
  }
  console.log(
    `deploy-cvm: inspect the CVM with: npx phala cvms get ${displayId}`,
  );
}

function startLinkedPhalaCvmIfStopped() {
  const cvmId = getLinkedPhalaCvmId();
  if (!cvmId) return;

  const status = getLinkedPhalaCvmStatus(cvmId);
  if (status !== "stopped") return;

  console.log(`deploy-cvm: linked CVM ${cvmId} is stopped; starting it.`);
  const result = spawnSync("phala", ["cvms", "start", cvmId], {
    cwd: oracleRoot,
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    console.error(
      `deploy-cvm: failed to start linked CVM ${cvmId}: ${result.error.message}`,
    );
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function isMissingCvmError(result) {
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  return /requested\s+CVM\s+was\s+not\s+found|CVM\s+was\s+not\s+found|CVM.*not\s+found/i.test(
    output,
  );
}

function writeGeneratedCompose(image) {
  const template = readFileSync(composeTemplatePath, "utf8");
  const compose = template.replace(/\$\{ORACLE_IMAGE(?::[^}]*)?\}/g, image);
  mkdirSync(generatedDir, { recursive: true });
  writeFileSync(generatedComposePath, compose, "utf8");
  return generatedComposePath;
}

function decodeEnvValue(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function loadRootEnv({ override = false } = {}) {
  if (!existsSync(rootEnvPath)) return;
  const contents = readFileSync(rootEnvPath, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (override || process.env[key] === undefined) {
      process.env[key] = decodeEnvValue(rawValue);
    }
  }
}

function fileSha256(filePath) {
  if (!existsSync(filePath)) {
    fail(`${path.relative(repoRoot, filePath)} is required.`);
  }
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function updateHashWithPath(hash, inputPath) {
  if (!existsSync(inputPath)) {
    fail(`${path.relative(repoRoot, inputPath)} is required.`);
  }

  const stats = statSync(inputPath);
  const relativePath = path
    .relative(repoRoot, inputPath)
    .replaceAll(path.sep, "/");
  if (stats.isDirectory()) {
    hash.update(`dir:${relativePath}\n`);
    for (const entry of readdirSync(inputPath).sort()) {
      updateHashWithPath(hash, path.join(inputPath, entry));
    }
    return;
  }

  if (!stats.isFile()) return;
  hash.update(`file:${relativePath}:${stats.size}\n`);
  hash.update(readFileSync(inputPath));
  hash.update("\n");
}

function sourceSha256() {
  const hash = createHash("sha256");
  for (const input of sourceHashInputs) {
    updateHashWithPath(hash, path.join(repoRoot, input));
  }
  return hash.digest("hex");
}

function runOracleImageBuild(dryRun) {
  console.log("deploy-cvm: oracle image is missing or stale; building it now.");
  const result = spawnSync(
    process.execPath,
    ["scripts/push-oracle-image.mjs", ...(dryRun ? ["--dry-run"] : [])],
    {
      cwd: repoRoot,
      env: process.env,
      stdio: "inherit",
    },
  );

  if (result.error) {
    console.error(
      `deploy-cvm: failed to start oracle image build: ${result.error.message}`,
    );
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function ensureFreshOracleImage(dryRun) {
  const currentDeploymentsSha = fileSha256(deploymentsPath);
  const currentSourceSha = sourceSha256();
  const oracleImage = process.env.ORACLE_IMAGE?.trim();
  const imageDeploymentsSha = process.env.ORACLE_DEPLOYMENTS_SHA?.trim();
  const imageSourceSha = process.env.ORACLE_IMAGE_SOURCE_SHA?.trim();

  if (
    oracleImage &&
    imageDeploymentsSha === currentDeploymentsSha &&
    imageSourceSha === currentSourceSha
  ) {
    return {
      oracleImage,
      deploymentsSha: currentDeploymentsSha,
      sourceSha: currentSourceSha,
    };
  }

  if (
    oracleImage &&
    imageDeploymentsSha &&
    imageDeploymentsSha !== currentDeploymentsSha
  ) {
    console.warn(
      `deploy-cvm: saved oracle image was built with deployments.json sha ${imageDeploymentsSha}, but current deployments.json is ${currentDeploymentsSha}.`,
    );
  }
  if (oracleImage && imageSourceSha) {
    console.warn(
      `deploy-cvm: saved oracle image was built with source sha ${imageSourceSha}, but current source sha is ${currentSourceSha}.`,
    );
  } else if (oracleImage) {
    console.warn(
      "deploy-cvm: saved oracle image has no source sha; rebuilding to avoid stale oracle code.",
    );
  }

  runOracleImageBuild(dryRun);
  if (dryRun) {
    return {
      oracleImage: "<fresh image built during deploy>",
      deploymentsSha: currentDeploymentsSha,
      sourceSha: currentSourceSha,
    };
  }

  loadRootEnv({ override: true });
  const refreshedOracleImage = process.env.ORACLE_IMAGE?.trim();
  const refreshedDeploymentsSha = process.env.ORACLE_DEPLOYMENTS_SHA?.trim();
  const refreshedSourceSha = process.env.ORACLE_IMAGE_SOURCE_SHA?.trim();
  if (!refreshedOracleImage) {
    fail(
      "oracle image build finished without saving ORACLE_IMAGE to root .env.",
    );
  }
  if (refreshedDeploymentsSha !== currentDeploymentsSha) {
    fail(
      `oracle image build finished with deployments.json sha ${refreshedDeploymentsSha ?? "<missing>"}, but current deployments.json is ${currentDeploymentsSha}.`,
    );
  }
  if (refreshedSourceSha !== currentSourceSha) {
    fail(
      `oracle image build finished with source sha ${refreshedSourceSha ?? "<missing>"}, but current source sha is ${currentSourceSha}.`,
    );
  }

  return {
    oracleImage: refreshedOracleImage,
    deploymentsSha: currentDeploymentsSha,
    sourceSha: currentSourceSha,
  };
}

loadRootEnv();
const args = parseArgs(process.argv.slice(2));
const { oracleImage, deploymentsSha, sourceSha } = ensureFreshOracleImage(
  args.dryRun,
);
const envPath = path.isAbsolute(args.envFile)
  ? args.envFile
  : path.resolve(oracleRoot, args.envFile);
if (!existsSync(envPath)) {
  fail(`env file does not exist: ${envPath}`);
}

const { sourcePath, distEntry } = toEntryPath(args.entry);
const composePath = path.relative(oracleRoot, generatedComposePath);
const phalaArgs = [
  "deploy",
  "-c",
  generatedComposePath,
  "-e",
  rootEnvPath,
  "-e",
  envPath,
  "-e",
  `ORACLE_ENTRY=${distEntry}`,
  ...args.passthrough,
];
if (args.wait) phalaArgs.push("--wait");

console.log(`Oracle name: ${process.env.APP_NAME}`);
console.log(`Oracle source: ${path.relative(oracleRoot, sourcePath)}`);
console.log(`CVM entry:     dist/${distEntry}`);
console.log(`Oracle image:  ${oracleImage}`);
console.log(`deployments:   ${deploymentsSha}`);
console.log(`source:        ${sourceSha}`);
console.log(`Compose file:  ${composePath}`);
console.log(`Root env file: ${path.relative(repoRoot, rootEnvPath)}`);
console.log(`Oracle env:    ${path.relative(repoRoot, envPath)}`);
console.log(
  `Command:       phala ${phalaArgs.map((v) => JSON.stringify(v)).join(" ")}`,
);

if (args.dryRun) process.exit(0);

writeGeneratedCompose(oracleImage);

let result = runPhalaDeploy();

if (result.error) {
  console.error(`deploy-cvm: failed to start phala: ${result.error.message}`);
  process.exit(1);
}
if (result.status !== 0) {
  if (hasLinkedPhalaCvm() && isMissingCvmError(result)) {
    console.warn(
      "deploy-cvm: linked CVM was not found; removing stale CVM identity and creating a new CVM.",
    );
    removeLinkedPhalaCvm();
    result = runPhalaDeploy();
    if (result.error) {
      console.error(
        `deploy-cvm: failed to start phala: ${result.error.message}`,
      );
      process.exit(1);
    }
  }

  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (hasLinkedPhalaCvm()) {
  startLinkedPhalaCvmIfStopped();
  printLinkedPhalaCvmIngress();
  console.log(
    "deploy-cvm: phala.toml already has a CVM identity; skipping phala link.",
  );
  process.exit(0);
}

console.log("deploy-cvm: phala.toml has no CVM identity; running phala link.");
runPhalaLink();

console.log(
  "deploy-cvm: phala link complete; initial CVM deploy is already in progress.",
);
console.log(
  "deploy-cvm: wait for the CVM to finish processing before running deploy again.",
);
printLinkedPhalaCvmCommand();
process.exit(0);
