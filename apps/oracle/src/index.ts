/**
 * TEE Re-Encryption Oracle Server
 * ─────────────────────────────────────────────────────────────────────────────
 * Runs inside an Intel TDX Confidential VM on Phala Cloud.
 *
 * The dstack SDK derives a deterministic secp256k1 signing key that is
 * hardware-bound to the enclave's `app_id` measurement. The same path always
 * produces the same key for the same app build, so the oracle address is
 * stable and can be registered once in `TeeVerifier.updateOracleAddress()`.
 *
 * ## Full re-encryption flow
 *
 * 1. Client decrypts the old content key locally with their wallet private key.
 * 2. Client sends the plaintext content key + blob URIs to this endpoint.
 * 3. Oracle fetches each encrypted blob (supports data: URIs inline).
 * 4. Oracle decrypts each blob with the old content key inside the TDX enclave.
 * 5. Oracle generates a fresh AES-256 content key.
 * 6. Oracle re-encrypts each blob with the new key.
 * 7. Oracle ECIES-wraps the new content key to the receiver's public key.
 * 8. Oracle signs per-blob ownership proofs with its TDX-derived key.
 * 9. New blobs are returned inline (as base64-encoded JSON) — no external upload.
 *
 * ## Endpoints
 *
 * GET  /health          — liveness check
 * GET  /address         — oracle's Ethereum signing address + attestation quote
 * POST /reencrypt       — full re-encryption: fetch → decrypt → re-encrypt → return
 *
 * ## POST /reencrypt body
 * ```json
 * {
 *   "tokenId": "42",
 *   "from": "0x…",
 *   "to": "0x…",
 *   "chainId": 84532,
 *   "verifierAddress": "0x…",
 *   "registryAddress": "0x…",
 *   "deadline": 1234567890,
 *   "intelligentDataHashes": ["0x…"],
 *   "blobUris": ["data:application/json;base64,…"],
 *   "contentKey": "<base64>",
 *   "targetPubkey": "0x02…"
 * }
 * ```
 *
 * ## POST /reencrypt response (OracleReEncryptResponse)
 * ```json
 * {
 *   "newDataHashes": ["0x…"],
 *   "sealedKey": "0x…",
 *   "ownershipProofs": [{ "oracleType": 0, "dataHash": "0x…",
 *     "sealedKey": "0x…", "targetPubkey": "0x…", "nonce": "0x…", "proof": "0x…" }],
 *   "newBlobUris": ["data:application/json;base64,…"]
 * }
 * ```
 *
 * The caller must still sign access proofs with the recipient wallet and assemble
 * TransferValidityProof[] before calling AgentRegistry.iTransferFrom().
 *
 * ## Ownership proof signing (matches Verifier.sol _verifyOwnershipProof)
 * innerHash = keccak256(abi.encode(
 *   chainId, verifierAddress, registryAddress, tokenId, from, to, deadline,
 *   dataHash, sealedKey, targetPubkey, nonce
 * ))
 * messageHash = keccak256("\x19Ethereum Signed Message:\n66" + toHexString(innerHash, 32))
 * proof = sign(messageHash) directly (no additional EIP-191 prefix)
 */

import express, { type Request, type Response } from "express";
import { TappdClient } from "@phala/dstack-sdk";
import { encrypt } from "eciesjs";
import { ethers } from "ethers";
import { Indexer, MemData } from "@0gfoundation/0g-ts-sdk";
import { z } from "zod";
import {
  decryptMetadata,
  encryptMetadata,
  generateContentKey,
  hashEncryptedBlob,
  type EncryptedBlob,
} from "@open-agents-toolkit/agent/encryption";

// ─── Config ───────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT ?? "3000", 10);
const KEY_PATH = "oracle/reencrypt";
const ZERO_G_RPC_URL =
  process.env.ZERO_G_RPC_URL ?? "https://evmrpc-testnet.0g.ai";
const ZERO_G_INDEXER_URL =
  process.env.ZERO_G_INDEXER_URL ??
  "https://indexer-storage-testnet-standard.0g.ai";

// ─── TEE key initialisation ───────────────────────────────────────────────────

const tappd = new TappdClient();
const keyResponse = await tappd.deriveKey(KEY_PATH);

const wallet = new ethers.Wallet(ethers.hexlify(keyResponse.asUint8Array(32)));
const signingKey = new ethers.SigningKey(wallet.privateKey);
console.log(`[oracle] TEE signing address: ${wallet.address}`);

// ─── Request validation ───────────────────────────────────────────────────────

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
    contentKey: z.string(),
    targetPubkey: z.string(),
  })
  .refine(
    (b) => b.intelligentDataHashes.length === b.blobUris.length,
    "intelligentDataHashes and blobUris must have the same length.",
  );

type ReEncryptBody = z.infer<typeof reEncryptBodySchema>;

function validateBody(body: unknown): ReEncryptBody {
  return reEncryptBodySchema.parse(body);
}

// ─── 0G Storage helpers ───────────────────────────────────────────────────────

async function downloadFromZeroG(uri: string): Promise<Uint8Array> {
  const rootHash = uri.startsWith("zerog://")
    ? uri.slice("zerog://".length)
    : uri;
  const indexer = new Indexer(ZERO_G_INDEXER_URL);
  const [blob, err] = await indexer.downloadToBlob(rootHash);
  if (err || !blob) {
    throw new Error(
      `0G download failed for ${uri}: ${String(err ?? "unknown")}`,
    );
  }
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [tx, err] = await indexer.upload(
    memData,
    ZERO_G_RPC_URL,
    signer as any,
  );
  if (err || !tx) {
    throw new Error(`0G upload failed: ${String(err ?? "no tx")}`);
  }
  const rootHash =
    "rootHash" in tx
      ? (tx as { rootHash: string }).rootHash
      : (tx as { rootHashes: string[] }).rootHashes[0];
  return `zerog://${rootHash}`;
}

// ─── Blob fetching ────────────────────────────────────────────────────────────

async function fetchBlob(uri: string): Promise<EncryptedBlob> {
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
  const response = await fetch(uri);
  if (!response.ok) {
    throw new Error(`Failed to fetch blob from ${uri}: ${response.status}`);
  }
  return (await response.json()) as EncryptedBlob;
}

// ─── Re-encryption logic ──────────────────────────────────────────────────────

const abiCoder = ethers.AbiCoder.defaultAbiCoder();

async function reencrypt(body: ReEncryptBody) {
  const oldContentKey = Buffer.from(body.contentKey, "base64");

  const pubKeyHex = body.targetPubkey.startsWith("0x")
    ? body.targetPubkey.slice(2)
    : body.targetPubkey;
  const recipientPublicKey = Buffer.from(pubKeyHex, "hex");

  // Fresh AES-256 content key — old owner's key becomes useless after transfer
  const newContentKey = generateContentKey();

  // ECIES-wrap new content key to recipient — same value for all blobs
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

    // Fetch and verify blob
    const blob = await fetchBlob(uri);
    const actualHash = await hashEncryptedBlob(blob);
    if (actualHash !== expectedHash) {
      throw new Error(
        `Hash mismatch for blob ${i}: expected ${expectedHash}, got ${actualHash}`,
      );
    }

    // Decrypt with old key, re-encrypt with new key
    const plaintext = decryptMetadata<unknown>(blob, oldContentKey);
    const newBlob = encryptMetadata(
      blob.name,
      plaintext,
      newContentKey,
      recipientPublicKey,
    );

    // Upload re-encrypted blob to 0G Storage
    const zeroGKey = process.env.ZERO_G_PRIVATE_KEY ?? wallet.privateKey;
    const blobBytes = new TextEncoder().encode(JSON.stringify(newBlob));
    const newBlobUri = await uploadToZeroG(blobBytes, zeroGKey);
    newBlobUris.push(newBlobUri);

    const newDataHash = await hashEncryptedBlob(newBlob);
    newDataHashes.push(newDataHash);

    // Ownership proof signing (matches Verifier.sol _verifyOwnershipProof domain)
    // nonce: bytes32 = keccak256(deterministic seed)
    const nonceBytes = ethers.keccak256(
      ethers.toUtf8Bytes(`ownership:${body.tokenId}:${i}:${Date.now()}`),
    );
    const nonce = nonceBytes as `0x${string}`;

    // targetPubkey for ownership proof = same as access proof targetPubkey
    const targetPubkeyBytes = `0x${pubKeyHex}` as `0x${string}`;

    // innerHash = keccak256(abi.encode(chainId, verifier, registry, tokenId, from, to, deadline, dataHash, sealedKey, targetPubkey, nonce))
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
          newDataHash,
          sealedKey,
          targetPubkeyBytes,
          nonce,
        ],
      ),
    );

    // messageHash = keccak256("\x19Ethereum Signed Message:\n66" + toHexString(innerHash, 32))
    // We sign the innerHash as a hex string — viem/ethers signMessage adds the correct prefix.
    // The 66-char "0x"+64hex string is what Strings.toHexString(uint256(innerHash), 32) produces.
    const messageHash = ethers.keccak256(
      ethers.concat([
        ethers.toUtf8Bytes("\x19Ethereum Signed Message:\n66"),
        ethers.toUtf8Bytes(innerHash), // "0x" + 64 hex chars = 66 chars
      ]),
    );

    // Sign the messageHash directly (no additional EIP-191 prefix)
    const sig = signingKey.sign(messageHash);
    const proof = ethers.Signature.from(sig).serialized as `0x${string}`;

    ownershipProofs.push({
      oracleType: 0,
      dataHash: newDataHash,
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
app.use(express.json());

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

app.get("/address", async (_req: Request, res: Response) => {
  try {
    const quote = await tappd.tdxQuote(wallet.address);
    res.json({ address: wallet.address, quote: quote.quote });
  } catch {
    res.json({ address: wallet.address });
  }
});

app.post("/reencrypt", async (req: Request, res: Response) => {
  try {
    const body = validateBody(req.body);
    const result = await reencrypt(body);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: message });
  }
});

app.listen(PORT, () => {
  console.log(`[oracle] listening on port ${PORT}`);
});
