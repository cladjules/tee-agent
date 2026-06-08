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
const envPath = path.join(repoRoot, ".env");
const imageStatePath = path.join(repoRoot, ".oracle-image-state.json");
const deploymentsPath = path.join(repoRoot, "deployments.json");
const dockerConfigDir = path.join(repoRoot, ".docker-ghcr");
const dockerConfigPath = path.join(dockerConfigDir, "config.json");
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
  npm run oracle:image [-- --dry-run]

Examples:
  npm run oracle:image

This logs into GHCR, builds apps/oracle/Dockerfile for Phala's linux/amd64
CVMs, pushes the image, and writes the local/Phala state needed for deploy.
`);
}

function tokenInstructions({ missing }) {
  const title = missing
    ? "GHCR token missing from root .env."
    : "Saved GHCR token cannot be used for this GHCR push.";
  console.log(`
${title}

Create a classic PAT here:
  https://github.com/settings/tokens/new?scopes=write:packages,read:packages,repo&description=Tee%20Agent%20GHCR%20push

Required scopes:
  - write:packages
  - read:packages
  - repo (only needed for private repos/packages)

Paste the token here when prompted. The script saves it to root .env as
GHCR_PUSH_PAT, so next time this is just:
  npm run oracle:image
`);
}

function fail(message) {
  console.error(`push-oracle-image: ${message}`);
  usage();
  process.exit(1);
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

function loadRootEnv() {
  if (!existsSync(envPath)) return;
  const contents = readFileSync(envPath, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] === undefined) {
      process.env[key] = decodeEnvValue(rawValue);
    }
  }
}

function encodeEnvValue(value) {
  if (/^[A-Za-z0-9_./:@-]+$/.test(value)) return value;
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function upsertEnvFile(filePath, key, value) {
  const encoded = `${key}=${encodeEnvValue(value)}`;
  const contents = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
  const lines = contents ? contents.split(/\r?\n/) : [];
  let found = false;
  const next = lines.map((line) => {
    if (line.match(new RegExp(`^\\s*${key}\\s*=`))) {
      found = true;
      return encoded;
    }
    return line;
  });
  if (!found) {
    if (next.length > 0 && next.at(-1) !== "") next.push("");
    next.push(encoded);
  }
  writeFileSync(filePath, `${next.join("\n").replace(/\n+$/, "")}\n`, "utf8");
}

function upsertRootEnv(key, value) {
  upsertEnvFile(envPath, key, value);
}

function writeImageState(state, dryRun) {
  const contents = `${JSON.stringify(state, null, 2)}\n`;
  if (dryRun) {
    console.log(
      `Would save image state to ${path.relative(repoRoot, imageStatePath)}.`,
    );
    return;
  }
  writeFileSync(imageStatePath, contents, "utf8");
}

function output(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status !== 0) return undefined;
  return result.stdout.trim() || undefined;
}

function dockerEnv() {
  mkdirSync(dockerConfigDir, { recursive: true });
  if (!existsSync(dockerConfigPath)) {
    writeFileSync(dockerConfigPath, '{"auths":{}}\n', "utf8");
  }
  return { ...process.env, DOCKER_CONFIG: dockerConfigDir };
}

function writeDockerAuthConfig(username, token, dryRun) {
  const auth = Buffer.from(`${username}:${token.trim()}`).toString("base64");
  const config = {
    auths: {
      "ghcr.io": {
        auth,
      },
    },
  };
  console.log(
    `Docker auth config: ${path.relative(repoRoot, dockerConfigPath)}`,
  );
  if (dryRun) return;
  mkdirSync(dockerConfigDir, { recursive: true });
  writeFileSync(dockerConfigPath, `${JSON.stringify(config, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

function run(command, args, options = {}) {
  const rendered = [command, ...args]
    .map((value) => JSON.stringify(value))
    .join(" ");
  console.log(`Command: ${rendered}`);
  if (options.dryRun) return;

  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: command === "docker" ? dockerEnv() : process.env,
    stdio: "inherit",
  });

  if (result.error) {
    console.error(
      `push-oracle-image: failed to start ${command}: ${result.error.message}`,
    );
    process.exit(1);
  }
  if (result.status !== 0) {
    if (command === "docker" && args[0] === "login") {
      console.error(
        "push-oracle-image: GHCR login failed. Create a fresh classic token with write:packages, read:packages, and repo scopes, then run npm run oracle:image again.",
      );
    }
    process.exit(result.status ?? 1);
  }
}

function promptHidden(prompt) {
  const script = [
    `printf ${JSON.stringify(prompt)} > /dev/tty`,
    "stty -echo < /dev/tty",
    "IFS= read -r value < /dev/tty",
    "status=$?",
    "stty echo < /dev/tty",
    "printf '\\n' > /dev/tty",
    "[ $status -eq 0 ] || exit $status",
    "printf '%s' \"$value\"",
  ].join("; ");
  const result = spawnSync("sh", ["-c", script], {
    cwd: repoRoot,
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "inherit"],
  });
  if (result.status !== 0) return undefined;
  return result.stdout.trim() || undefined;
}

function defaultTag() {
  const commit = output("git", ["rev-parse", "--short", "HEAD"]);
  if (!commit) return undefined;
  const timestamp = new Date().toISOString().replaceAll(/\D/g, "").slice(0, 14);
  return `${commit}-${timestamp}`;
}

function fileSha256(filePath) {
  if (!existsSync(filePath)) {
    fail(
      `${path.relative(repoRoot, filePath)} is required before building the oracle image.`,
    );
  }
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function updateHashWithPath(hash, inputPath) {
  if (!existsSync(inputPath)) {
    fail(
      `${path.relative(repoRoot, inputPath)} is required before building the oracle image.`,
    );
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

function localGithubUsername() {
  return output("git", ["config", "--global", "--get", "user.name"]);
}

function validateGhcrName(label, value) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(value)) {
    fail(
      `${label} must be a GitHub username/org/package segment, got "${value}". Run: git config --global user.name <github-username>`,
    );
  }
}

function parseArgs(argv) {
  const result = {
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      result.dryRun = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    }
    fail(`unknown option: ${arg}`);
  }

  return result;
}

function resolveToken(dryRun) {
  const token = process.env.GHCR_PUSH_PAT?.trim();
  if (token) {
    console.log("Loaded GHCR_PUSH_PAT from root .env.");
    return { token, shouldSave: false };
  }
  tokenInstructions({ missing: true });
  if (dryRun) return undefined;
  const pastedToken = promptHidden("Paste GHCR token, then press Enter: ");
  if (!pastedToken) return undefined;
  return { token: pastedToken, shouldSave: true };
}

loadRootEnv();
const args = parseArgs(process.argv.slice(2));
const tag = defaultTag();
if (!tag) fail("could not infer git commit tag.");

const username = localGithubUsername();
if (!username) {
  fail(
    "missing local GitHub username. Run: git config --global user.name <github-username>",
  );
}
validateGhcrName("username", username);

const image = `ghcr.io/${username}/tee-agent-oracle:${tag}`;
const deploymentsSha = fileSha256(deploymentsPath);
const sourceSha = sourceSha256();

const resolvedToken = resolveToken(args.dryRun);
if (!resolvedToken) process.exit(0);
let { token, shouldSave } = resolvedToken;

console.log(`GitHub user:  ${username}`);
console.log(`Oracle image: ${image}`);
console.log(`deployments:  ${deploymentsSha}`);
console.log(`source:       ${sourceSha}`);

writeDockerAuthConfig(username, token, args.dryRun);

if (shouldSave) {
  upsertRootEnv("GHCR_PUSH_PAT", token);
  console.log("Saved GHCR_PUSH_PAT to root .env.");
}
run(
  "docker",
  [
    "build",
    "--platform",
    "linux/amd64",
    "-f",
    "apps/oracle/Dockerfile",
    "--label",
    `xyz.teeagent.deployments-sha=${deploymentsSha}`,
    "--label",
    `xyz.teeagent.source-sha=${sourceSha}`,
    "-t",
    image,
    ".",
  ],
  {
    cwd: repoRoot,
    dryRun: args.dryRun,
  },
);

run("docker", ["push", image], { cwd: repoRoot, dryRun: args.dryRun });

if (args.dryRun) {
  writeImageState(
    {
      image,
      deploymentsSha,
      sourceSha,
      dockerUsername: username,
      dockerRegistry: "ghcr.io",
    },
    true,
  );
  console.log(`Dry run image: ${image}`);
} else {
  writeImageState(
    {
      image,
      deploymentsSha,
      sourceSha,
      dockerUsername: username,
      dockerRegistry: "ghcr.io",
    },
    false,
  );
  console.log(
    `Saved oracle image state to ${path.relative(repoRoot, imageStatePath)}.`,
  );
  console.log(`Pushed image: ${image}`);
}
