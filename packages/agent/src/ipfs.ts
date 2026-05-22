/**
 * IPFS upload helper via Pinata.
 *
 * Uses the Pinata pinning HTTP API — no extra package required.
 * A JWT is required (PINATA_JWT env var or constructor option).
 *
 * Uploaded content is pinned at `ipfs://<CID>`.
 */

import { RegistryError } from "./types.js";

// ─── Pinata response shape ─────────────────────────────────────────────────

interface PinataPinResponse {
  IpfsHash: string;
  PinSize: number;
  Timestamp: string;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface IpfsClientOptions {
  /** Pinata JWT (Bearer token). Defaults to PINATA_JWT env var. */
  jwt?: string;
  /** Pinata pinning API base URL. Defaults to https://api.pinata.cloud. */
  baseUrl?: string;
}

export interface IpfsUploadResult {
  /** IPFS CID (v0 or v1 depending on Pinata config) */
  readonly cid: string;
  /** Canonical `ipfs://` URI */
  readonly url: string;
  /** Pinned byte size */
  readonly size: number;
}

// ─── Client ───────────────────────────────────────────────────────────────────

export class IpfsClient {
  private readonly _jwt: string;
  private readonly _baseUrl: string;

  constructor(opts: IpfsClientOptions = {}) {
    const jwt = opts.jwt ?? process.env["PINATA_JWT"];
    if (!jwt) {
      throw new RegistryError(
        "STORAGE_ERROR",
        "IPFS upload requires a Pinata JWT. Set PINATA_JWT env var or pass jwt option.",
      );
    }
    this._jwt = jwt;
    this._baseUrl = opts.baseUrl ?? "https://api.pinata.cloud";
  }

  /**
   * Pin a JSON-serialisable object to IPFS via Pinata.
   * Returns the CID, an `ipfs://` URI, and the byte size.
   */
  async uploadJSON(data: unknown, name?: string): Promise<IpfsUploadResult> {
    const body = {
      pinataContent: data,
      ...(name !== undefined && { pinataMetadata: { name } }),
    };

    let response: Response;
    try {
      response = await fetch(`${this._baseUrl}/pinning/pinJSONToIPFS`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this._jwt}`,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new RegistryError(
        "STORAGE_ERROR",
        `IPFS upload network error: ${String(err)}`,
        err,
      );
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new RegistryError(
        "STORAGE_ERROR",
        `Pinata upload failed (${response.status}): ${text}`,
      );
    }

    const result = (await response.json()) as PinataPinResponse;
    const cid = result.IpfsHash;
    return {
      cid,
      url: `ipfs://${cid}`,
      size: result.PinSize,
    };
  }

  /** Canonical `ipfs://` URI from a raw CID string. */
  static toUri(cid: string): string {
    return `ipfs://${cid}`;
  }
}
