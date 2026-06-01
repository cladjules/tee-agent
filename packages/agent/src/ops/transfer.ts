/**
 * prepareTransfer — orchestrates a secure NFT ownership transfer.
 *
 * Calls the TEE oracle's /reencrypt endpoint to get new ownership proofs,
 * then builds the client-side access payloads that the recipient wallet must sign.
 */

import { buildAccessPayloads } from "../core/crypto.js";
import type {
  AgentConfig,
  TransferParams,
  TransferResult,
} from "../core/types.js";
import { AgentRegistry } from "../core/registry/agent.js";
import { createPublicClient, http } from "viem";

export async function prepareTransfer(
  config: AgentConfig,
  params: TransferParams,
): Promise<TransferResult> {
  const { tokenId, to, newOwnerPublicKey, oracleSignature, oracleDeadline } =
    params;

  if (!tokenId) throw new Error("Token ID is required.");
  if (!to) throw new Error("Recipient address is required.");

  const registry = new AgentRegistry({
    address: config.registryAddress!,
    publicClient: createPublicClient({
      chain: config.chain,
      transport: http(config.rpcUrl),
    }),
  });
  const numericTokenId = BigInt(tokenId);

  const intelligentDatas = await registry.intelligentDatasOf(numericTokenId);

  const currentHashes = intelligentDatas.map(
    (item: { dataHash: `0x${string}` }) => item.dataHash,
  );

  type AccessPayload = {
    dataHash: `0x${string}`;
    targetPubkey: `0x${string}`;
    nonce: `0x${string}`;
    digest: `0x${string}`;
  };
  type OwnershipProof = {
    oracleType: number;
    dataHash: `0x${string}`;
    sealedKey: `0x${string}`;
    targetPubkey: `0x${string}`;
    nonce: `0x${string}`;
    proof: `0x${string}`;
  };

  let accessPayloads: AccessPayload[] = [];
  let ownershipProofs: OwnershipProof[] = [];
  let newDataHashes: `0x${string}`[] = [...currentHashes];
  let sealedKey = "0x" as `0x${string}`;
  let from = "0x" as `0x${string}`;

  if (currentHashes.length > 0) {
    const [verifierAddress, ownerAddress] = await Promise.all([
      registry.verifier(),
      registry.ownerOf(numericTokenId),
    ]);
    from = ownerAddress;

    if (!config.oracleUrl) {
      throw new Error(
        "oracleUrl is required for secure agent transfers. Start the oracle server and set oracleUrl in AgentConfig.",
      );
    }
    if (!newOwnerPublicKey) {
      throw new Error("newOwnerPublicKey is required for remote oracle.");
    }
    if (!oracleSignature) {
      throw new Error(
        "oracleSignature is required — sign the ReencryptRequest with the owner wallet.",
      );
    }
    if (!oracleDeadline) {
      throw new Error("oracleDeadline is required.");
    }

    const blobUris = intelligentDatas.map(
      (d: { dataDescription: string }) => d.dataDescription,
    );

    const oracleResponse = await fetch(`${config.oracleUrl}/reencrypt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tokenId,
        from,
        to,
        chainId: config.chain.id,
        verifierAddress,
        registryAddress: config.registryAddress!,
        deadline: Number(oracleDeadline),
        intelligentDataHashes: currentHashes,
        blobUris,
        targetPubkey: newOwnerPublicKey,
        signature: oracleSignature,
      }),
    });

    if (!oracleResponse.ok) {
      const text = await oracleResponse.text().catch(() => "");
      throw new Error(
        `Oracle re-encryption failed: ${oracleResponse.status} ${text}`,
      );
    }

    const oracleResult = (await oracleResponse.json()) as {
      newDataHashes: `0x${string}`[];
      sealedKey: `0x${string}`;
      ownershipProofs: typeof ownershipProofs;
    };

    newDataHashes = oracleResult.newDataHashes;
    sealedKey = oracleResult.sealedKey;
    ownershipProofs = oracleResult.ownershipProofs ?? [];
    const deadlineBig = BigInt(oracleDeadline);
    accessPayloads = buildAccessPayloads({
      chainId: config.chain.id,
      verifierAddress,
      registryAddress: config.registryAddress!,
      tokenId: numericTokenId,
      from,
      to,
      deadline: deadlineBig,
      currentHashes,
    });
  }

  return {
    contractAddress: config.registryAddress!,
    tokenId,
    ...(from !== "0x" ? { from: from as `0x${string}` } : {}),
    to,
    ...(currentHashes.length > 0 && oracleDeadline
      ? { deadline: BigInt(oracleDeadline) }
      : {}),
    newDataHashes,
    sealedKey,
    accessPayloads,
    ownershipProofs,
  };
}
