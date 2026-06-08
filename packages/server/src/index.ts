/**
 * Oracle server factory — Tee Agent
 * ─────────────────────────────────────────────────────────────────────────────
 * Call `startOracle({ handler })` to start an oracle server with your own
 * agent handler. The handler receives all decrypted blobs from 0G Storage
 * and the caller's payload, then returns a TEE-signed result.
 *
 * The oracle handles all infrastructure:
 *   - TEE key derivation via Phala dstack SDK
 *   - On-chain agentId → blob URI resolution (AgentRegistry)
 *   - 0G Storage download + ECIES-unwrap + AES-256-GCM decrypt
 *   - ECDSA signing of results (TEE-attested)
 *   - NFT transfer re-encryption (/reencrypt)
 *   - Validation scoring + on-chain response submission (/validate)
 *
 * Validation proofs:
 *   - The oracle submits a raw TDX DCAP quote as proof.
 *   - The commitment keccak256(agentId ‖ requestHash ‖ score) is embedded in
 *     reportData[0:32] so TeeVerifier can verify the exact validation result.
 *   - Development deployments can use MockDcapAttestation; validation still
 *     uses quote proofs.
 *
 * Example:
 * ```typescript
 * import { startOracle } from '@tee-agent/server'
 *
 * await startOracle({
 *   name: 'my-agent',
 *   handler: {
 *     async run(payload, ctx) {
 *       // ctx.blobs[0] = decrypted SKILL.md markdown string
 *       // ctx.blobs[1] = decrypted agent config object
 *       // payload      = caller-supplied input
 *       return { answer: 42 }
 *     }
 *   }
 * })
 * ```
 */

import express, { type Request, type Response } from "express";
import cors from "cors";
import { TappdClient, TdxQuoteResponse } from "@phala/dstack-sdk";
import { encrypt } from "eciesjs";
import { ethers } from "ethers";
import { z } from "zod";
import {
  decryptContentKey,
  decryptMetadata,
  hashEncryptedBlob,
  readJsonFromUri,
} from "@tee-agent/agent/encryption";
import type { EncryptedBlob } from "@tee-agent/agent/types";
import {
  REENCRYPT_REQUEST_TYPES,
  RUN_REQUEST_TYPES,
  VALIDATE_REQUEST_TYPES,
} from "@tee-agent/agent/typed-data";
import {
  AGENT_REGISTRY_ABI,
  TEE_VERIFIER_ABI,
  VALIDATION_REGISTRY_ABI,
} from "@tee-agent/agent/abis";
import { getNetworkConfig } from "@tee-agent/agent/network";
import {
  getNetworkDeploymentByChainId,
  type RawDeployments,
} from "@tee-agent/agent/config";
import { scoreWithLLM } from "./llm-scorer.js";

// ─── Request schemas ────────────────────────────────────────────────────────────

const reEncryptBodySchema = z
  .object({
    tokenId: z.string(),
    from: z.string(),
    to: z.string(),
    chainId: z.number().int().positive(),
    verifierAddress: z.string(),
    registryAddress: z.string(),
    deadline: z.number().int().positive(),
    intelligentDataHashes: z.array(z.string()),
    blobUris: z.array(z.string()).min(1, "blobUris must be a non-empty array."),
    targetPubkey: z.string(),
    signature: z.string(),
  })
  .refine(
    (b) => b.intelligentDataHashes.length === b.blobUris.length,
    "intelligentDataHashes and blobUris must have the same length.",
  );

type ReEncryptBody = z.infer<typeof reEncryptBodySchema>;

const verifyBodySchema = z.object({
  quote: z.string().startsWith("0x"),
  event_log: z.string(),
});

const validateRequestBodySchema = z.object({
  requestHash: z.string(),
  /**
   * ERC-8004 Identity Registry agent ID — used for ownership check, EIP-712 verification,
   * and TDX attestation commitment. Must match record.agentId in ValidationRegistry.
   */
  erc8004AgentId: z.union([z.string(), z.number()]),
  /** The claim / input to validate — oracle runs the skill handler on this. */
  payload: z.record(z.string(), z.unknown()),
  validationRegistryAddress: z.string(),
  responseURI: z.string().optional().default(""),
  responseHash: z.string().optional().default(ethers.ZeroHash),
  tag: z.string().optional().default(""),
  signature: z.string(),
  deadline: z.number().int().positive(),
});

const runBodySchema = z.object({
  agentId: z.union([z.string(), z.number()]),
  registryAddress: z.string().optional(),
  payload: z.record(z.string(), z.unknown()),
  signature: z.string(),
  deadline: z.number().int().positive(),
});

type NormalizedTdxQuoteResponse = Omit<TdxQuoteResponse, "quote"> & {
  quote: `0x${string}`;
};

function normalizeHexBytes(
  value: string | Uint8Array,
  label: string,
): `0x${string}` {
  const hex =
    typeof value === "string"
      ? value.trim().replace(/^0x/i, "")
      : ethers.hexlify(value).slice(2);
  const prefixed = `0x${hex}` as `0x${string}`;
  if (!ethers.isHexString(prefixed)) {
    throw new Error(`${label} must be hex bytes.`);
  }
  return prefixed;
}

function normalizeHexStringIfNeeded(value: string): string {
  const trimmed = value.trim();
  const unprefixed = trimmed.replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]+$/.test(unprefixed)) return value;
  return `0x${unprefixed}`;
}

function normalizeTdxQuoteResult(
  quoteResult: TdxQuoteResponse,
): NormalizedTdxQuoteResponse {
  return {
    ...quoteResult,
    quote: normalizeHexBytes(quoteResult.quote, "TDX quote"),
    event_log:
      typeof quoteResult.event_log === "string"
        ? normalizeHexStringIfNeeded(quoteResult.event_log)
        : quoteResult.event_log,
  };
}

function revertData(err: unknown): string | undefined {
  const data = (err as { data?: unknown })?.data;
  if (typeof data === "string") return data;
  const nested = (err as { info?: { error?: { data?: unknown } } })?.info?.error
    ?.data;
  return typeof nested === "string" ? nested : undefined;
}

function tryDecodeUtf8(value: string): string | undefined {
  try {
    const decoded = ethers.toUtf8String(value);
    return decoded.trim() || undefined;
  } catch {
    return undefined;
  }
}

function shorten(value: string, max = 180): string {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function formatErrorArg(value: unknown, type?: string): string {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") {
    if (type === "bytes") {
      const decoded = tryDecodeUtf8(value);
      return decoded ? JSON.stringify(shorten(decoded)) : shorten(value);
    }
    return shorten(value);
  }
  return String(value);
}

function describeParsedContractError(parsed: ethers.ErrorDescription): string {
  const args = parsed.args
    .toArray()
    .map((arg, index) =>
      formatErrorArg(arg, parsed.fragment.inputs[index]?.type),
    );
  return `contract reverted: ${parsed.name}${
    args.length ? `(${args.join(", ")})` : ""
  }`;
}

function describeContractError(
  err: unknown,
  contractInterface?: ethers.Interface,
): string {
  const data = revertData(err);

  if (data && contractInterface) {
    try {
      const parsed = contractInterface.parseError(data);
      if (parsed) return describeParsedContractError(parsed);
    } catch {
      // Fall through to selector and generic error handling.
    }
  }

  if (data) {
    return `contract reverted with selector ${data.slice(0, 10)}`;
  }

  const shortMessage = (err as { shortMessage?: unknown })?.shortMessage;
  if (typeof shortMessage === "string") return shortMessage;
  return err instanceof Error ? err.message : String(err);
}

async function submitContractTx(
  label: string,
  contractInterface: ethers.Interface,
  send: () => Promise<ethers.ContractTransactionResponse>,
): Promise<ethers.ContractTransactionResponse> {
  try {
    return await send();
  } catch (err) {
    const described = describeContractError(err, contractInterface);
    const dcapAdvice =
      label === "initValidator" &&
      described.includes('DcapVerificationFailed("QEIDVE")')
        ? " Automata rejected the QE identity collateral. Redeploy the remote TeeVerifier contract set with Automata standard/current collateral, then rebuild and redeploy the oracle image."
        : label === "initValidator" &&
            described.includes('DcapVerificationFailed("TCBR")')
          ? " Automata rejected this TDX quote because the platform or TDX module TCB status is revoked or missing in the selected collateral set. If the TeeVerifier already uses DCAP_TCB_EVALUATION_DATA_NUMBER=0, redeploy the Phala CVM onto an updated TDX host; redeploying the same contract set will not change this."
          : "";
    throw new Error(`${label} failed: ${described}.${dcapAdvice}`);
  }
}

// ─── Public types ─────────────────────────────────────────────────────────────

export interface HandlerContext {
  /** TEE-derived wallet — use wallet.address as the verifiable signer */
  wallet: ethers.Wallet;
  /** Raw signing key — use signingKey.sign(digest) for low-level signing */
  signingKey: ethers.SigningKey;
  /**
   * All decrypted iData blobs in order.
   * blobs[0] = skillContent (string), blobs[1] = config (object),
   * blobs[2+] = any additional blobs the agent was minted with.
   */
  blobs: unknown[];
}

export interface AgentHandler<
  TPayload extends Record<string, unknown> = Record<string, unknown>,
  TResult extends Record<string, unknown> = Record<string, unknown>,
> {
  /**
   * Process an agent request.
   * @param payload - Caller-supplied input for this invocation.
   * @param ctx - TEE-derived wallet, signing key, and all decrypted blobs.
   *              ctx.blobs[0] is typically the skill/prompt, ctx.blobs[1] the
   *              config object — but handlers decide the exact interpretation.
   */
  run(payload: TPayload, ctx: HandlerContext): Promise<TResult>;
}

export interface OracleConfig {
  /** The single agent handler for this oracle deployment. */
  handler: AgentHandler;
  /** Deployed contract addresses. Import deployments.json from the app root and pass here. */
  deployments?: RawDeployments;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

// ─── Oracle server factory ────────────────────────────────────────────────────

export async function startOracle(config: OracleConfig): Promise<void> {
  const portRaw = requiredEnv("PORT");
  const PORT = parseInt(portRaw, 10);
  if (!Number.isInteger(PORT) || PORT <= 0) {
    throw new Error("PORT must be a positive integer.");
  }
  const APP_NAME = process.env.APP_NAME?.trim() || "TEE-ORACLE";
  const networkName = requiredEnv("NETWORK");
  if (!networkName) {
    throw new Error("NETWORK is required.");
  }
  const networkConfig = getNetworkConfig(networkName);
  const RPC_URL = requiredEnv(networkConfig.rpcEnvVar);
  const deployment = getNetworkDeploymentByChainId(
    networkConfig.chainId,
    config.deployments ?? {},
  );
  const configuredAgentRegistryAddress = deployment.contracts.agentRegistry;
  const configuredTeeVerifierAddress = deployment.contracts.teeVerifier;
  const PRIVATE_KEY = requiredEnv("PRIVATE_KEY");
  const txSignerAddress = new ethers.Wallet(PRIVATE_KEY).address;
  const DSTACK_VERIFIER_URL = requiredEnv("DSTACK_VERIFIER_URL").replace(
    /\/$/,
    "",
  );

  // TEE key initialisation
  // IS_SIMULATOR=true when running against the local tappd simulator (DSTACK_SIMULATOR_ENDPOINT set).
  // The simulator supports deriveKey + tdxQuote but NOT info() — skip those calls in dev.
  const IS_SIMULATOR = !!process.env.DSTACK_SIMULATOR_ENDPOINT;
  const tappd = new TappdClient();
  const keyResponse = await tappd.deriveKey(APP_NAME);
  const wallet = new ethers.Wallet(
    ethers.keccak256(ethers.toUtf8Bytes(keyResponse.key)),
  );
  const signingKey = new ethers.SigningKey(wallet.privateKey);
  console.log(`[oracle] dstack app/key path: ${APP_NAME}`);
  console.log(`[oracle] TEE signing address: ${wallet.address}`);
  console.log(`[oracle] transaction signer address: ${txSignerAddress}`);

  // ─── Network configuration ────────────────────────────────────────────────────
  // Set NETWORK=base (mainnet) or NETWORK=baseSepolia (testnet).
  // chainId and Identity Registry address are derived statically — no RPC call needed.
  const { chainId, isTestnet } = networkConfig;
  const identityRegistryAddress = networkConfig.identityRegistryAddress;
  // EIP-712 domain: verifyingContract = TEE-derived address → unique per CVM; prevents
  // cross-oracle replay. Callers fetch the oracle address from GET /address before signing.
  const eip712Domain = {
    name: "TeeAgentOracle",
    version: "1",
    chainId,
    verifyingContract: wallet.address,
  };
  console.log(
    `[oracle] network=${networkName} chainId=${chainId} isTestnet=${isTestnet}`,
  );
  console.log(
    `[oracle] EIP-712 domain: chainId=${chainId}, verifyingContract=${wallet.address}`,
  );
  console.log(`[oracle] Identity Registry: ${identityRegistryAddress}`);

  let oracleRegistrationStatus:
    | { registered: true; error?: undefined }
    | { registered: false; error: string } = {
    registered: false,
    error: "registration has not run yet",
  };

  function oracleAddressReportData(): Uint8Array {
    const reportData = new Uint8Array(64);
    reportData.set(ethers.getBytes(wallet.address), 0);
    return reportData;
  }

  async function registerAttestedOracle(): Promise<void> {
    if (!configuredTeeVerifierAddress) {
      throw new Error(
        "deployments.json contracts.teeVerifier is required for TEE oracle registration.",
      );
    }
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const signer = new ethers.Wallet(PRIVATE_KEY, provider);
    const teeVerifier = new ethers.Contract(
      configuredTeeVerifierAddress,
      TEE_VERIFIER_ABI,
      signer,
    );

    const alreadyRegistered = (await teeVerifier.isOracleRegistered(
      wallet.address,
    )) as boolean;
    if (alreadyRegistered) {
      console.log(
        `[oracle] TEE oracle already registered in TeeVerifier ${configuredTeeVerifierAddress}`,
      );
      return;
    }

    console.log(
      `[oracle] registering TEE oracle ${wallet.address} in TeeVerifier ${configuredTeeVerifierAddress}`,
    );
    const quoteResult = normalizeTdxQuoteResult(
      await tappd.tdxQuote(oracleAddressReportData(), "raw"),
    );
    const tx = await submitContractTx(
      "initValidator",
      teeVerifier.interface,
      () =>
        teeVerifier.initValidator(
          wallet.address,
          quoteResult.quote,
        ) as Promise<ethers.ContractTransactionResponse>,
    );
    console.log(`[oracle] initValidator tx submitted: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(
      `[oracle] TEE oracle registered in block ${receipt?.blockNumber ?? "unknown"}`,
    );
  }

  try {
    await registerAttestedOracle();
    oracleRegistrationStatus = { registered: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    oracleRegistrationStatus = { registered: false, error: message };
    console.error(`[oracle] TEE oracle registration failed: ${message}`);
    console.error(
      "[oracle] continuing so /attestation and /info remain available for DCAP debugging; transfer and validation flows will fail until registration succeeds.",
    );
  }

  /**
   * Commits a JSON payload into a bytes32 hash for EIP-712 signatures.
   * Prevents callers from swapping out the payload after signing.
   */
  function hashPayload(payload: Record<string, unknown>): `0x${string}` {
    return ethers.keccak256(
      ethers.toUtf8Bytes(JSON.stringify(payload)),
    ) as `0x${string}`;
  }

  /**
   * Generates a TDX attestation quote with `commitment` bound into reportData[0:32].
   * The 64-byte reportData field is zero-padded; the first 32 bytes carry the
   * caller-supplied commitment so on-chain verifiers can confirm the exact value
   * without trusting any pre-registered signing key.
   */
  async function tdxQuoteWithCommitment(
    commitment: string,
  ): Promise<NormalizedTdxQuoteResponse> {
    const reportData = new Uint8Array(64);
    reportData.set(ethers.getBytes(commitment), 0);
    const tdxResult = await tappd.tdxQuote(reportData, "raw");
    return normalizeTdxQuoteResult(tdxResult);
  }

  // ─── Blob fetching ────────────────────────────────────────────────────────────

  async function fetchBlob(uri: string): Promise<EncryptedBlob> {
    console.log(
      `[oracle] fetchBlob scheme=${uri.split(":")[0]} uri=${uri.slice(0, 80)}`,
    );
    return readJsonFromUri<EncryptedBlob>(uri);
  }

  // ─── Skill resolution ─────────────────────────────────────────────────────────

  /**
   * Resolves an agent's encrypted blobs from the on-chain AgentRegistry and
   * returns all decrypted values.
   *
   * - iData[0]: first encrypted blob — decrypted and returned as `skillContent` (string).
   * - iData[1]: second encrypted blob — decrypted and returned as `config` (object), empty if absent.
   * - iData[2+]: any additional blobs — decrypted and available via `ctx.blobs`.
   *
   * All blobs were encrypted to this oracle's public key at mint time, so only
   * this oracle (holding the TEE-derived private key) can decrypt them.
   */
  async function getAgentData(
    agentId: bigint,
    registryAddress: string,
  ): Promise<{ blobs: unknown[] }> {
    if (!RPC_URL) throw new Error("RPC_URL is not configured on the oracle.");
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const registry = new ethers.Contract(
      registryAddress,
      AGENT_REGISTRY_ABI,
      provider,
    );
    const datas = (await registry.intelligentDatasOf(agentId)) as Array<{
      dataDescription: string;
      dataHash: string;
    }>;
    console.log(
      `[oracle] getAgentData agentId=${agentId} blobs=${datas.length}`,
    );
    if (!datas.length) {
      const msg = `Agent #${agentId} has no intelligent data blobs.`;
      console.error(`[oracle] ${msg}`);
      throw new Error(msg);
    }

    const blobs: unknown[] = [];
    for (let i = 0; i < datas.length; i++) {
      const data = datas[i] as { dataDescription: string; dataHash: string };
      const uri = data.dataDescription;
      console.log(
        `[oracle] decrypting blob ${i} hash=${data.dataHash.slice(0, 10)}…`,
      );
      const blob = await fetchBlob(uri);
      const actualHash = await hashEncryptedBlob(blob);
      if (actualHash !== data.dataHash) {
        throw new Error(
          `Hash mismatch for blob ${i}: expected ${data.dataHash}, got ${actualHash}`,
        );
      }
      const key = decryptContentKey(blob, wallet.privateKey);
      blobs.push(decryptMetadata<unknown>(blob, key));
      console.log(`[oracle] blob ${i} decrypted ok`);
    }

    return { blobs };
  }

  // ─── Re-encryption logic ──────────────────────────────────────────────────────

  const abiCoder = ethers.AbiCoder.defaultAbiCoder();

  async function reencrypt(body: ReEncryptBody) {
    const pubKeyHex = body.targetPubkey.startsWith("0x")
      ? body.targetPubkey.slice(2)
      : body.targetPubkey;
    const recipientPublicKey = Buffer.from(pubKeyHex, "hex");
    const ownershipProofs: Array<{
      oracleType: number;
      dataHash: `0x${string}`;
      sealedKey: `0x${string}`;
      targetPubkey: `0x${string}`;
      nonce: `0x${string}`;
      proof: `0x${string}`;
    }> = [];

    for (let i = 0; i < body.blobUris.length; i++) {
      const uri = body.blobUris[i] as string;
      const expectedHash = body.intelligentDataHashes[i] as string;

      const blob = await fetchBlob(uri);
      const oldContentKey = decryptContentKey(blob, wallet.privateKey);
      const actualHash = await hashEncryptedBlob(blob);
      if (actualHash !== expectedHash) {
        throw new Error(
          `Hash mismatch for blob ${i}: expected ${expectedHash}, got ${actualHash}`,
        );
      }

      const encryptedKey = encrypt(
        recipientPublicKey,
        Buffer.from(oldContentKey),
      );
      const sealedKey =
        `0x${Buffer.from(encryptedKey).toString("hex")}` as `0x${string}`;

      const nonceBytes = ethers.keccak256(
        ethers.toUtf8Bytes(`ownership:${body.tokenId}:${i}:${Date.now()}`),
      );
      const nonce = nonceBytes as `0x${string}`;
      const targetPubkeyBytes = `0x${pubKeyHex}` as `0x${string}`;
      const originalDataHash = expectedHash as `0x${string}`;

      const innerHash = ethers.keccak256(
        abiCoder.encode(
          [
            "uint256",
            "address",
            "address",
            "uint256",
            "address",
            "address",
            "uint256",
            "bytes32",
            "bytes",
            "bytes",
            "bytes32",
          ],
          [
            body.chainId,
            body.verifierAddress,
            body.registryAddress,
            BigInt(body.tokenId),
            body.from,
            body.to,
            body.deadline,
            originalDataHash,
            sealedKey,
            targetPubkeyBytes,
            nonce,
          ],
        ),
      );

      const messageHash = ethers.keccak256(
        ethers.concat([
          ethers.toUtf8Bytes("\x19Ethereum Signed Message:\n66"),
          ethers.toUtf8Bytes(innerHash),
        ]),
      );

      const sig = signingKey.sign(messageHash);
      const proof = ethers.Signature.from(sig).serialized as `0x${string}`;

      ownershipProofs.push({
        oracleType: 0,
        dataHash: originalDataHash,
        sealedKey,
        targetPubkey: targetPubkeyBytes,
        nonce,
        proof,
      });
    }

    return { ownershipProofs };
  }

  // ─── HTTP server ──────────────────────────────────────────────────────────────

  const app = express();
  app.use(cors());
  app.use(express.json());

  // ─── Request logger ───────────────────────────────────────────────────────────
  app.use((req, _res, next) => {
    console.log(
      `[oracle] ${req.method} ${req.path}`,
      Object.keys(req.body ?? {}).length
        ? JSON.stringify(req.body).slice(0, 200)
        : "",
    );
    next();
  });

  // ─── EIP-712 auth helpers ─────────────────────────────────────────────────────

  /**
   * Verifies an EIP-712 typed-data signature and returns the recovered signer address.
   * Throws if the domain is unavailable or the deadline has passed.
   */
  function verifyEip712(
    types: Record<string, Array<{ name: string; type: string }>>,
    value: Record<string, unknown>,
    signature: string,
    deadline: number,
  ): string {
    if (deadline < Math.floor(Date.now() / 1000)) {
      throw new Error("Signature has expired.");
    }
    return ethers.verifyTypedData(eip712Domain, types, value, signature);
  }

  /**
   * Asserts that `signer` is the current ERC-721 owner of `agentId`.
   * Throws if the ownership check fails.
   */
  async function assertOwner(
    agentId: bigint,
    registryAddress: string,
    signer: string,
  ): Promise<string> {
    if (!RPC_URL) throw new Error("RPC_URL is not configured.");
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const nft = new ethers.Contract(
      registryAddress,
      AGENT_REGISTRY_ABI,
      provider,
    );
    let owner: string;
    try {
      owner = (await nft.ownerOf(agentId)) as string;
    } catch (err) {
      // ethers v6 throws BAD_DATA (0x) when the RPC silently reverts (e.g. token doesn't exist)
      const code = (err as { code?: string }).code;
      if (code === "BAD_DATA") {
        throw new Error(
          `Token #${agentId} does not exist in registry ${registryAddress} (or registry address is wrong).`,
        );
      }
      throw err;
    }
    if (signer.toLowerCase() !== owner.toLowerCase()) {
      throw new Error(
        `Signer ${signer} is not the owner of agent #${agentId}.`,
      );
    }
    return owner;
  }

  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      status: oracleRegistrationStatus.registered ? "ok" : "degraded",
      teeOracleRegistered: oracleRegistrationStatus.registered,
      registrationError: oracleRegistrationStatus.error,
    });
  });

  /**
   * GET /address
   * Returns the oracle's TEE-derived Ethereum address and compressed public key.
   * Call this before /run or /validate to get the verifying contract address for
   * EIP-712 typed-data signatures.
   */
  app.get("/address", (_req: Request, res: Response) => {
    res.json({
      address: wallet.address,
      publicKey: signingKey.compressedPublicKey,
    });
  });

  /**
   * GET /info
   * Returns the dstack application info: instance_id, app_id, app_name, and the
   * full TCB info (MRTD, RTMR0-3, event log). External verifiers use the event log
   * for RTMR3 replay (compose-hash, instance-id, key-provider events).
   *
   * Verification guide: https://docs.phala.com/phala-cloud/attestation/verify-your-application
   */
  app.get("/info", async (_req: Request, res: Response) => {
    if (IS_SIMULATOR) {
      res.json({
        simulator: true,
        transactionSignerAddress: txSignerAddress,
        message:
          "Running against local tappd simulator — real TCB info unavailable.",
      });
      return;
    }
    try {
      const appInfo = await tappd.info();
      res.json({
        ...appInfo,
        transactionSignerAddress: txSignerAddress,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(503).json({ error: `App info unavailable: ${message}` });
    }
  });

  /**
   * GET /attestation
   * Returns the full TDX attestation bundle required by dstack-verifier:
   *   - quote       — raw TDX quote hex (Intel-signed, contains MRTD + RTMRs + reportData)
   *   - event_log   — hex-encoded event log for RTMR replay verification
   *   - tcb_info    — RTMR values + compose-hash event log from tappd.info()
   *   - address     — TEE-derived signing address (embedded in reportData[0:20])
   *   - publicKey   — compressed secp256k1 public key
   *
   * reportData carries the oracle's Ethereum address so verifiers can confirm the
   * signing key was derived inside this exact TEE instance.
   *
   * Hardware verification (basic):
   *   POST https://cloud-api.phala.com/api/v1/attestations/verify  { hex: quote }
   *
   * Full platform verification (advanced — dstack-verifier):
   *   curl -d @<(curl -s https://<your-phala-cvm-oracle-url>/attestation) localhost:8080/verify | jq
   *   See: https://docs.phala.com/phala-cloud/attestation/verify-the-platform
   *
   * Note: vm_config (CPU count, memory size) requires @phala/dstack-sdk ≥ 0.5.x.
   * The tcb_info field contains equivalent measurements for manual verification.
   */
  app.get("/attestation", async (_req: Request, res: Response) => {
    try {
      // Embed oracle address at reportData[0:20] so on-chain TeeVerifier and
      // external verifiers can bind the signing key to this quote.
      const quoteResult = normalizeTdxQuoteResult(
        await tappd.tdxQuote(oracleAddressReportData(), "raw"),
      );
      const appInfo = IS_SIMULATOR ? null : await tappd.info();
      res.json({
        quote: quoteResult.quote,
        event_log: quoteResult.event_log,
        ...(appInfo ? { tcb_info: appInfo.tcb_info } : {}),
        address: wallet.address,
        publicKey: signingKey.compressedPublicKey,
        ...(IS_SIMULATOR ? { simulator: true } : {}),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(503).json({ error: `Attestation unavailable: ${message}` });
    }
  });

  /**
   * POST /verify
   * Verifies an existing TDX quote against the local dstack-verifier sidecar.
   * No Phala Cloud dependency — fully trustless Intel TDX verification.
   *
   * Body: { quote: "0x...", event_log: "0x..." }
   * (the exact shape returned by GET /attestation and GET /run's proof field)
   *
   * The dstack-verifier checks: Intel root CA signature, MRTD, RTMR0-3
   * via event log replay, and TCB status. Returns { is_valid: true } when all pass.
   *
   * Typical usage:
   *   curl -s https://oracle/attestation | jq '{quote,event_log}' | curl -d @- https://oracle/verify
   *
   * Sidecar URL configured via DSTACK_VERIFIER_URL env var.
   *
   * Note: os_image_hash_verified requires vm_config (@phala/dstack-sdk >= 0.5.x).
   * Without it, dstack-verifier still validates quote signature + event log + TCB status.
   *
   * See: https://docs.phala.com/phala-cloud/attestation/verify-the-platform
   */
  app.post("/verify", async (req: Request, res: Response) => {
    try {
      const body = verifyBodySchema.parse(req.body);
      let fetchRes: globalThis.Response;
      try {
        fetchRes = await fetch(`${DSTACK_VERIFIER_URL}/verify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            quote: body.quote,
            event_log: body.event_log,
          }),
        });
      } catch {
        // Verifier sidecar unreachable.
        res.json({ is_valid: false, unavailable: true });
        return;
      }
      console.log(fetchRes);

      let result: unknown;
      try {
        result = await fetchRes.json();
      } catch {
        // Verifier returned a non-JSON body (e.g. HTML error page for 4xx/5xx).
        // This means the verifier is reachable but rejected the quote.
        res.json({ is_valid: false, status: fetchRes.status });
        return;
      }
      res.status(fetchRes.status).json({
        is_valid: (result as { is_valid?: boolean }).is_valid ?? false,
        detail: result,
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({
          error: "quote (0x-prefixed hex) and event_log are required.",
        });
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      res.status(503).json({ error: `Verification unavailable: ${message}` });
    }
  });

  app.post("/reencrypt", async (req: Request, res: Response) => {
    try {
      const body = reEncryptBodySchema.parse(req.body);
      console.log(
        `[oracle] /reencrypt tokenId=${body.tokenId} from=${body.from} to=${body.to} blobs=${body.blobUris.length}`,
      );
      const signer = verifyEip712(
        REENCRYPT_REQUEST_TYPES,
        {
          tokenId: BigInt(body.tokenId),
          from: body.from,
          to: body.to,
          deadline: body.deadline,
        },
        body.signature,
        body.deadline,
      );
      if (signer.toLowerCase() !== body.from.toLowerCase()) {
        console.error(
          `[oracle] /reencrypt signer mismatch: got ${signer} expected ${body.from}`,
        );
        res
          .status(403)
          .json({ error: "Signer does not match the 'from' address." });
        return;
      }
      const result = await reencrypt(body);
      console.log(`[oracle] /reencrypt ok tokenId=${body.tokenId}`);
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[oracle] /reencrypt error:`, err);
      res.status(400).json({ error: message });
    }
  });

  // ─── Validation endpoint ────────────────────────────────────────────────────

  app.post("/validate", async (req: Request, res: Response) => {
    try {
      const body = validateRequestBodySchema.parse(req.body);
      const erc8004AgentId = BigInt(body.erc8004AgentId);
      console.log(`[oracle] /validate erc8004AgentId=${erc8004AgentId}`);

      const payloadHash = hashPayload(body.payload);
      const signer = verifyEip712(
        VALIDATE_REQUEST_TYPES,
        {
          erc8004AgentId,
          requestHash: body.requestHash,
          payloadHash,
          deadline: body.deadline,
        },
        body.signature,
        body.deadline,
      );
      if (signer.toLowerCase() !== txSignerAddress.toLowerCase()) {
        throw new Error("Unauthorized validation signer.");
      }

      // body.payload is the runMeta encoded in the on-chain requestURI:
      // { type, outcome, payload (original claim), quote, timestamp, agentId }
      const runMeta = body.payload as {
        outcome?: Record<string, unknown>;
        payload?: Record<string, unknown>;
      };
      const originalOutcome = runMeta.outcome ?? {};
      const originalPayload = runMeta.payload ?? {};

      // Ask the LLM to re-verify the original claim and rate the accuracy of
      // the recorded result on a scale of 0–100.
      const { score, reasoning } = await scoreWithLLM(
        originalPayload,
        originalOutcome,
      );

      console.log(
        `[oracle] /validate LLM score=${score} reasoning=${reasoning.slice(0, 100)}…`,
      );

      const validationResult: Record<string, unknown> = { score, reasoning };
      const responseJson = JSON.stringify(validationResult);
      const responseURI =
        body.responseURI ||
        `data:application/json;base64,${Buffer.from(responseJson, "utf8").toString("base64")}`;
      const responseHash =
        body.responseHash === ethers.ZeroHash && !body.responseURI
          ? ethers.keccak256(ethers.toUtf8Bytes(responseJson))
          : body.responseHash;

      // Generate a quote for on-chain TeeVerifier.verifyValidation().
      // Local simulator quotes pass only against the local MockDcapAttestation deployment.
      const commitment = ethers.keccak256(
        ethers.solidityPacked(
          ["uint256", "bytes32", "uint8"],
          [erc8004AgentId, body.requestHash, score],
        ),
      );
      const { quote, event_log } = await tdxQuoteWithCommitment(commitment);

      let txHash: string | undefined;
      if (RPC_URL) {
        const provider = new ethers.JsonRpcProvider(RPC_URL);
        const txWallet = new ethers.Wallet(PRIVATE_KEY, provider);
        const connectedWallet = txWallet.connect(provider);
        const registry = new ethers.Contract(
          body.validationRegistryAddress,
          VALIDATION_REGISTRY_ABI,
          connectedWallet,
        );

        const tx = await submitContractTx(
          "validationResponse",
          registry.interface,
          () =>
            registry.validationResponse(
              body.requestHash,
              score,
              responseURI,
              responseHash,
              body.tag,
              quote,
            ) as Promise<ethers.ContractTransactionResponse>,
        );
        const receipt = await tx.wait();
        txHash = receipt?.hash;
      }

      console.log(
        `[oracle] /validate ok erc8004AgentId=${erc8004AgentId} score=${score}${txHash ? ` txHash=${txHash}` : ""}`,
      );
      res.json({
        ...validationResult,
        score,
        quote,
        event_log,
        responseURI,
        responseHash,
        erc8004AgentId: erc8004AgentId.toString(),
        ...(txHash !== undefined ? { txHash } : {}),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[oracle] /validate error:`, err);
      res.status(400).json({ error: message });
    }
  });

  // ─── Agent runner endpoint ──────────────────────────────────────────────────

  app.post("/run", async (req: Request, res: Response) => {
    try {
      const body = runBodySchema.parse(req.body);
      const agentId = BigInt(body.agentId);
      const registryAddress =
        body.registryAddress ?? configuredAgentRegistryAddress;
      console.log(
        `[oracle] /run agentId=${agentId} registry=${registryAddress}`,
      );
      if (!registryAddress) {
        console.error(
          `[oracle] /run registryAddress not provided and deployments.json has no AgentRegistry for ${networkName}`,
        );
        res.status(400).json({
          error:
            "registryAddress is required because deployments.json has no AgentRegistry for this network.",
        });
        return;
      }

      // EIP-712 ownership check — only the agent owner may invoke it
      const payloadHash = hashPayload(body.payload);
      const signer = verifyEip712(
        RUN_REQUEST_TYPES,
        { agentId, payloadHash, deadline: body.deadline },
        body.signature,
        body.deadline,
      );
      await assertOwner(agentId, registryAddress, signer);

      // Resolve + decrypt the agent's skill from the chain and 0G Storage
      const agentData = await getAgentData(agentId, registryAddress);

      const result = await config.handler.run(body.payload, {
        wallet,
        signingKey,
        blobs: agentData.blobs,
      });

      const timestamp = Math.floor(Date.now() / 1000);
      const resultJson = JSON.stringify(result);
      const agentIdStr = agentId.toString();

      // Commit: keccak256(agentId ‖ resultHash ‖ timestamp)
      // Embedding this commitment in the TDX reportData binds the exact result to
      // the hardware attestation — verifiers don't need to trust the signing key.
      const resultHash = ethers.keccak256(ethers.toUtf8Bytes(resultJson));
      const commitment = ethers.keccak256(
        ethers.solidityPacked(
          ["uint256", "bytes32", "uint256"],
          [agentId, resultHash, BigInt(timestamp)],
        ),
      );
      const { quote, event_log } = await tdxQuoteWithCommitment(commitment);

      console.log(
        `[oracle] /run ok agentId=${agentIdStr} result=${resultJson}`,
      );
      res.json({
        agentId: agentIdStr,
        result,
        timestamp,
        quote,
        event_log,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[oracle] /run error:`, err);
      res.status(400).json({ error: message });
    }
  });

  app.listen(PORT, () => {
    console.log(`[oracle] listening on port ${PORT}`);
  });
}
