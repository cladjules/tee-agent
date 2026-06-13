/**
 * 0G Storage upload / download helper.
 *
 * Uses @0gfoundation/0g-storage-ts-sdk to store data on the 0G decentralised
 * storage network. The Merkle root hash acts as the content identifier;
 * retrieval requires the 0G SDK or a compatible gateway.
 *
 * This module is independent of the chain config.
 * 0G Storage is an external file-storage layer; its endpoints are configured
 * separately via env vars or constructor options.
 *
 * Required 0G Storage endpoints:
 *   RPC_URL_ZERO_G     — EVM RPC for signing storage transactions
 *   INDEXER_URL_ZERO_G — Storage indexer URL
 */

import { Indexer, MemData } from "@0gfoundation/0g-storage-ts-sdk";
import { ethers } from "ethers";
import { RegistryError } from "../types.js";
import type { AgentNFTEncryptedData } from "../types.js";
import type { Hex } from "viem";
import {
  encryptMetadata,
  generateContentKey,
  hashEncryptedBlob,
} from "../crypto.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isTransientError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /50[234]|429|network|timeout|ECONNREFUSED|ETIMEDOUT/i.test(msg);
}

function isNonceError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /replacement|underpriced|nonce/i.test(msg);
}

function getRootHashFromUri(uri: string): string {
  return uri.startsWith("zerog://") ? uri.slice("zerog://".length) : uri;
}

type NonceState = {
  next?: bigint;
  lock: Promise<void>;
};

const uploadNonceStates = new Map<string, NonceState>();

async function allocateUploadNonce(
  provider: ethers.JsonRpcProvider,
  signer: ethers.Wallet,
  rpcUrl: string,
): Promise<bigint> {
  const key = `${rpcUrl}:${signer.address.toLowerCase()}`;
  let state = uploadNonceStates.get(key);
  if (!state) {
    state = { lock: Promise.resolve() };
    uploadNonceStates.set(key, state);
  }

  let release!: () => void;
  const previous = state.lock;
  state.lock = previous.then(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  await previous;

  try {
    const pending = BigInt(
      await provider.getTransactionCount(signer.address, "pending"),
    );
    const nonce =
      state.next !== undefined && state.next > pending ? state.next : pending;
    state.next = nonce + 1n;
    return nonce;
  } finally {
    release();
  }
}

// ─── Read helpers ─────────────────────────────────────────────────────────────

export async function readZeroGBytes(
  uri: string,
  indexerUrl: string,
): Promise<Uint8Array> {
  if (!indexerUrl) {
    throw new Error(
      "indexerUrl is required to read from 0G Storage. Provide it via options or INDEXER_URL_ZERO_G env var.",
    );
  }

  const rootHash = getRootHashFromUri(uri);
  const indexer = new Indexer(indexerUrl);
  const [blob, err] = await indexer.downloadToBlob(rootHash);
  if (err || !blob) {
    throw new RegistryError(
      "STORAGE_ERROR",
      `0G Storage download failed for ${uri}: ${String(err ?? "unknown error")}`,
      err,
    );
  }
  return new Uint8Array(await blob.arrayBuffer());
}

// ─── Upload helper ────────────────────────────────────────────────────────────

async function uploadBytes(
  bytes: Uint8Array,
  rpcUrl: string,
  indexerUrl: string,
  privateKey: string,
): Promise<{ chainId: string; url: string; size: number }> {
  let lastErr: unknown;
  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const signer = new ethers.Wallet(privateKey, provider);
    const indexer = new Indexer(indexerUrl);
    const memData = new MemData(bytes);

    for (let attempt = 0; attempt < 3; attempt++) {
      const nonce = await allocateUploadNonce(provider, signer, rpcUrl);
      // ethers v6 is runtime-compatible with the SDK's ethers v5 Signer interface.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [tx, err] = await indexer.upload(memData, rpcUrl, signer as any, {
        nonce,
      });
      if (!err && tx) {
        const rootHash =
          "rootHash" in tx
            ? (tx as { rootHash: string }).rootHash
            : (tx as { rootHashes: string[] }).rootHashes[0];
        return {
          chainId: rootHash,
          url: `zerog://${rootHash}`,
          size: bytes.length,
        };
      }

      lastErr = err ?? new Error("no transaction returned");
      if (!isNonceError(lastErr) || attempt === 2) {
        throw new Error(String(lastErr));
      }
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }

    throw new Error(String(lastErr ?? "no transaction returned"));
  } catch (err) {
    const hint = isTransientError(err)
      ? " (0G Storage may be temporarily unavailable — the upload transaction may already have been submitted; check your agent on-chain before retrying)"
      : "";
    throw new RegistryError(
      "STORAGE_ERROR",
      `0G Storage upload failed: ${String(err)}${hint}`,
      err,
    );
  }
}

/**
 * Upload raw bytes to 0G Storage and return the `zerog://` URI.
 * Suitable for re-encryption flows where the caller already has the byte payload.
 */
export async function uploadZeroGBytes(params: {
  bytes: Uint8Array;
  privateKey: string;
  rpcUrl?: string | undefined;
  indexerUrl?: string | undefined;
}): Promise<string> {
  const rpcUrl = params.rpcUrl;
  const indexerUrl = params.indexerUrl;

  if (!rpcUrl || !indexerUrl) {
    throw new Error(
      "Both rpcUrl and indexerUrl are required for 0G Storage uploads.",
    );
  }

  const { url } = await uploadBytes(
    params.bytes,
    rpcUrl,
    indexerUrl,
    params.privateKey,
  );
  return url;
}

// ─── High-level helper ────────────────────────────────────────────────────────

/**
 * Encrypt private agent data entries and upload each blob to 0G Storage.
 * Returns AgentNFTEncryptedData[] with `zerog://` URIs instead of data URIs.
 *
 * Each entry becomes one independently encrypted blob. All blobs share a
 * single content key (AES-256-GCM) that is ECIES-wrapped with the TEE public key.
 */
export async function uploadEncryptedIntelligentData(params: {
  entries: Array<{ name: string; data: string }>;
  keyEncryptionPublicKey: Hex;
  privateKey: string;
  rpcUrl?: string | undefined;
  indexerUrl?: string | undefined;
}): Promise<AgentNFTEncryptedData[]> {
  const nonEmpty = params.entries.filter((e) => e.name.trim() && e.data.trim());
  if (nonEmpty.length === 0) return [];

  const rpcUrl = params.rpcUrl;
  const indexerUrl = params.indexerUrl;

  if (!rpcUrl || !indexerUrl) {
    throw new Error(
      "Both rpcUrl and indexerUrl are required for 0G Storage uploads.",
    );
  }

  const contentKey = generateContentKey();
  const result: AgentNFTEncryptedData[] = [];

  for (const entry of nonEmpty) {
    let metadata: unknown;
    try {
      metadata = JSON.parse(entry.data);
    } catch {
      metadata = entry.data;
    }
    const encryptedBlob = encryptMetadata(
      entry.name.trim(),
      metadata,
      contentKey,
      params.keyEncryptionPublicKey,
    );
    const hash = await hashEncryptedBlob(encryptedBlob);
    const blobJson = JSON.stringify(encryptedBlob);
    const bytes = Buffer.from(blobJson);
    const { url } = await uploadBytes(
      bytes,
      rpcUrl,
      indexerUrl,
      params.privateKey,
    );
    result.push({ name: entry.name.trim(), uri: url, hash });
  }
  return result;
}
