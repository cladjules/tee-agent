import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  generateContentKey,
  encryptMetadata,
  decryptMetadata,
  decryptContentKey,
  hashEncryptedBlob,
  parseAgentServicesJson,
} from "../src/crypto.js";
import { PrivateKey } from "eciesjs";

// Generate a fresh ECIES key pair for each test run
const recipientPrivKey = new PrivateKey();
const recipientPubKeyBytes = recipientPrivKey.publicKey.toBytes(); // 33-byte compressed
const recipientPrivKeyBytes = recipientPrivKey.secret; // 32-byte private key

describe("generateContentKey", () => {
  it("returns a 32-byte Uint8Array", () => {
    const key = generateContentKey();
    assert.ok(key instanceof Uint8Array);
    assert.strictEqual(key.length, 32);
  });

  it("returns different keys on successive calls", () => {
    const a = generateContentKey();
    const b = generateContentKey();
    assert.notStrictEqual(
      Buffer.from(a).toString("hex"),
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

    assert.strictEqual(blob.algorithm, "aes-256-gcm");
    assert.strictEqual(blob.name, "test-blob");
    assert.ok(blob.ciphertext);
    assert.ok(blob.iv);
    assert.ok(blob.authTag);
    assert.ok(blob.encryptedKey);

    const decrypted = decryptMetadata<typeof payload>(blob, contentKey);
    assert.deepStrictEqual(decrypted, payload);
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
    assert.deepStrictEqual(decryptMetadata(blob, contentKey), payload);
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
    assert.throws(() => decryptMetadata(blob, wrongKey));
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
    assert.strictEqual(
      Buffer.from(recovered).toString("hex"),
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
    assert.throws(() => decryptContentKey(blob, wrongPrivKey.secret));
    void recipientPrivKeyBytes;
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
    assert.match(hash, /^0x[0-9a-f]{64}$/);
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
    assert.strictEqual(h1, h2);
  });

  it("differs for different blobs", async () => {
    const key = generateContentKey();
    const b1 = encryptMetadata("a", { x: 1 }, key, recipientPubKeyBytes);
    const b2 = encryptMetadata("b", { x: 2 }, key, recipientPubKeyBytes);
    assert.notStrictEqual(
      await hashEncryptedBlob(b1),
      await hashEncryptedBlob(b2),
    );
  });
});

describe("parseAgentServicesJson", () => {
  it("parses a valid services array", () => {
    const raw = [{ name: "web", endpoint: "https://example.com" }];
    const result = parseAgentServicesJson(raw);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0]!.name, "web");
  });

  it("parses optional fields", () => {
    const raw = [
      {
        name: "MCP",
        endpoint: "https://mcp.example.com",
        version: "2025-06-18",
      },
    ];
    const result = parseAgentServicesJson(raw);
    assert.strictEqual(result[0]!.version, "2025-06-18");
  });

  it("throws for non-array input", () => {
    assert.throws(() => parseAgentServicesJson('{"name":"web"}'), /array/i);
  });

  it("throws when name is missing", () => {
    const raw = [{ endpoint: "https://example.com" }];
    assert.throws(() => parseAgentServicesJson(raw));
  });

  it("throws when endpoint is missing", () => {
    const raw = [{ name: "web" }];
    assert.throws(() => parseAgentServicesJson(raw));
  });

  it("throws for invalid JSON", () => {
    assert.throws(() => parseAgentServicesJson("not json"));
  });

  it("throws for disallowed service names", () => {
    const raw = [{ name: "unknown", endpoint: "https://x.com" }];
    assert.throws(
      () =>
        parseAgentServicesJson(raw, { allowedServiceNames: ["web", "MCP"] }),
      /unsupported/i,
    );
  });

  it("passes when service name is in the allowed list", () => {
    const raw = [{ name: "web", endpoint: "https://x.com" }];
    const result = parseAgentServicesJson(raw, {
      allowedServiceNames: ["web", "MCP"],
    });
    assert.strictEqual(result.length, 1);
  });
});
