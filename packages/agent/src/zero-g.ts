/**
 * 0G Storage upload / download helper.
 *
 * Uses @0gfoundation/0g-ts-sdk to store data on the 0G decentralised
 * storage network. The Merkle root hash acts as the content identifier;
 * retrieval requires the 0G SDK or a compatible gateway.
 *
 * This module is independent of the chain config (Base/baseSepolia).
 * 0G Storage is an external file-storage layer; its endpoints are configured
 * separately via env vars or constructor options.
 *
 * Defaults to the 0G testnet storage cluster:
 *   ZERO_G_RPC_URL     — EVM RPC for signing storage transactions
 *                        (default: https://evmrpc-testnet.0g.ai)
 *   ZERO_G_INDEXER_URL — Storage indexer URL
 *                        (default: https://indexer-storage-testnet-standard.0g.ai)
 */

import { Indexer, MemData } from "@0gfoundation/0g-ts-sdk";
import { ethers } from "ethers";
import { RegistryError } from "./types.js";
import type { Hex } from "viem";
import {
  encryptMetadata,
  generateContentKey,
  hashEncryptedBlob,
} from "./encryption.js";
import type { AgentNFTEncryptedData } from "./types.js";

// ─── Default endpoints ────────────────────────────────────────────────────────

const DEFAULT_RPC_URL = "https://evmrpc-testnet.0g.ai";
// Turbo indexer is recommended; standard is currently unavailable on testnet.
const DEFAULT_INDEXER_URL = "https://indexer-storage-testnet-turbo.0g.ai";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ZeroGStorageOptions {
  /** 0x-prefixed hex private key used to sign upload transactions */
  privateKey: string;
  /**
   * EVM RPC endpoint for the 0G storage network.
   * Defaults to ZERO_G_RPC_URL env var or the 0G testnet public RPC.
   */
  rpcUrl?: string;
  /**
   * 0G Indexer RPC URL.
   * Defaults to ZERO_G_INDEXER_URL env var or the 0G testnet standard indexer.
   */
  indexerUrl?: string;
}

export interface ZeroGReadOptions {
  /**
   * 0G Indexer RPC URL.
   * Defaults to ZERO_G_INDEXER_URL env var or the 0G testnet standard indexer.
   */
  indexerUrl?: string;
}

/** Result shape returned by ZeroGStorageClient.uploadJSON / uploadBytes */
export interface ZeroGFlowUploadResult {
  readonly cid: string;
  readonly url: string;
  readonly size: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isTransientError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /50[234]|429|network|timeout|ECONNREFUSED|ETIMEDOUT/i.test(msg);
}

function resolveIndexerUrl(opts?: ZeroGReadOptions): string {
  return (
    opts?.indexerUrl ?? process.env["ZERO_G_INDEXER_URL"] ?? DEFAULT_INDEXER_URL
  );
}

function getRootHashFromUri(uri: string): string {
  return uri.startsWith("zerog://") ? uri.slice("zerog://".length) : uri;
}

// ─── Read helpers ─────────────────────────────────────────────────────────────

async function readZeroGBytes(
  uri: string,
  opts?: ZeroGReadOptions,
): Promise<Uint8Array> {
  const rootHash = getRootHashFromUri(uri);
  const indexer = new Indexer(resolveIndexerUrl(opts));
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

export async function readZeroGJSON<T>(
  uri: string,
  opts?: ZeroGReadOptions,
): Promise<T> {
  const bytes = await readZeroGBytes(uri, opts);
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch (err) {
    throw new RegistryError(
      "INVALID_METADATA",
      `0G Storage JSON decode failed for ${uri}: ${String(err)}`,
      err,
    );
  }
}

// ─── Upload client ────────────────────────────────────────────────────────────

export class ZeroGStorageClient {
  private readonly _rpcUrl: string;
  private readonly _indexerUrl: string;
  private readonly _privateKey: string;

  constructor(opts: ZeroGStorageOptions) {
    this._rpcUrl =
      opts.rpcUrl ?? process.env["ZERO_G_RPC_URL"] ?? DEFAULT_RPC_URL;
    this._indexerUrl =
      opts.indexerUrl ??
      process.env["ZERO_G_INDEXER_URL"] ??
      DEFAULT_INDEXER_URL;
    this._privateKey = opts.privateKey;
  }

  /**
   * Upload a JSON-serialisable object to 0G Storage.
   * Returns the rootHash (as `cid`), a `zerog://` URI, and byte size.
   */
  async uploadJSON(data: unknown): Promise<ZeroGFlowUploadResult> {
    const bytes = new TextEncoder().encode(JSON.stringify(data, null, 2));
    return this.uploadBytes(bytes);
  }

  /** Upload raw bytes to 0G Storage. */
  async uploadBytes(bytes: Uint8Array): Promise<ZeroGFlowUploadResult> {
    try {
      const provider = new ethers.JsonRpcProvider(this._rpcUrl);
      const signer = new ethers.Wallet(this._privateKey, provider);
      const indexer = new Indexer(this._indexerUrl);
      const memData = new MemData(bytes);
      // ethers v6 is runtime-compatible with the SDK's ethers v5 Signer interface.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [tx, err] = await indexer.upload(
        memData,
        this._rpcUrl,
        signer as any,
      );
      if (err || !tx) throw new Error(String(err ?? "no transaction returned"));
      const rootHash =
        "rootHash" in tx
          ? (tx as { rootHash: string }).rootHash
          : (tx as { rootHashes: string[] }).rootHashes[0];
      return { cid: rootHash, url: `zerog://${rootHash}`, size: bytes.length };
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

  getURL(rootHash: string): string {
    return `zerog://${rootHash}`;
  }
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
  zeroGPrivateKey: string;
  rpcUrl?: string;
  indexerUrl?: string;
}): Promise<AgentNFTEncryptedData[]> {
  const nonEmpty = params.entries.filter((e) => e.name.trim() && e.data.trim());
  if (nonEmpty.length === 0) return [];

  const client = new ZeroGStorageClient({
    privateKey: params.zeroGPrivateKey,
    ...(params.rpcUrl !== undefined && { rpcUrl: params.rpcUrl }),
    ...(params.indexerUrl !== undefined && { indexerUrl: params.indexerUrl }),
  });

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
    const { url } = await client.uploadBytes(bytes);
    result.push({ name: entry.name.trim(), uri: url, hash });
  }
  return result;
}
