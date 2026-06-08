/**
 * Encryption utilities for ERC-7857 private agent metadata.
 *
 * Strategy:
 *   - Content encryption: AES-256-GCM (symmetric, fast, authenticated)
 *   - Owner key management: ECDH shared-secret using the owner's Ethereum
 *     private key is NOT used directly (we never have it). Instead we store an
 *     ephemeral AES content key encrypted under the owner's public key via
 *     ECIES (Elliptic Curve Integrated Encryption Scheme).
 *
 * In the TEE transfer path the re-encryption happens inside the enclave;
 * this module handles the client-side decryption after the TEE verifier
 * confirms the transfer on-chain.
 *
 * Uses Node.js `node:crypto` for AES-GCM and ECIES for key wrapping.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { decrypt, encrypt } from "eciesjs";
import { NFTError } from "./types.js";
import type {
  AgentService,
  EncryptedBlob,
  ParsedServicesResult,
  ParseServicesOptions,
} from "./types.js";
import { keccak256, stringToHex } from "viem";
import { readZeroGBytes } from "./storage/zero-g.js";

const ALGORITHM = "aes-256-gcm";
const KEY_LEN = 32;
const IV_LEN = 12;
const AUTH_TAG_LEN = 16;

/**
 * Generate a fresh 32-byte AES content key.
 */
export function generateContentKey(): Uint8Array {
  return randomBytes(KEY_LEN);
}

function normalizeHexBytes(
  value: string | Uint8Array,
  label: string,
): Uint8Array {
  if (value instanceof Uint8Array) return value;
  const hex = value.startsWith("0x") ? value.slice(2) : value;
  if (hex.length === 0 || hex.length % 2 !== 0) {
    throw new NFTError(
      "ENCRYPTION_FAILED",
      `${label} must be a non-empty hex string.`,
    );
  }
  return Buffer.from(hex, "hex");
}

/**
 * Encrypt an arbitrary JSON-serialisable payload with a given AES-256-GCM key.
 * Returns an EncryptedBlob ready for object storage.
 */
export function encryptMetadata(
  name: string,
  metadata: unknown,
  contentKey: Uint8Array,
  keyEncryptionPublicKey: string | Uint8Array,
): EncryptedBlob {
  try {
    const plaintext = new TextEncoder().encode(JSON.stringify(metadata));
    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv(ALGORITHM, Buffer.from(contentKey), iv, {
      authTagLength: AUTH_TAG_LEN,
    });
    const ciphertext = Buffer.concat([
      cipher.update(plaintext),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    const recipientPublicKey = normalizeHexBytes(
      keyEncryptionPublicKey,
      "keyEncryptionPublicKey",
    );
    const wrappedKey = encrypt(recipientPublicKey, Buffer.from(contentKey));

    return {
      name,
      ciphertext: ciphertext.toString("hex"),
      iv: iv.toString("hex"),
      authTag: authTag.toString("hex"),
      encryptedKey: Buffer.from(wrappedKey).toString("hex"),
      algorithm: ALGORITHM,
    };
  } catch (err) {
    throw new NFTError(
      "ENCRYPTION_FAILED",
      `Metadata encryption failed: ${String(err)}`,
      err,
    );
  }
}

/**
 * Decrypt the wrapped AES content key using an ECIES private key.
 */
export function decryptContentKey(
  blob: Pick<EncryptedBlob, "encryptedKey">,
  keyEncryptionPrivateKey: string | Uint8Array,
): Uint8Array {
  try {
    const wrappedKey = normalizeHexBytes(
      blob.encryptedKey,
      "blob.encryptedKey",
    );
    const privateKey = normalizeHexBytes(
      keyEncryptionPrivateKey,
      "keyEncryptionPrivateKey",
    );
    return decrypt(privateKey, wrappedKey);
  } catch (err) {
    throw new NFTError(
      "DECRYPTION_FAILED",
      `Content key decryption failed: ${String(err)}`,
      err,
    );
  }
}

/**
 * Decrypt an EncryptedBlob back to its original JSON payload.
 * The caller must supply the content key (retrieved after ownership verification).
 */
export function decryptMetadata<T>(
  blob: EncryptedBlob,
  contentKey: Uint8Array,
): T {
  try {
    const iv = Buffer.from(blob.iv, "hex");
    const authTag = Buffer.from(blob.authTag, "hex");
    const ciphertext = Buffer.from(blob.ciphertext, "hex");

    const decipher = createDecipheriv(ALGORITHM, Buffer.from(contentKey), iv, {
      authTagLength: AUTH_TAG_LEN,
    });
    decipher.setAuthTag(authTag);

    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return JSON.parse(plaintext.toString("utf8")) as T;
  } catch (err) {
    throw new NFTError(
      "DECRYPTION_FAILED",
      `Metadata decryption failed: ${String(err)}`,
      err,
    );
  }
}

/**
 * Compute the keccak256 hash of the serialised EncryptedBlob.
 * This hash is stored on-chain as the integrity anchor.
 */
export async function hashEncryptedBlob(
  blob: EncryptedBlob,
): Promise<`0x${string}`> {
  return keccak256(stringToHex(JSON.stringify(blob)));
}

export function parseAgentServicesJson(
  json: unknown,
  options?: ParseServicesOptions,
): ParsedServicesResult {
  try {
    if (!Array.isArray(json)) {
      throw new Error("Services must be a JSON array.");
    }

    const missingFields = json.filter(
      (service) => !service?.name?.trim() || !service?.endpoint?.trim(),
    );

    if (missingFields.length > 0) {
      throw new Error(
        `Each service must have a name and endpoint ${JSON.stringify(missingFields.map((s) => ({ name: s?.name, endpoint: s?.endpoint })))}`,
      );
    }

    const services = json.map((service) => {
      const name = String(service.name).trim();
      const endpoint = String(service.endpoint).trim();
      const version = service.version
        ? String(service.version).trim()
        : undefined;
      const skills =
        Array.isArray(service.skills) &&
        service.skills.every((s: unknown) => typeof s === "string")
          ? (service.skills as string[])
          : undefined;
      const domains =
        Array.isArray(service.domains) &&
        service.domains.every((d: unknown) => typeof d === "string")
          ? (service.domains as string[])
          : undefined;

      return {
        name,
        endpoint,
        ...(version ? { version } : {}),
        ...(skills?.length ? { skills } : {}),
        ...(domains?.length ? { domains } : {}),
      } as AgentService;
    });

    if (options?.allowedServiceNames) {
      const allowed = new Set(options.allowedServiceNames);
      if (services.some((service) => !allowed.has(service.name))) {
        throw new Error(
          "Unsupported service name. Only EIP-8004 service names are allowed.",
        );
      }
    }

    return services;
  } catch (err) {
    if (err instanceof Error) throw err;
    throw new Error("Services JSON is invalid.");
  }
}

export async function readJsonFromUri<T>(uri: string): Promise<T> {
  if (uri.startsWith("data:")) {
    const [, base64] = uri.split(",");
    if (!base64) {
      throw new Error("data URI is missing a base64 payload.");
    }
    return JSON.parse(Buffer.from(base64, "base64").toString("utf8")) as T;
  }
  if (uri.startsWith("zerog://")) {
    const indexerUrl = process.env.INDEXER_URL_ZERO_G?.trim();
    if (!indexerUrl) {
      throw new Error("INDEXER_URL_ZERO_G is required to read zerog:// URIs.");
    }
    const bytes = await readZeroGBytes(uri, indexerUrl);
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  }
  // Translate ipfs:// to a public HTTP gateway
  const httpUri = uri.startsWith("ipfs://")
    ? `https://ipfs.io/ipfs/${uri.slice(7)}`
    : uri;
  const response = await fetch(httpUri);
  if (!response.ok) {
    throw new Error(`Failed to fetch JSON from ${uri}: ${response.status}`);
  }
  return (await response.json()) as T;
}
