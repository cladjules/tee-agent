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
 * Note: Web Crypto SubtleCrypto is used when available (browser / modern Node).
 * The Node.js `node:crypto` module is used as a fallback.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { decrypt, encrypt } from "eciesjs";
import { NFTError } from "./types.js";
import type { AgentNFTEncryptedData, AgentService } from "./types.js";
import type { Address, Hex } from "viem";
import { encodeAbiParameters, keccak256, stringToHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const ALGORITHM = "aes-256-gcm";
const KEY_LEN = 32;
const IV_LEN = 12;
const AUTH_TAG_LEN = 16;

export type ParsedServicesResult = {
  services?: AgentService[];
  error?: string;
};

export type ParseServicesOptions = {
  allowedServiceNames?: readonly string[];
};
export interface EncryptedBlob {
  /** Name of the encrypted metadata */
  name: string;
  /** Hex-encoded AES-256-GCM ciphertext */
  ciphertext: string;
  /** Hex-encoded IV (12 bytes) */
  iv: string;
  /** Hex-encoded GCM auth tag (16 bytes) */
  authTag: string;
  /** Hex-encoded AES content key wrapped with ECIES */
  encryptedKey: string;
  /** Algorithm identifier */
  algorithm: "aes-256-gcm";
}

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
  raw: string,
  options?: ParseServicesOptions,
): ParsedServicesResult {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return { error: "Services must be a JSON array." };
    }

    if (
      parsed.some(
        (service) => !service?.name?.trim() || !service?.endpoint?.trim(),
      )
    ) {
      return { error: "Each service must have a name and endpoint." };
    }

    const services = parsed.map((service) => {
      const name = String(service.name).trim();
      const endpoint = String(service.endpoint).trim();
      const version = service.version
        ? String(service.version).trim()
        : undefined;

      return version
        ? ({ name, endpoint, version } as AgentService)
        : ({ name, endpoint } as AgentService);
    });

    if (options?.allowedServiceNames) {
      const allowed = new Set(options.allowedServiceNames);
      if (services.some((service) => !allowed.has(service.name))) {
        return {
          error:
            "Unsupported service name. Only EIP-8004 service names are allowed.",
        };
      }
    }

    return { services };
  } catch {
    return { error: "Services JSON is invalid." };
  }
}

export function buildAgentServiceTraits(services: readonly AgentService[]) {
  const traits: Array<{ trait_type: string; value: string }> = [
    { trait_type: "Services Count", value: String(services.length) },
  ];

  for (const service of services) {
    traits.push({
      trait_type: `Service: ${service.name}`,
      value: service.endpoint,
    });
    if (service.version) {
      traits.push({
        trait_type: `Service Version: ${service.name}`,
        value: service.version,
      });
    }
  }

  return traits;
}

export async function readJsonFromUri<T>(
  uri: string,
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  if (uri.startsWith("data:")) {
    const base64 = uri.split(",")[1] ?? "";
    return JSON.parse(Buffer.from(base64, "base64").toString("utf8")) as T;
  }
  const response = await fetchImpl(uri);
  if (!response.ok) {
    throw new Error(`Failed to fetch JSON from ${uri}: ${response.status}`);
  }
  return (await response.json()) as T;
}

export function getPrivateMetadataEntries(
  systemPrompt: string,
  characterDef: string,
) {
  const entries: Array<{ name: string; value: unknown }> = [];

  if (systemPrompt) {
    entries.push({ name: "systemPrompt", value: systemPrompt });
  }

  if (characterDef) {
    entries.push({ name: "characterDefinition", value: characterDef });
  }

  return entries;
}

export async function encryptIntelligentData(params: {
  systemPrompt: string;
  characterDef: string;
  keyEncryptionPublicKey: Hex;
}): Promise<AgentNFTEncryptedData[]> {
  const { systemPrompt, characterDef, keyEncryptionPublicKey } = params;
  const contentKey = generateContentKey();
  const intelligentData: AgentNFTEncryptedData[] = [];

  for (const entry of getPrivateMetadataEntries(systemPrompt, characterDef)) {
    const encryptedBlob = encryptMetadata(
      entry.name,
      entry.value,
      contentKey,
      keyEncryptionPublicKey,
    );
    const hash = await hashEncryptedBlob(encryptedBlob);
    const blobJson = JSON.stringify(encryptedBlob);
    const uri = `data:application/json;base64,${Buffer.from(blobJson).toString("base64")}`;
    intelligentData.push({ name: entry.name, uri, hash });
  }

  return intelligentData;
}

export type TransferAccessPayload = {
  /** dataHash covered by this proof (matches the stored IntelligentData.dataHash). */
  dataHash: Hex;
  /** Recipient's public key (ECIES-compressed) or ABI-encoded address for dev. */
  targetPubkey: Hex;
  /** bytes32 nonce — fixed-size prevents abi.encodePacked collisions (F-002). */
  nonce: Hex;
  /**
   * innerHash the recipient passes to signMessage({ message: digest }) to produce
   * AccessProof.proof.  signMessage adds the EIP-191 prefix, which matches
   * Verifier.sol's Strings.toHexString / abi.encodePacked computation.
   */
  digest: Hex;
};

export type TransferOwnershipProof = {
  oracleType: number;
  dataHash: Hex;
  sealedKey: Hex;
  targetPubkey: Hex;
  /** bytes32 nonce — fixed-size prevents abi.encodePacked collisions (F-002). */
  nonce: Hex;
  /** Oracle's signature over the domain-bound innerHash. */
  proof: Hex;
};

export type SecureTransferPayloads = {
  from: Address;
  to: Address;
  tokenId: bigint;
  deadline: bigint;
  newDataHashes: Hex[];
  sealedKey: Hex;
  accessPayloads: TransferAccessPayload[];
  ownershipProofs: TransferOwnershipProof[];
};

// ---------------------------------------------------------------------------
// Domain-bound proof helpers — match Verifier.sol signing scheme exactly.
//
// innerHash = keccak256(abi.encode(
//   chainId, verifierAddr, registryAddr,  // chain + contract domain (F-001)
//   tokenId, from, to, deadline,          // transfer context
//   dataHash, [sealedKey,] targetPubkey, nonce  // proof-specific fields
// ))
// messageHash = keccak256("\x19Ethereum Signed Message:\n66" + toHexString(innerHash, 32))
//
// abi.encode + bytes32 nonce prevents hash collisions (F-002).
// ---------------------------------------------------------------------------

function _computeAccessInnerHash(
  chainId: bigint,
  verifierAddress: Address,
  registryAddress: Address,
  tokenId: bigint,
  from: Address,
  to: Address,
  deadline: bigint,
  dataHash: Hex,
  targetPubkey: Hex,
  nonce: Hex,
): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "address" },
        { type: "address" },
        { type: "uint256" },
        { type: "address" },
        { type: "address" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "bytes" },
        { type: "bytes32" },
      ],
      [
        chainId,
        verifierAddress,
        registryAddress,
        tokenId,
        from,
        to,
        deadline,
        dataHash,
        targetPubkey,
        nonce,
      ],
    ),
  );
}

function _computeOwnershipInnerHash(
  chainId: bigint,
  verifierAddress: Address,
  registryAddress: Address,
  tokenId: bigint,
  from: Address,
  to: Address,
  deadline: bigint,
  dataHash: Hex,
  sealedKey: Hex,
  targetPubkey: Hex,
  nonce: Hex,
): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "address" },
        { type: "address" },
        { type: "uint256" },
        { type: "address" },
        { type: "address" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "bytes" },
        { type: "bytes" },
        { type: "bytes32" },
      ],
      [
        chainId,
        verifierAddress,
        registryAddress,
        tokenId,
        from,
        to,
        deadline,
        dataHash,
        sealedKey,
        targetPubkey,
        nonce,
      ],
    ),
  );
}

/**
 * Build signed ownership proofs and unsigned access payloads for local dev
 * (no remote TEE oracle).  Both are signed with `oraclePrivateKey`.
 * The returned `accessPayloads[].digest` values must then be signed by the
 * recipient wallet before assembling the TransferValidityProof[] structs.
 */
export async function buildSecureTransferPayloads(params: {
  chainId: number;
  verifierAddress: Address;
  registryAddress: Address;
  tokenId: bigint;
  from: Address;
  to: Address;
  currentHashes: Hex[];
  oraclePrivateKey: Hex;
  deadline?: bigint;
}): Promise<SecureTransferPayloads> {
  const {
    chainId,
    verifierAddress,
    registryAddress,
    tokenId,
    from,
    to,
    currentHashes,
    oraclePrivateKey,
  } = params;
  const deadline =
    params.deadline ?? BigInt(Math.floor(Date.now() / 1000) + 3600);
  const oracleAccount = privateKeyToAccount(oraclePrivateKey);

  const accessPayloads: TransferAccessPayload[] = [];
  const ownershipProofs: TransferOwnershipProof[] = [];
  let sealedKey = "0x" as Hex;

  for (let index = 0; index < currentHashes.length; index += 1) {
    const dataHash = currentHashes[index] as Hex;
    // In the local dev path the target pubkey is just the ABI-encoded recipient address.
    const targetPubkey = encodeAbiParameters(
      [{ type: "address" }],
      [to],
    ) as Hex;

    const accessNonce = keccak256(
      encodeAbiParameters(
        [{ type: "uint256" }, { type: "uint256" }, { type: "string" }],
        [tokenId, BigInt(index), "access"],
      ),
    );
    const ownershipNonce = keccak256(
      encodeAbiParameters(
        [{ type: "uint256" }, { type: "uint256" }, { type: "string" }],
        [tokenId, BigInt(index), "ownership"],
      ),
    );

    const generatedSealedKey = keccak256(
      encodeAbiParameters(
        [
          { type: "uint256" },
          { type: "bytes32" },
          { type: "address" },
          { type: "uint256" },
        ],
        [tokenId, dataHash, to, BigInt(index)],
      ),
    );

    const accessInnerHash = _computeAccessInnerHash(
      BigInt(chainId),
      verifierAddress,
      registryAddress,
      tokenId,
      from,
      to,
      deadline,
      dataHash,
      targetPubkey,
      accessNonce,
    );

    const ownershipInnerHash = _computeOwnershipInnerHash(
      BigInt(chainId),
      verifierAddress,
      registryAddress,
      tokenId,
      from,
      to,
      deadline,
      dataHash,
      generatedSealedKey,
      targetPubkey,
      ownershipNonce,
    );

    const ownershipSignature = await oracleAccount.signMessage({
      message: ownershipInnerHash,
    });

    accessPayloads.push({
      dataHash,
      targetPubkey,
      nonce: accessNonce,
      digest: accessInnerHash,
    });

    ownershipProofs.push({
      oracleType: 0,
      dataHash,
      sealedKey: generatedSealedKey,
      targetPubkey,
      nonce: ownershipNonce,
      proof: ownershipSignature,
    });

    if (index === 0) {
      sealedKey = generatedSealedKey;
    }
  }

  return {
    from,
    to,
    tokenId,
    deadline,
    newDataHashes: [...currentHashes],
    sealedKey,
    accessPayloads,
    ownershipProofs,
  };
}

/**
 * Build unsigned access payloads for the oracle path.
 *
 * The oracle has already generated ownership proofs. This function computes
 * the access proof digests that the recipient wallet must sign before
 * assembling the TransferValidityProof[] structs.
 */
export function buildAccessPayloads(params: {
  chainId: number;
  verifierAddress: Address;
  registryAddress: Address;
  tokenId: bigint;
  from: Address;
  to: Address;
  deadline: bigint;
  currentHashes: readonly Hex[];
}): TransferAccessPayload[] {
  const {
    chainId,
    verifierAddress,
    registryAddress,
    tokenId,
    from,
    to,
    deadline,
    currentHashes,
  } = params;
  const targetPubkey = encodeAbiParameters([{ type: "address" }], [to]) as Hex;

  return currentHashes.map((dataHash, index) => {
    const nonce = keccak256(
      encodeAbiParameters(
        [{ type: "uint256" }, { type: "uint256" }, { type: "string" }],
        [tokenId, BigInt(index), "access"],
      ),
    );
    const innerHash = _computeAccessInnerHash(
      BigInt(chainId),
      verifierAddress,
      registryAddress,
      tokenId,
      from,
      to,
      deadline,
      dataHash as Hex,
      targetPubkey,
      nonce,
    );
    return {
      dataHash: dataHash as Hex,
      targetPubkey,
      nonce,
      digest: innerHash,
    };
  });
}

export function buildDecryptMessage(
  agentId: string,
  ownerAddress: string,
  signedAt: number,
) {
  return `Open Agents Toolkit decrypt request\nagentId:${agentId}\nowner:${ownerAddress.toLowerCase()}\nsignedAt:${signedAt}`;
}

export function decryptEncryptedBlob(
  blob: Record<string, unknown>,
  oraclePrivateKey: Hex,
): unknown {
  const encryptedKey =
    typeof blob.encryptedKey === "string" ? blob.encryptedKey : "";
  const ciphertext = typeof blob.ciphertext === "string" ? blob.ciphertext : "";
  const iv = typeof blob.iv === "string" ? blob.iv : "";
  const authTag = typeof blob.authTag === "string" ? blob.authTag : "";
  const name = typeof blob.name === "string" ? blob.name : "";

  if (!encryptedKey || !ciphertext || !iv || !authTag) {
    throw new Error("Encrypted blob format is invalid.");
  }

  const contentKey = decryptContentKey({ encryptedKey }, oraclePrivateKey);
  return decryptMetadata(
    {
      name,
      encryptedKey,
      ciphertext,
      iv,
      authTag,
      algorithm: "aes-256-gcm",
    },
    contentKey,
  );
}
