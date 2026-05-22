import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { zeroAddress } from "viem";
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

  it("mint: mints token with correct owner and URI", async function () {
    const { registry, alice } = await networkHelpers.loadFixture(deployFixture);
    await registry.write.mint(
      [alice.account.address, "zerog://0xAgent123", "zerog://0xAgent123", []],
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

  it("mint: stores and retrieves metadataUri", async function () {
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
    assert.equal(
      await registry.read.getMetadataUri([id]),
      "zerog://0xRegistryFile",
    );
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
      [alice.account.address, "zerog://0xAgent123", "zerog://0xAgent123", []],
      { account: alice.account },
    );
    assert.equal(await registry.read.getERC8004AgentId([0n]), 0n);
  });

  it("mint: getERC8004Registry returns the address set at construction", async function () {
    const { registry } = await networkHelpers.loadFixture(deployFixture);
    assert.equal(await registry.read.getERC8004Registry(), zeroAddress);
  });

  it("setTokenURI: updates URI when called by owner", async function () {
    const { registry, alice } = await networkHelpers.loadFixture(deployFixture);
    await registry.write.mint(
      [alice.account.address, "zerog://0xAgent123", "zerog://0xAgent123", []],
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
      [alice.account.address, "zerog://0xAgent123", "zerog://0xAgent123", []],
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
      [alice.account.address, "zerog://0xAgent123", "zerog://0xAgent123", []],
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
});
