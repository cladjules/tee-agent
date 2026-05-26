import { describe, it, expect } from "vitest";
import {
  generateContentKey,
  encryptMetadata,
  decryptMetadata,
  decryptContentKey,
  hashEncryptedBlob,
  parseAgentServicesJson,
} from "./encryption.js";
import { PrivateKey } from "eciesjs";

// Generate a fresh ECIES key pair for each test run
const recipientPrivKey = new PrivateKey();
const recipientPubKeyBytes = recipientPrivKey.publicKey.toBytes(); // 33-byte compressed
const recipientPrivKeyBytes = recipientPrivKey.secret; // 32-byte private key

describe("generateContentKey", () => {
  it("returns a 32-byte Uint8Array", () => {
    const key = generateContentKey();
    expect(key).toBeInstanceOf(Uint8Array);
    expect(key.length).toBe(32);
  });

  it("returns different keys on successive calls", () => {
    const a = generateContentKey();
    const b = generateContentKey();
    expect(Buffer.from(a).toString("hex")).not.toBe(
      Buffer.from(b).toString("hex"),
    );
  });
});

describe("encryptMetadata / decryptMetadata", () => {
  it("round-trips a simple object", () => {
    const contentKey = generateContentKey();
    const payload = { hello: "world", num: 42 };

    const blob = encryptMetadata(
      "test-blob",
      payload,
      contentKey,
      recipientPubKeyBytes,
    );

    expect(blob.algorithm).toBe("aes-256-gcm");
    expect(blob.name).toBe("test-blob");
    expect(blob.ciphertext).toBeTruthy();
    expect(blob.iv).toBeTruthy();
    expect(blob.authTag).toBeTruthy();
    expect(blob.encryptedKey).toBeTruthy();

    const decrypted = decryptMetadata<typeof payload>(blob, contentKey);
    expect(decrypted).toEqual(payload);
  });

  it("round-trips a nested object", () => {
    const contentKey = generateContentKey();
    const payload = { a: { b: { c: [1, 2, 3] } }, flag: true };
    const blob = encryptMetadata(
      "nested",
      payload,
      contentKey,
      recipientPubKeyBytes,
    );
    expect(decryptMetadata(blob, contentKey)).toEqual(payload);
  });

  it("throws on wrong content key", () => {
    const contentKey = generateContentKey();
    const blob = encryptMetadata(
      "test",
      { x: 1 },
      contentKey,
      recipientPubKeyBytes,
    );
    const wrongKey = generateContentKey();
    expect(() => decryptMetadata(blob, wrongKey)).toThrow();
  });
});

describe("decryptContentKey", () => {
  it("recovers the original content key via ECIES", () => {
    const contentKey = generateContentKey();
    const blob = encryptMetadata(
      "test",
      { v: 1 },
      contentKey,
      recipientPubKeyBytes,
    );

    const recovered = decryptContentKey(blob, recipientPrivKeyBytes);
    expect(Buffer.from(recovered).toString("hex")).toBe(
      Buffer.from(contentKey).toString("hex"),
    );
  });

  it("throws on wrong private key", () => {
    const contentKey = generateContentKey();
    const blob = encryptMetadata(
      "test",
      { v: 1 },
      contentKey,
      recipientPubKeyBytes,
    );
    const wrongPrivKey = new PrivateKey();
    expect(() => decryptContentKey(blob, wrongPrivKey.secret)).toThrow();
    void recipientPrivKeyBytes; // suppress unused warning
  });
});

describe("hashEncryptedBlob", () => {
  it("returns a 0x-prefixed hex string", async () => {
    const contentKey = generateContentKey();
    const blob = encryptMetadata(
      "test",
      { x: 1 },
      contentKey,
      recipientPubKeyBytes,
    );
    const hash = await hashEncryptedBlob(blob);
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("is deterministic for the same blob", async () => {
    const contentKey = generateContentKey();
    const blob = encryptMetadata(
      "test",
      { x: 1 },
      contentKey,
      recipientPubKeyBytes,
    );
    const h1 = await hashEncryptedBlob(blob);
    const h2 = await hashEncryptedBlob(blob);
    expect(h1).toBe(h2);
  });

  it("differs for different blobs", async () => {
    const key = generateContentKey();
    const b1 = encryptMetadata("a", { x: 1 }, key, recipientPubKeyBytes);
    const b2 = encryptMetadata("b", { x: 2 }, key, recipientPubKeyBytes);
    expect(await hashEncryptedBlob(b1)).not.toBe(await hashEncryptedBlob(b2));
  });
});

describe("parseAgentServicesJson", () => {
  it("parses a valid services array", () => {
    const raw = JSON.stringify([
      { name: "web", endpoint: "https://example.com" },
    ]);
    const result = parseAgentServicesJson(raw);
    expect(result.error).toBeUndefined();
    expect(result.services).toHaveLength(1);
    expect(result.services![0]!.name).toBe("web");
  });

  it("parses optional fields", () => {
    const raw = JSON.stringify([
      {
        name: "MCP",
        endpoint: "https://mcp.example.com",
        version: "2025-06-18",
      },
    ]);
    const { services } = parseAgentServicesJson(raw);
    expect(services![0]!.version).toBe("2025-06-18");
  });

  it("returns error for non-array input", () => {
    const { error } = parseAgentServicesJson('{"name":"web"}');
    expect(error).toMatch(/array/i);
  });

  it("returns error when name is missing", () => {
    const raw = JSON.stringify([{ endpoint: "https://example.com" }]);
    const { error } = parseAgentServicesJson(raw);
    expect(error).toBeTruthy();
  });

  it("returns error when endpoint is missing", () => {
    const raw = JSON.stringify([{ name: "web" }]);
    const { error } = parseAgentServicesJson(raw);
    expect(error).toBeTruthy();
  });

  it("returns error for invalid JSON", () => {
    const { error } = parseAgentServicesJson("not json");
    expect(error).toBeTruthy();
  });

  it("returns error for disallowed service names", () => {
    const raw = JSON.stringify([
      { name: "unknown", endpoint: "https://x.com" },
    ]);
    const { error } = parseAgentServicesJson(raw, {
      allowedServiceNames: ["web", "MCP"],
    });
    expect(error).toMatch(/unsupported/i);
  });

  it("passes when service name is in the allowed list", () => {
    const raw = JSON.stringify([{ name: "web", endpoint: "https://x.com" }]);
    const { error, services } = parseAgentServicesJson(raw, {
      allowedServiceNames: ["web", "MCP"],
    });
    expect(error).toBeUndefined();
    expect(services).toHaveLength(1);
  });
});
