import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { keccak256, toHex, zeroAddress } from "viem";
import { network } from "hardhat";

const { viem, networkHelpers } = await network.create();

describe("AgentRegistry", function () {
  async function deployFixture() {
    const [alice, bob] = await viem.getWalletClients();
    const registry = await viem.deployContract("AgentRegistry", [
      "AgentRegistry",
      "AGENT",
      alice.account.address,
      zeroAddress, // verifier
      zeroAddress, // identityRegistry (disabled for tests)
    ]);
    const publicClient = await viem.getPublicClient();
    return { registry, alice, bob, publicClient };
  }

  async function deployIdentityFixture() {
    const [alice, bob] = await viem.getWalletClients();
    const verifier = await viem.deployContract("AlwaysPassVerifier");
    const identity = await viem.deployContract("MockIdentityRegistry");
    const registry = await viem.deployContract("AgentRegistry", [
      "AgentRegistry",
      "AGENT",
      alice.account.address,
      verifier.address,
      identity.address,
    ]);
    return { registry, identity, alice, bob };
  }

  async function deployOracleRegistrationFixture() {
    const [alice, oracle] = await viem.getWalletClients();
    const dcap = await viem.deployContract("MockDcapAttestation");
    const teeVerifier = await viem.deployContract("TeeVerifier", [
      alice.account.address,
      dcap.address,
    ]);
    const verifier = await viem.deployContract("Verifier", [
      alice.account.address,
      teeVerifier.address,
    ]);
    const registry = await viem.deployContract("AgentRegistry", [
      "AgentRegistry",
      "AGENT",
      alice.account.address,
      verifier.address,
      zeroAddress,
    ]);
    return { registry, teeVerifier, alice, oracle };
  }

  function dummyProof({
    dataHash,
    from,
    to,
  }: {
    dataHash: `0x${string}`;
    from: `0x${string}`;
    to: `0x${string}`;
  }) {
    const nonce = keccak256(toHex("nonce"));
    return {
      accessProof: {
        dataHash,
        targetPubkey: "0x1234",
        nonce,
        proof: "0x",
      },
      ownershipProof: {
        oracleType: 0,
        dataHash,
        sealedKey: "0xabcd",
        targetPubkey: "0x1234",
        nonce,
        proof: "0x",
      },
      from,
      to,
      tokenId: 0n,
      deadline: BigInt(Math.floor(Date.now() / 1000)) + 3600n,
    };
  }

  it("mint: mints token with correct owner and URI", async function () {
    const { registry, alice } = await networkHelpers.loadFixture(deployFixture);
    await registry.write.mint(
      [
        alice.account.address,
        "zerog://0xAgent123",
        "zerog://0xAgent123",
        [],
      ],
      { account: alice.account },
    );
    const id = 0n;
    assert.equal(
      (await registry.read.ownerOf([id])).toLowerCase(),
      alice.account.address.toLowerCase(),
    );
    assert.equal(await registry.read.tokenURI([id]), "zerog://0xAgent123");
    assert.equal(await registry.read.totalSupply(), 1n);
  });

  it("mint: mints token with no URI", async function () {
    const { registry, alice } = await networkHelpers.loadFixture(deployFixture);
    await registry.write.mint([alice.account.address, "", "", []], {
      account: alice.account,
    });
    assert.equal(await registry.read.totalSupply(), 1n);
  });

  it("mint: getMetadataUri returns empty when ERC-8004 registry is disabled", async function () {
    const { registry, alice } = await networkHelpers.loadFixture(deployFixture);
    await registry.write.mint(
      [
        alice.account.address,
        "zerog://0xMetaHash",
        "zerog://0xRegistryFile",
        [],
      ],
      { account: alice.account },
    );
    const id = 0n;
    assert.equal(await registry.read.getMetadataUri([id]), "");
  });

  it("mint: increments totalSupply", async function () {
    const { registry, alice } = await networkHelpers.loadFixture(deployFixture);
    await registry.write.mint(
      [alice.account.address, "zerog://0xA", "zerog://0xAgent123", []],
      { account: alice.account },
    );
    await registry.write.mint(
      [alice.account.address, "zerog://0xB", "zerog://0xAgent123", []],
      { account: alice.account },
    );
    assert.equal(await registry.read.totalSupply(), 2n);
  });

  it("mint: getERC8004AgentId returns 0 when no registry configured", async function () {
    const { registry, alice } = await networkHelpers.loadFixture(deployFixture);
    await registry.write.mint(
      [
        alice.account.address,
        "zerog://0xAgent123",
        "zerog://0xAgent123",
        [],
      ],
      { account: alice.account },
    );
    assert.equal(await registry.read.getERC8004AgentId([0n]), 0n);
  });

  it("mint: getERC8004Registry returns the address set at construction", async function () {
    const { registry } = await networkHelpers.loadFixture(deployFixture);
    assert.equal(await registry.read.getERC8004Registry(), zeroAddress);
  });

  it("mint: stores intelligent data without oracle preflight", async function () {
    const { registry, alice } = await networkHelpers.loadFixture(deployFixture);
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

    const datas = await registry.read.intelligentDatasOf([0n]);
    assert.equal(datas.length, 1);
    assert.equal(datas[0]!.dataDescription, "agent-brain");
    assert.equal(datas[0]!.dataHash, dataHash);
  });

  it("setTokenURI: updates URI when called by owner", async function () {
    const { registry, alice } = await networkHelpers.loadFixture(deployFixture);
    await registry.write.mint(
      [
        alice.account.address,
        "zerog://0xAgent123",
        "zerog://0xAgent123",
        [],
      ],
      { account: alice.account },
    );
    await registry.write.setTokenURI([0n, "zerog://0xNewHash"], {
      account: alice.account,
    });
    assert.equal(await registry.read.tokenURI([0n]), "zerog://0xNewHash");
  });

  it("setTokenURI: reverts if caller is not owner", async function () {
    const { registry, alice, bob } =
      await networkHelpers.loadFixture(deployFixture);
    await registry.write.mint(
      [
        alice.account.address,
        "zerog://0xAgent123",
        "zerog://0xAgent123",
        [],
      ],
      { account: alice.account },
    );
    await assert.rejects(
      registry.write.setTokenURI([0n, "zerog://0xHacked"], {
        account: bob.account,
      }),
      /Not owner/,
    );
  });

  it("transfer: plain transferFrom works without ERC-8004 registry", async function () {
    const { registry, alice, bob } =
      await networkHelpers.loadFixture(deployFixture);
    await registry.write.mint(
      [
        alice.account.address,
        "zerog://0xAgent123",
        "zerog://0xAgent123",
        [],
      ],
      { account: alice.account },
    );
    await registry.write.transferFrom(
      [alice.account.address, bob.account.address, 0n],
      { account: alice.account },
    );
    assert.equal(
      (await registry.read.ownerOf([0n])).toLowerCase(),
      bob.account.address.toLowerCase(),
    );
  });

  it("mint: does not require a registered oracle", async function () {
    const { registry, alice } =
      await networkHelpers.loadFixture(deployOracleRegistrationFixture);
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

    assert.equal(await registry.read.totalSupply(), 1n);
  });

  it("iTransferFromWithIdentity: requires ERC-8004 approval then transfers both tokens", async function () {
    const { registry, identity, alice, bob } = await networkHelpers.loadFixture(
      deployIdentityFixture,
    );
    const dataHash = keccak256(toHex("encrypted-agent-payload"));

    await registry.write.mint(
      [
        alice.account.address,
        "zerog://0xAgent123",
        "ipfs://metadata",
        [{ dataDescription: "agent-brain", dataHash }],
      ],
      { account: alice.account },
    );

    const tokenId = 0n;
    const erc8004AgentId = await registry.read.getERC8004AgentId([tokenId]);
    assert.equal(erc8004AgentId, 1n);
    assert.equal(
      (await identity.read.ownerOf([erc8004AgentId])).toLowerCase(),
      alice.account.address.toLowerCase(),
    );

    const proof = dummyProof({
      dataHash,
      from: alice.account.address,
      to: bob.account.address,
    });

    await assert.rejects(
      registry.write.iTransferFromWithIdentity(
        [alice.account.address, bob.account.address, tokenId, [proof]],
        { account: alice.account },
      ),
    );

    await identity.write.approve([registry.address, erc8004AgentId], {
      account: alice.account,
    });
    await registry.write.iTransferFromWithIdentity(
      [alice.account.address, bob.account.address, tokenId, [proof]],
      { account: alice.account },
    );

    assert.equal(
      (await registry.read.ownerOf([tokenId])).toLowerCase(),
      bob.account.address.toLowerCase(),
    );
    assert.equal(
      (await identity.read.ownerOf([erc8004AgentId])).toLowerCase(),
      bob.account.address.toLowerCase(),
    );
  });
});
