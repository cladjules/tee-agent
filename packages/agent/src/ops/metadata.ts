import { uploadJSONToIPFS } from "../storage/ipfs.js";
import type { AgentConfig } from "../types.js";

/**
 * Uploads a metadata JSON object to IPFS (when pinataJwt is configured) or
 * encodes it as an inline `data:application/json;base64,` URI.
 */
export async function uploadMetadata(
  config: AgentConfig,
  metadata: Record<string, unknown>,
  label: string,
): Promise<string> {
  if (config.pinataJwt) {
    const upload = await uploadJSONToIPFS(metadata, label, {
      jwt: config.pinataJwt,
    });
    return upload.url;
  }
  return `data:application/json;base64,${Buffer.from(
    JSON.stringify(metadata),
  ).toString("base64")}`;
}
