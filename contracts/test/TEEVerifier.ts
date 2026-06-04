import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  encodeAbiParameters,
  encodePacked,
  hashMessage,
  keccak256,
  parseAbiParameters,
  toBytes,
  toHex,
  zeroAddress,
  type Address,
  type WalletClient,
} from "viem";
import { network } from "hardhat";

const { viem, networkHelpers } = await network.create();

// ---------------------------------------------------------------------------
// Proof-building helpers — must match TeeVerifier.sol's signing scheme exactly.
//
// Signing format (domain-bound to prevent cross-chain/cross-token replay, F-001):
//   innerHash = keccak256(abi.encode(
//       chainId, verifier, registry,          // chain + contract domain
//       tokenId, from, to, deadline,          // transfer context
//       dataHash, [sealedKey,] targetPubkey, nonce  // proof fields
//   ))
//   messageHash = keccak256("\x19Ethereum Signed Message:\n66" + toHexString(innerHash, 32))
//
// abi.encode (not encodePacked) + bytes32 nonce prevents hash collisions (F-002).
// In viem: signMessage({ message: innerHash }) where innerHash is "0x"+64hex
//   → keccak256("\x19Ethereum Signed Message:\n66" + innerHash)
//   which matches Solidity's Strings.toHexString approach.
// ---------------------------------------------------------------------------

type ProofContext = {
  chainId: bigint;
  verifierAddress: Address;
  registryAddress: Address;
  tokenId: bigint;
  from: Address;
  to: Address;
  deadline: bigint;
};

/**
 * Build the access proof signature (signed by the receiver / access assistant).
 * innerHash = keccak256(abi.encode(chainId, verifier, registry, tokenId, from, to,
 *                                   deadline, dataHash, targetPubkey, nonce))
 */
async function buildAccessProofSignature(
  signer: WalletClient,
  ctx: ProofContext,
  dataHash: `0x${string}`,
  targetPubkey: `0x${string}`,
  nonce: `0x${string}`, // bytes32
): Promise<`0x${string}`> {
  const innerHash = keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "uint256, address, address, uint256, address, address, uint256, bytes32, bytes, bytes32",
      ),
      [
        ctx.chainId,
        ctx.verifierAddress,
        ctx.registryAddress,
        ctx.tokenId,
        ctx.from,
        ctx.to,
        ctx.deadline,
        dataHash,
        targetPubkey,
        nonce,
      ],
    ),
  );
  // innerHash is "0x" + 64 hex = 66 chars.
  // signMessage({ message: string }) signs keccak256("\x19Ethereum Signed Message:\n66" + innerHash)
  // which matches TeeVerifier.sol's Strings.toHexString encoding.
  return signer.signMessage({ message: innerHash, account: signer.account! });
}

/**
 * Build the ownership proof signature (signed by the TEE oracle).
 * innerHash = keccak256(abi.encode(chainId, verifier, registry, tokenId, from, to,
 *                                   deadline, dataHash, sealedKey, targetPubkey, nonce))
 */
async function buildOwnershipProofSignature(
  oracleSigner: WalletClient,
  ctx: ProofContext,
  dataHash: `0x${string}`,
  sealedKey: `0x${string}`,
  targetPubkey: `0x${string}`,
  nonce: `0x${string}`, // bytes32
): Promise<`0x${string}`> {
  const innerHash = keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "uint256, address, address, uint256, address, address, uint256, bytes32, bytes, bytes, bytes32",
      ),
      [
        ctx.chainId,
        ctx.verifierAddress,
        ctx.registryAddress,
        ctx.tokenId,
        ctx.from,
        ctx.to,
        ctx.deadline,
        dataHash,
        sealedKey,
        targetPubkey,
        nonce,
      ],
    ),
  );
  return oracleSigner.signMessage({
    message: innerHash,
    account: oracleSigner.account!,
  });
}

// ---------------------------------------------------------------------------

describe("TeeVerifier", function () {
  function fakeDcapQuoteFor(address: Address): `0x${string}` {
    const reportData = Buffer.concat([
      Buffer.from(address.slice(2), "hex"),
      Buffer.alloc(44),
    ]);
    return `0x${Buffer.concat([Buffer.alloc(568), reportData]).toString("hex")}`;
  }

  function fakeValidationQuote(commitment: `0x${string}`): `0x${string}` {
    const reportData = Buffer.concat([
      Buffer.from(commitment.slice(2), "hex"),
      Buffer.alloc(32),
    ]);
    return `0x${Buffer.concat([Buffer.alloc(568), reportData]).toString("hex")}`;
  }

  async function deployFixture() {
    const [owner, oracle, alice, bob] = await viem.getWalletClients();

    const dcap = await viem.deployContract("MockDcapAttestation");
    const teeVerifier = await viem.deployContract("TeeVerifier", [
      owner.account.address,
      dcap.address,
    ]);

    const registry = await viem.deployContract("AgentRegistry", [
      "AgentRegistry",
      "AGENT",
      owner.account.address,
      teeVerifier.address,
      zeroAddress, // identityRegistry disabled in tests
    ]);

    return { teeVerifier, registry, owner, oracle, alice, bob };
  }

  // ── TeeVerifier basic tests ──────────────────────────────────────────────

  it("TeeVerifier: initValidator registers an attested oracle", async function () {
    const { teeVerifier, oracle } =
      await networkHelpers.loadFixture(deployFixture);
    assert.equal(
      await teeVerifier.read.isOracleRegistered([oracle.account.address]),
      false,
    );
    await teeVerifier.write.initValidator(
      [oracle.account.address, fakeDcapQuoteFor(oracle.account.address)],
      { account: oracle.account },
    );
    assert.equal(
      await teeVerifier.read.isOracleRegistered([oracle.account.address]),
      true,
    );
  });

  it("TeeVerifier: initValidator rejects quotes for a different oracle address", async function () {
    const { teeVerifier, oracle, alice } =
      await networkHelpers.loadFixture(deployFixture);
    await assert.rejects(
      teeVerifier.write.initValidator(
        [oracle.account.address, fakeDcapQuoteFor(alice.account.address)],
        { account: oracle.account },
      ),
    );
  });

  async function registerOracleViaInitValidator(
    teeVerifier: Awaited<ReturnType<typeof viem.deployContract>>,
    oracle: WalletClient,
    oracleAddress: Address,
  ) {
    await teeVerifier.write.initValidator(
      [oracleAddress, fakeDcapQuoteFor(oracleAddress)],
      { account: oracle.account },
    );
  }

  it("TeeVerifier: verifyTEESignature returns true for an initValidator-registered oracle", async function () {
    const { teeVerifier, oracle } =
      await networkHelpers.loadFixture(deployFixture);
    await registerOracleViaInitValidator(
      teeVerifier,
      oracle,
      oracle.account.address,
    );

    const rawData = keccak256(toHex("test-data"));
    // eth_sign prefixes with "\x19Ethereum Signed Message:\n32" and signs the 32 raw bytes.
    // hashMessage gives us the exact hash that was signed, which is what we pass to the contract.
    const sig = await oracle.signMessage({
      message: { raw: toBytes(rawData) },
      account: oracle.account,
    });
    const prefixedHash = hashMessage({ raw: toBytes(rawData) });
    // TeeVerifier.verifyTEESignature(hash, sig) does ECDSA.recover(hash, sig).
    // We must pass the SAME hash that was actually signed (prefixedHash), not rawData.
    const valid = await teeVerifier.read.verifyTEESignature([
      prefixedHash,
      sig,
    ]);
    assert.equal(valid, true);
  });

  it("TeeVerifier: owner can revoke oracle addresses", async function () {
    const { teeVerifier, owner, alice } =
      await networkHelpers.loadFixture(deployFixture);
    const rawData = keccak256(toHex("test-data"));
    const sig = await alice.signMessage({
      message: { raw: toBytes(rawData) },
      account: alice.account,
    });
    const prefixedHash = hashMessage({ raw: toBytes(rawData) });

    assert.equal(
      await teeVerifier.read.verifyTEESignature([prefixedHash, sig]),
      false,
    );

    await registerOracleViaInitValidator(
      teeVerifier,
      alice,
      alice.account.address,
    );
    assert.equal(
      await teeVerifier.read.isOracleRegistered([alice.account.address]),
      true,
    );
    assert.equal(
      await teeVerifier.read.verifyTEESignature([prefixedHash, sig]),
      true,
    );

    await teeVerifier.write.revokeOracleAddress([alice.account.address], {
      account: owner.account,
    });
    assert.equal(
      await teeVerifier.read.isOracleRegistered([alice.account.address]),
      false,
    );
    assert.equal(
      await teeVerifier.read.verifyTEESignature([prefixedHash, sig]),
      false,
    );
  });

  it("TeeVerifier: verifyTEESignature returns false for non-oracle signer", async function () {
    const { teeVerifier, alice } =
      await networkHelpers.loadFixture(deployFixture);
    const rawData = keccak256(toHex("test-data"));
    const sig = await alice.signMessage({
      message: { raw: toBytes(rawData) },
      account: alice.account,
    });
    const prefixedHash = hashMessage({ raw: toBytes(rawData) });
    const valid = await teeVerifier.read.verifyTEESignature([
      prefixedHash,
      sig,
    ]);
    assert.equal(valid, false);
  });

  it("TeeVerifier: verifyValidation requires a quote proof", async function () {
    const { teeVerifier, oracle } =
      await networkHelpers.loadFixture(deployFixture);
    const agentId = 1n;
    const requestHash = keccak256(toHex("validation-request"));
    const response = 87;
    const commitment = keccak256(
      encodePacked(
        ["uint256", "bytes32", "uint8"],
        [agentId, requestHash, response],
      ),
    );

    await registerOracleViaInitValidator(
      teeVerifier,
      oracle,
      oracle.account.address,
    );
    const signatureProof = await oracle.signMessage({
      message: { raw: toBytes(commitment) },
      account: oracle.account,
    });
    await assert.rejects(
      teeVerifier.write.verifyValidation([
        agentId,
        requestHash,
        response,
        signatureProof,
      ]),
      /InvalidProofLength/,
    );

    assert.equal(
      await teeVerifier.simulate.verifyValidation([
        agentId,
        requestHash,
        response,
        fakeValidationQuote(commitment),
      ]).then(({ result }) => result),
      true,
    );
  });

  // ── Full ERC-7857 iTransferFrom path ─────────────────────────────────────

  it("iTransferFrom: fails internally for an unregistered oracle signer", async function () {
    const { registry, teeVerifier, alice, bob, oracle } =
      await networkHelpers.loadFixture(deployFixture);

    const dataHash = keccak256(toHex("encrypted-agent-payload"));
    await registry.write.mint(
      [
        alice.account.address,
        "zerog://0xAgent123",
        "zerog://0xAgent123",
        [{ dataDescription: "agent-brain", dataHash }],
      ],
      { account: alice.account },
    );

    const tokenId = 0n;
    const publicClient = await viem.getPublicClient();
    const deadline = BigInt(Math.floor(Date.now() / 1000)) + 3600n;
    const ctx: ProofContext = {
      chainId: BigInt(await publicClient.getChainId()),
      verifierAddress: teeVerifier.address,
      registryAddress: registry.address,
      tokenId,
      from: alice.account.address,
      to: bob.account.address,
      deadline,
    };
    const targetPubkey = toHex("some-receiver-pubkey");
    const accessNonce = keccak256(toHex("access-nonce-unregistered-oracle"));
    const ownershipNonce = keccak256(
      toHex("ownership-nonce-unregistered-oracle"),
    );
    const sealedKey = toHex("sealed-encryption-key-for-bob");

    const proof = {
      accessProof: {
        dataHash,
        targetPubkey,
        nonce: accessNonce,
        proof: await buildAccessProofSignature(
          bob,
          ctx,
          dataHash,
          targetPubkey,
          accessNonce,
        ),
      },
      ownershipProof: {
        oracleType: 0,
        dataHash,
        sealedKey,
        targetPubkey,
        nonce: ownershipNonce,
        proof: await buildOwnershipProofSignature(
          oracle,
          ctx,
          dataHash,
          sealedKey,
          targetPubkey,
          ownershipNonce,
        ),
      },
      from: alice.account.address,
      to: bob.account.address,
      tokenId,
      deadline,
    };

    await registry.write.delegateAccess([bob.account.address], {
      account: bob.account,
    });
    await assert.rejects(
      registry.write.iTransferFrom(
        [alice.account.address, bob.account.address, tokenId, [proof]],
        { account: alice.account },
      ),
      /Invalid ownership proof/,
    );
  });

  it("iTransferFrom: transfers token with valid TEE proof", async function () {
    const { teeVerifier, registry, alice, bob, oracle } =
      await networkHelpers.loadFixture(deployFixture);

    // Mint a token to alice with one IntelligentData item
    const dataHash = keccak256(toHex("encrypted-agent-payload"));
    await registerOracleViaInitValidator(
      teeVerifier,
      oracle,
      oracle.account.address,
    );
    await registry.write.mint(
      [
        alice.account.address,
        "zerog://0xAgent123",
        "zerog://0xAgent123",
        [{ dataDescription: "agent-brain", dataHash }],
      ],
      { account: alice.account },
    );
    const tokenId = 0n;
    assert.equal(
      (await registry.read.ownerOf([tokenId])).toLowerCase(),
      alice.account.address.toLowerCase(),
    );

    const publicClient = await viem.getPublicClient();
    const chainId = BigInt(await publicClient.getChainId());

    // Build proof context (domain-bound: F-001)
    const deadline = BigInt(Math.floor(Date.now() / 1000)) + 3600n; // 1 hour from now
    const ctx: ProofContext = {
      chainId,
      verifierAddress: teeVerifier.address,
      registryAddress: registry.address,
      tokenId,
      from: alice.account.address,
      to: bob.account.address,
      deadline,
    };

    // Use a simple non-empty byte string as the target public key.
    const targetPubkey = toHex("some-receiver-pubkey");
    // Nonces are bytes32 (F-002: fixed-size prevents hash collisions)
    const accessNonce = keccak256(toHex("access-nonce-unique-abc"));
    const ownershipNonce = keccak256(toHex("ownership-nonce-unique-xyz"));
    const sealedKey = toHex("sealed-encryption-key-for-bob");

    // Bob (receiver) signs the access proof
    const accessProofSig = await buildAccessProofSignature(
      bob,
      ctx,
      dataHash,
      targetPubkey,
      accessNonce,
    );

    // Oracle signs the ownership proof
    const ownershipProofSig = await buildOwnershipProofSignature(
      oracle,
      ctx,
      dataHash,
      sealedKey,
      targetPubkey,
      ownershipNonce,
    );

    // Build the TransferValidityProof struct (includes domain fields F-001)
    const proof = {
      accessProof: {
        dataHash,
        targetPubkey,
        nonce: accessNonce,
        proof: accessProofSig,
      },
      ownershipProof: {
        oracleType: 0, // TEE
        dataHash,
        sealedKey,
        targetPubkey,
        nonce: ownershipNonce,
        proof: ownershipProofSig,
      },
      from: alice.account.address,
      to: bob.account.address,
      tokenId,
      deadline,
    };

    // Bob delegates access to himself so he is his own access assistant.
    await registry.write.delegateAccess([bob.account.address], {
      account: bob.account,
    });

    // iTransferFrom: alice -> bob with TEE proof
    await registry.write.iTransferFrom(
      [alice.account.address, bob.account.address, tokenId, [proof]],
      { account: alice.account },
    );

    assert.equal(
      (await registry.read.ownerOf([tokenId])).toLowerCase(),
      bob.account.address.toLowerCase(),
    );
  });
});
