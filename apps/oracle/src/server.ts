/**
 * Oracle server factory — Arcane Agents
 * ─────────────────────────────────────────────────────────────────────────────
 * Call `startOracle({ handlers })` to start an oracle server with your own
 * agent handlers. Each handler receives the decrypted skill from 0G Storage
 * and the caller's payload, then returns a TEE-signed result.
 *
 * The oracle handles all infrastructure:
 *   - TEE key derivation via Phala dstack SDK
 *   - On-chain agentId → blob URI resolution (AgentRegistry)
 *   - 0G Storage download + ECIES-unwrap + AES-256-GCM decrypt
 *   - ECDSA signing of results (TEE-attested)
 *   - NFT transfer re-encryption (/reencrypt)
 *   - Validation response signing (/validate)
 *
 * You provide: a Record of handler implementations. Each oracle deployment is
 * single-purpose — only the first registered handler is used at runtime. The
 * key you give the handler is used as the `type` label in signed responses.
 *
 * Example:
 * ```typescript
 * import { startOracle } from './server.js'
 *
 * await startOracle({
 *   handlers: {
 *     'my-agent': {
 *       async run(skillContent, config, payload) {
 *         // skillContent = decrypted SKILL.md markdown string (iData[0])
 *         // config       = decrypted agent config object     (iData[1])
 *         // payload      = caller-supplied input
 *         return { answer: 42 }
 *       }
 *     }
 *   }
 * })
 * ```
 */

import express, { type Request, type Response } from "express";
import cors from "cors";
import { TappdClient } from "@phala/dstack-sdk";
import { encrypt } from "eciesjs";
import { ethers } from "ethers";
import { Indexer, MemData } from "@0gfoundation/0g-ts-sdk";
import { z } from "zod";
import {
  decryptContentKey,
  decryptMetadata,
  encryptMetadata,
  generateContentKey,
  hashEncryptedBlob,
  type EncryptedBlob,
} from "@open-agents-toolkit/agent/encryption";

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
  TConfig extends Record<string, unknown> = Record<string, unknown>,
  TPayload extends Record<string, unknown> = Record<string, unknown>,
  TResult extends Record<string, unknown> = Record<string, unknown>,
> {
  /**
   * Process an agent request.
   * @param skillContent - Decrypted SKILL.md markdown string (iData[0]).
   * @param config - Decrypted agent config object (iData[1], empty object if absent).
   * @param payload - Caller-supplied input for this invocation.
   * @param ctx - TEE-derived wallet and signing key.
   */
  run(
    skillContent: string,
    config: TConfig,
    payload: TPayload,
    ctx: HandlerContext,
  ): Promise<TResult>;
  /**
   * Optional: map a run result to a 0–100 integer for on-chain ValidationRegistry.
   * If omitted, the oracle falls back to `result.score` (if numeric) or 50.
   */
  score?(result: TResult): number;
}

export interface OracleConfig {
  /**
   * Agent handlers keyed by the `type` field in the skill blob.
   * The oracle dispatches POST /run requests to the matching handler.
   */
  handlers: Record<string, AgentHandler>;
  /** TCP port to listen on. Defaults to PORT env var or 3000. */
  port?: number;
}

// ─── Oracle server factory ────────────────────────────────────────────────────

export async function startOracle(config: OracleConfig): Promise<void> {
  const PORT = config.port ?? parseInt(process.env.PORT ?? "3000", 10);
  const KEY_PATH = "oracle/reencrypt";
  const RPC_URL = process.env.RPC_URL;
  const AGENT_REGISTRY_ADDRESS = process.env.AGENT_REGISTRY_ADDRESS;
  const ZERO_G_RPC_URL =
    process.env.ZERO_G_RPC_URL ?? "https://evmrpc-testnet.0g.ai";
  const ZERO_G_INDEXER_URL =
    process.env.ZERO_G_INDEXER_URL ??
    "https://indexer-storage-testnet-turbo.0g.ai";

  // TEE key initialisation
  const tappd = new TappdClient();
  const keyResponse = await tappd.deriveKey(KEY_PATH);
  const wallet = new ethers.Wallet(
    ethers.hexlify(keyResponse.asUint8Array(32)),
  );
  const signingKey = new ethers.SigningKey(wallet.privateKey);
  console.log(`[oracle] TEE signing address: ${wallet.address}`);
  if (Object.keys(config.handlers).length > 0) {
    console.log(
      `[oracle] Handlers: ${Object.keys(config.handlers).join(", ")}`,
    );
  }
  // ─── EIP-712 domain ───────────────────────────────────────────────────────────
  // verifyingContract = TEE-derived address → unique per CVM; prevents cross-oracle replay.
  // Callers fetch the oracle address from GET /address before constructing the typed data.
  let eip712Domain: {
    name: string;
    version: string;
    chainId: bigint;
    verifyingContract: string;
  } | null = null;
  if (RPC_URL) {
    const { chainId } = await new ethers.JsonRpcProvider(RPC_URL).getNetwork();
    eip712Domain = {
      name: "ArcaneAgentsOracle",
      version: "1",
      chainId,
      verifyingContract: wallet.address,
    };
    console.log(
      `[oracle] EIP-712 domain: chainId=${chainId}, verifyingContract=${wallet.address}`,
    );
  }

  // ─── 0G Storage helpers ──────────────────────────────────────────────────────

  async function downloadFromZeroG(uri: string): Promise<Uint8Array> {
    const rootHash = uri.startsWith("zerog://")
      ? uri.slice("zerog://".length)
      : uri;
    console.log(`[oracle] 0G download rootHash=${rootHash}`);
    const indexer = new Indexer(ZERO_G_INDEXER_URL);
    const [blob, err] = await indexer.downloadToBlob(rootHash);
    if (err || !blob) {
      const msg = `0G download failed for ${uri}: ${String(err ?? "unknown")}`;
      console.error(`[oracle] ${msg}`);
      throw new Error(msg);
    }
    console.log(`[oracle] 0G download ok rootHash=${rootHash}`);
    return new Uint8Array(await blob.arrayBuffer());
  }

  async function uploadToZeroG(
    bytes: Uint8Array,
    privateKey: string,
  ): Promise<string> {
    const provider = new ethers.JsonRpcProvider(ZERO_G_RPC_URL);
    const signer = new ethers.Wallet(privateKey, provider);
    const indexer = new Indexer(ZERO_G_INDEXER_URL);
    const memData = new MemData(bytes);
    // Cast through unknown to bridge the ethers ESM/CJS dual-package type mismatch.
    // The 0G SDK was compiled against ethers CJS types; our code uses ethers ESM types.
    // Both resolve to the same runtime object — the cast is safe.
    type ZeroGSigner = Parameters<(typeof indexer)["upload"]>[2];
    console.log(`[oracle] 0G upload start`);
    const [tx, err] = await indexer.upload(
      memData,
      ZERO_G_RPC_URL,
      signer as unknown as ZeroGSigner,
    );
    if (err || !tx) {
      const msg = `0G upload failed: ${String(err ?? "no tx")}`;
      console.error(`[oracle] ${msg}`);
      throw new Error(msg);
    }
    const rootHash =
      "rootHash" in tx
        ? (tx as { rootHash: string }).rootHash
        : (tx as { rootHashes: string[] }).rootHashes[0];
    return `zerog://${rootHash}`;
  }

  // ─── Blob fetching ────────────────────────────────────────────────────────────

  async function fetchBlob(uri: string): Promise<EncryptedBlob> {
    console.log(
      `[oracle] fetchBlob scheme=${uri.split(":")[0]} uri=${uri.slice(0, 80)}`,
    );
    if (uri.startsWith("data:")) {
      const base64 = uri.split(",")[1] ?? "";
      return JSON.parse(
        Buffer.from(base64, "base64").toString("utf8"),
      ) as EncryptedBlob;
    }
    if (uri.startsWith("zerog://")) {
      const bytes = await downloadFromZeroG(uri);
      return JSON.parse(new TextDecoder().decode(bytes)) as EncryptedBlob;
    }
    console.log(`[oracle] fetchBlob http GET ${uri}`);
    const response = await fetch(uri);
    if (!response.ok) {
      const msg = `Failed to fetch blob from ${uri}: ${response.status}`;
      console.error(`[oracle] ${msg}`);
      throw new Error(msg);
    }
    return (await response.json()) as EncryptedBlob;
  }

  // ─── Skill resolution ─────────────────────────────────────────────────────────

  const INTELLIGENT_DATAS_OF_ABI = [
    {
      name: "intelligentDatasOf",
      type: "function",
      stateMutability: "view",
      inputs: [{ name: "tokenId", type: "uint256" }],
      outputs: [
        {
          type: "tuple[]",
          components: [
            { name: "dataDescription", type: "string" },
            { name: "dataHash", type: "bytes32" },
          ],
        },
      ],
    },
  ] as const;

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
  ): Promise<{
    skillContent: string;
    config: Record<string, unknown>;
    blobs: unknown[];
  }> {
    if (!RPC_URL) throw new Error("RPC_URL is not configured on the oracle.");
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const registry = new ethers.Contract(
      registryAddress,
      INTELLIGENT_DATAS_OF_ABI,
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

    // Decrypt all blobs in order
    const blobs: unknown[] = [];
    for (let i = 0; i < datas.length; i++) {
      const data = datas[i] as { dataDescription: string; dataHash: string };
      const uri = data.dataDescription;
      console.log(
        `[oracle] decrypting blob ${i} hash=${data.dataHash.slice(0, 10)}…`,
      );
      const blob = await fetchBlob(uri);
      const key = decryptContentKey(blob, wallet.privateKey);
      blobs.push(decryptMetadata<unknown>(blob, key));
      console.log(`[oracle] blob ${i} decrypted ok`);
    }

    const skillContent = blobs[0] as string;
    const rawConfig = blobs[1] ?? {};
    const config = ((): Record<string, unknown> => {
      if (typeof rawConfig === "string") {
        try {
          return JSON.parse(rawConfig) as Record<string, unknown>;
        } catch {
          return {};
        }
      }
      return rawConfig as Record<string, unknown>;
    })();

    return { skillContent, config, blobs };
  }

  // ─── Re-encryption logic ──────────────────────────────────────────────────────

  const abiCoder = ethers.AbiCoder.defaultAbiCoder();

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
      blobUris: z
        .array(z.string())
        .min(1, "blobUris must be a non-empty array."),
      contentKey: z.string(),
      targetPubkey: z.string(),
      signature: z.string(),
    })
    .refine(
      (b) => b.intelligentDataHashes.length === b.blobUris.length,
      "intelligentDataHashes and blobUris must have the same length.",
    );

  type ReEncryptBody = z.infer<typeof reEncryptBodySchema>;

  async function reencrypt(body: ReEncryptBody) {
    const oldContentKey = Buffer.from(body.contentKey, "base64");

    const pubKeyHex = body.targetPubkey.startsWith("0x")
      ? body.targetPubkey.slice(2)
      : body.targetPubkey;
    const recipientPublicKey = Buffer.from(pubKeyHex, "hex");

    const newContentKey = generateContentKey();
    const encryptedNewKey = encrypt(
      recipientPublicKey,
      Buffer.from(newContentKey),
    );
    const sealedKey =
      `0x${Buffer.from(encryptedNewKey).toString("hex")}` as `0x${string}`;

    const newDataHashes: `0x${string}`[] = [];
    const newBlobUris: string[] = [];
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
      const actualHash = await hashEncryptedBlob(blob);
      if (actualHash !== expectedHash) {
        throw new Error(
          `Hash mismatch for blob ${i}: expected ${expectedHash}, got ${actualHash}`,
        );
      }

      const plaintext = decryptMetadata<unknown>(blob, oldContentKey);
      const newBlob = encryptMetadata(
        blob.name,
        plaintext,
        newContentKey,
        recipientPublicKey,
      );

      const newDataHash = await hashEncryptedBlob(newBlob);
      newDataHashes.push(newDataHash);

      let newBlobUri: string;
      if (uri.startsWith("data:")) {
        const encoded = Buffer.from(JSON.stringify(newBlob)).toString("base64");
        newBlobUri = `data:application/json;base64,${encoded}`;
      } else {
        const zeroGKey = process.env.ZERO_G_PRIVATE_KEY ?? wallet.privateKey;
        const blobBytes = new TextEncoder().encode(JSON.stringify(newBlob));
        newBlobUri = await uploadToZeroG(blobBytes, zeroGKey);
      }
      newBlobUris.push(newBlobUri);

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

    return { newDataHashes, sealedKey, ownershipProofs, newBlobUris };
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

  const OWNER_OF_ABI = ["function ownerOf(uint256) view returns (address)"];

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
    if (!eip712Domain) {
      throw new Error("EIP-712 auth unavailable: RPC_URL is not configured.");
    }
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
  ): Promise<void> {
    if (!RPC_URL) throw new Error("RPC_URL is not configured.");
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const nft = new ethers.Contract(registryAddress, OWNER_OF_ABI, provider);
    const owner = (await nft.ownerOf(agentId)) as string;
    if (signer.toLowerCase() !== owner.toLowerCase()) {
      throw new Error(
        `Signer ${signer} is not the owner of agent #${agentId}.`,
      );
    }
  }

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok" });
  });

  app.get("/address", async (_req: Request, res: Response) => {
    try {
      const quote = await tappd.tdxQuote(wallet.address);
      res.json({
        address: wallet.address,
        publicKey: signingKey.compressedPublicKey,
        quote: quote.quote,
      });
    } catch {
      res.json({
        address: wallet.address,
        publicKey: signingKey.compressedPublicKey,
      });
    }
  });

  app.post("/reencrypt", async (req: Request, res: Response) => {
    try {
      const body = reEncryptBodySchema.parse(req.body);
      console.log(
        `[oracle] /reencrypt tokenId=${body.tokenId} from=${body.from} to=${body.to} blobs=${body.blobUris.length}`,
      );
      const signer = verifyEip712(
        {
          ReencryptRequest: [
            { name: "tokenId", type: "uint256" },
            { name: "from", type: "address" },
            { name: "to", type: "address" },
            { name: "deadline", type: "uint256" },
          ],
        },
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

  const VALIDATION_RESPONSE_ABI = [
    "function validationResponse(bytes32 requestHash, uint8 response, string calldata responseURI, bytes32 responseHash, string calldata tag, bytes calldata proof) external",
  ];

  const validateRequestBodySchema = z.object({
    requestHash: z.string(),
    agentId: z.union([z.string(), z.number()]),
    /** The claim / input to validate — oracle runs the skill handler on this. */
    payload: z.record(z.string(), z.unknown()),
    validationRegistryAddress: z.string(),
    /** Override the AgentRegistry used to look up the skill blob (optional). */
    registryAddress: z.string().optional(),
    responseURI: z.string().optional().default(""),
    responseHash: z.string().optional().default(ethers.ZeroHash),
    tag: z.string().optional().default(""),
    signature: z.string(),
    deadline: z.number().int().positive(),
  });

  app.post("/validate", async (req: Request, res: Response) => {
    try {
      const body = validateRequestBodySchema.parse(req.body);
      const agentIdBig = BigInt(body.agentId);
      const registryAddress = body.registryAddress ?? AGENT_REGISTRY_ADDRESS;
      console.log(
        `[oracle] /validate agentId=${agentIdBig} registry=${registryAddress}`,
      );
      if (!registryAddress) {
        console.error(`[oracle] /validate AGENT_REGISTRY_ADDRESS not set`);
        res.status(400).json({
          error: "AGENT_REGISTRY_ADDRESS is not configured on the oracle.",
        });
        return;
      }

      // payloadHash commits the payload into the EIP-712 signature so the
      // caller cannot swap out the payload after signing.
      const payloadHash = ethers.keccak256(
        ethers.toUtf8Bytes(JSON.stringify(body.payload)),
      ) as `0x${string}`;

      const signer = verifyEip712(
        {
          ValidateRequest: [
            { name: "agentId", type: "uint256" },
            { name: "requestHash", type: "bytes32" },
            { name: "payloadHash", type: "bytes32" },
            { name: "deadline", type: "uint256" },
          ],
        },
        {
          agentId: agentIdBig,
          requestHash: body.requestHash,
          payloadHash,
          deadline: body.deadline,
        },
        body.signature,
        body.deadline,
      );
      await assertOwner(agentIdBig, registryAddress, signer);

      // Resolve the agent's skill and run the handler to compute the score.
      // The oracle — not the caller — determines the outcome.
      const agentData = await getAgentData(agentIdBig, registryAddress);

      // Oracle is single-purpose: use the first registered handler.
      const handlerEntry = Object.entries(config.handlers)[0];
      if (!handlerEntry) {
        res.status(400).json({
          error:
            "No handlers registered. Add handlers via startOracle({ handlers: { ... } }).",
        });
        return;
      }
      const [, handler] = handlerEntry;

      const result = await handler.run(
        agentData.skillContent,
        agentData.config,
        body.payload,
        { wallet, signingKey, blobs: agentData.blobs },
      );

      // Derive score from the handler — never trust a caller-supplied value.
      const rawScore = handler.score
        ? handler.score(result)
        : typeof result.score === "number"
          ? (result.score as number)
          : 50;
      const score = Math.min(100, Math.max(0, Math.round(rawScore)));

      const inner = ethers.keccak256(
        ethers.solidityPacked(
          ["uint256", "bytes32", "uint8"],
          [agentIdBig, body.requestHash, score],
        ),
      );
      const digest = ethers.keccak256(
        ethers.concat([
          ethers.toUtf8Bytes("\x19Ethereum Signed Message:\n32"),
          ethers.getBytes(inner),
        ]),
      );

      const sig = signingKey.sign(digest);
      const proof = ethers.Signature.from(sig).serialized as `0x${string}`;

      let txHash: string | undefined;
      if (RPC_URL) {
        const provider = new ethers.JsonRpcProvider(RPC_URL);
        const connectedWallet = wallet.connect(provider);
        const registry = new ethers.Contract(
          body.validationRegistryAddress,
          VALIDATION_RESPONSE_ABI,
          connectedWallet,
        );
        const tx = (await registry.validationResponse(
          body.requestHash,
          score,
          body.responseURI,
          body.responseHash,
          body.tag,
          proof,
        )) as ethers.ContractTransactionResponse;
        const receipt = await tx.wait();
        txHash = receipt?.hash;
      }

      console.log(
        `[oracle] /validate ok agentId=${agentIdBig} score=${score}${txHash ? ` txHash=${txHash}` : ""}`,
      );
      res.json({
        score,
        result,
        proof,
        ...(txHash !== undefined ? { txHash } : {}),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[oracle] /validate error:`, err);
      res.status(400).json({ error: message });
    }
  });

  // ─── Agent runner endpoint ──────────────────────────────────────────────────

  const runBodySchema = z.object({
    agentId: z.union([z.string(), z.number()]),
    registryAddress: z.string().optional(),
    payload: z.record(z.string(), z.unknown()),
    signature: z.string(),
    deadline: z.number().int().positive(),
  });

  app.post("/run", async (req: Request, res: Response) => {
    try {
      const body = runBodySchema.parse(req.body);
      const agentId = BigInt(body.agentId);
      const registryAddress = body.registryAddress ?? AGENT_REGISTRY_ADDRESS;
      console.log(
        `[oracle] /run agentId=${agentId} registry=${registryAddress}`,
      );
      if (!registryAddress) {
        console.error(
          `[oracle] /run registryAddress not provided and AGENT_REGISTRY_ADDRESS not set`,
        );
        res.status(400).json({
          error:
            "registryAddress is required (or set AGENT_REGISTRY_ADDRESS on the oracle).",
        });
        return;
      }

      // EIP-712 ownership check — only the agent owner may invoke it
      const payloadHash = ethers.keccak256(
        ethers.toUtf8Bytes(JSON.stringify(body.payload)),
      ) as `0x${string}`;
      const signer = verifyEip712(
        {
          RunRequest: [
            { name: "agentId", type: "uint256" },
            { name: "payloadHash", type: "bytes32" },
            { name: "deadline", type: "uint256" },
          ],
        },
        { agentId, payloadHash, deadline: body.deadline },
        body.signature,
        body.deadline,
      );
      await assertOwner(agentId, registryAddress, signer);

      // Resolve + decrypt the agent's skill from the chain and 0G Storage
      const agentData = await getAgentData(agentId, registryAddress);

      // Oracle is single-purpose: use the first registered handler.
      const handlerEntry = Object.entries(config.handlers)[0];
      if (!handlerEntry) {
        res.status(400).json({
          error:
            "No handlers registered. Add handlers via startOracle({ handlers: { ... } }).",
        });
        return;
      }
      const [skillType, handler] = handlerEntry;

      const result = await handler.run(
        agentData.skillContent,
        agentData.config,
        body.payload,
        { wallet, signingKey, blobs: agentData.blobs },
      );

      // Sign: keccak256(agentId ‖ type ‖ resultJson ‖ timestamp)
      const timestamp = Math.floor(Date.now() / 1000);
      const resultJson = JSON.stringify(result);
      const agentIdStr = agentId.toString();
      const digest = ethers.keccak256(
        ethers.concat([
          ethers.toUtf8Bytes(agentIdStr),
          ethers.toUtf8Bytes(skillType),
          ethers.toUtf8Bytes(resultJson),
          ethers.toBeArray(BigInt(timestamp)),
        ]),
      );
      const messageHash = ethers.keccak256(
        ethers.concat([
          ethers.toUtf8Bytes("\x19Ethereum Signed Message:\n32"),
          ethers.getBytes(digest),
        ]),
      );
      const sig = signingKey.sign(messageHash);
      const signature = ethers.Signature.from(sig).serialized as `0x${string}`;

      console.log(
        `[oracle] /run ok agentId=${agentIdStr} type=${skillType} result=${JSON.stringify(result)}`,
      );
      res.json({
        agentId: agentIdStr,
        type: skillType,
        result,
        timestamp,
        signature,
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
