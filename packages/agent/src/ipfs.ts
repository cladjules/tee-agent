/**
 * IPFS upload helper via Pinata V3 API.
 *
 * Uses the Pinata V3 uploads API — no extra package required.
 * A JWT with the `org:files:write` scope is required (PINATA_JWT env var or
 * constructor option).
 *
 * Uploaded content is pinned publicly at `ipfs://<CID>`.
 */

import { RegistryError } from "./types.js";

// ─── Pinata V3 response shape ─────────────────────────────────────────────────

interface PinataV3Response {
  data: {
    id: string;
    name: string;
    cid: string;
    created_at: string;
    size: number;
    mime_type: string;
    user_id: string;
    group_id: string | null;
    is_duplicate: boolean | null;
  };
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface IpfsClientOptions {
  /** Pinata JWT (Bearer token). Defaults to PINATA_JWT env var. */
  jwt?: string;
  /** Pinata V3 uploads base URL. Defaults to https://uploads.pinata.cloud. */
  baseUrl?: string;
}

export interface IpfsUploadResult {
  /** IPFS CID */
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
    this._baseUrl = opts.baseUrl ?? "https://uploads.pinata.cloud";
  }

  /**
   * Pin a JSON-serialisable object to IPFS via Pinata V3.
   * Files are uploaded to the public IPFS network so they are gateway-accessible.
   * Returns the CID, an `ipfs://` URI, and the byte size.
   */
  async uploadJSON(data: unknown, name?: string): Promise<IpfsUploadResult> {
    const json = JSON.stringify(data);
    const blob = new Blob([json], { type: "application/json" });
    const form = new FormData();
    form.append("file", blob, name ? `${name}.json` : "upload.json");
    form.append("network", "public");
    if (name) form.append("name", name);

    let response: Response;
    try {
      response = await fetch(`${this._baseUrl}/v3/files`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this._jwt}` },
        body: form,
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

    const result = (await response.json()) as PinataV3Response;
    const cid = result.data.cid;
    return {
      cid,
      url: `ipfs://${cid}`,
      size: result.data.size,
    };
  }

  /** Canonical `ipfs://` URI from a raw CID string. */
  static toUri(cid: string): string {
    return `ipfs://${cid}`;
  }
}
