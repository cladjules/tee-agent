/**
 * IPFS upload helper via Pinata V3 API.
 *
 * Uses the Pinata V3 uploads API — no extra package required.
 * A JWT with the `org:files:write` scope is required (PINATA_JWT env var or
 * constructor option).
 *
 * Uploaded content is pinned publicly at `ipfs://<CID>`.
 */

import { RegistryError } from "../types.js";
import type { IpfsClientOptions, IpfsUploadResult } from "../types.js";

// ─── Pinata V3 response shape ─────────────────────────────────────────────────

interface PinataV3Response {
  IpfsHash?: string;
  cid?: string;
  data?: {
    id: string;
    name: string;
    chainId?: string;
    cid?: string;
    IpfsHash?: string;
    hash?: string;
    created_at: string;
    size: number;
    mime_type: string;
    user_id: string;
    group_id: string | null;
    is_duplicate: boolean | null;
  };
}

// ─── Upload ───────────────────────────────────────────────────────────────────

/**
 * Pin a JSON-serialisable object to IPFS via Pinata V3.
 * Files are uploaded to the public IPFS network so they are gateway-accessible.
 * Returns the CID, an `ipfs://` URI, and the byte size.
 */
export async function uploadJSONToIPFS(
  data: unknown,
  name?: string,
  opts: IpfsClientOptions = {},
): Promise<IpfsUploadResult> {
  const jwt = opts.jwt;
  const baseUrl = opts.baseUrl ?? "https://uploads.pinata.cloud";
  if (!jwt) {
    throw new RegistryError(
      "STORAGE_ERROR",
      "IPFS upload requires a Pinata JWT. Set PINATA_JWT env var or pass jwt option.",
    );
  }

  const json = JSON.stringify(data);
  const blob = new Blob([json], { type: "application/json" });
  const form = new FormData();
  form.append("file", blob, name ? `${name}.json` : "upload.json");
  form.append("network", "public");
  if (name) form.append("name", name);

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/v3/files`, {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}` },
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
  const cid =
    result.data?.cid ??
    result.data?.IpfsHash ??
    result.data?.chainId ??
    result.data?.hash ??
    result.cid ??
    result.IpfsHash;
  if (!cid) {
    throw new RegistryError(
      "STORAGE_ERROR",
      `Pinata upload response did not include an IPFS CID: ${JSON.stringify(result).slice(0, 500)}`,
    );
  }

  return {
    chainId: cid,
    url: `ipfs://${cid}`,
    size: result.data?.size ?? json.length,
  };
}
