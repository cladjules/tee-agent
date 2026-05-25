"use server";

import { createPublicClient, http } from "viem";
import { AGENT_REGISTRY_ABI } from "@open-agents-toolkit/agent/abis";
import {
  buildAgentServiceTraits,
  buildAccessPayloads,
  parseAgentServicesJson,
  readJsonFromUri,
} from "@open-agents-toolkit/agent/encryption";
import { uploadEncryptedIntelligentData } from "@open-agents-toolkit/agent/zero-g";
import { IpfsClient } from "@open-agents-toolkit/agent/ipfs";
import { cfg } from "@/lib/config";

type PublicMetadataDocument = {
  name: string;
  description: string;
  image?: string;
  attributes?: Array<{ trait_type?: string; value?: string }>;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

type PreparedCreateAgentResult = {
  contractAddress?: `0x${string}`;
  agentRegistry?: string;
  publicMetadataUri?: string;
  agentMetadataUri?: string;
  mintFee?: string;
  intelligentData?: Array<{ dataDescription: string; dataHash: `0x${string}` }>;
  error?: string;
};

type PreparedTransferAgentResult = {
  contractAddress?: `0x${string}`;
  tokenId?: string;
  from?: `0x${string}`;
  to?: `0x${string}`;
  deadline?: bigint;
  newDataHashes?: `0x${string}`[];
  sealedKey?: `0x${string}`;
  accessPayloads?: Array<{
    dataHash: `0x${string}`;
    targetPubkey: `0x${string}`;
    nonce: `0x${string}`;
    digest: `0x${string}`;
  }>;
  ownershipProofs?: Array<{
    oracleType: number;
    dataHash: `0x${string}`;
    sealedKey: `0x${string}`;
    targetPubkey: `0x${string}`;
    nonce: `0x${string}`;
    proof: `0x${string}`;
  }>;
  error?: string;
};

type PreparedUpdateServicesResult = {
  contractAddress?: `0x${string}`;
  tokenId?: string;
  tokenUri?: string;
  error?: string;
};

async function makePublicClient() {
  return createPublicClient({
    chain: cfg.chain as any,
    transport: http(cfg.rpcUrl!),
  });
}

// ─── Write ────────────────────────────────────────────────────────────────────

/**
 * Transfer an Agent NFT through secureTransfer.
 *
 * Two modes:
 *  - ORACLE_URL set: calls remote Phala TEE oracle → gets ownershipProofs +
 *    newDataHashes, then generates access payloads locally for the client to sign.
 *  - ORACLE_URL not set: signs ownership proofs locally using ORACLE_PRIVATE_KEY
 *    (dev / staging mode, no actual blob re-encryption).
 */
export async function prepareTransferAgent(
  formData: FormData,
): Promise<PreparedTransferAgentResult> {
  const tokenId = (formData.get("tokenId") as string | null)?.trim();
  const contentKeyB64 = (formData.get("contentKey") as string | null)?.trim();
  const blobUrisJson = (formData.get("blobUris") as string | null)?.trim();
  const to = (formData.get("to") as string | null)?.trim() as
    | `0x${string}`
    | undefined;
  const newOwnerPublicKey = (
    formData.get("newOwnerPublicKey") as string | null
  )?.trim() as `0x${string}` | undefined;

  if (!tokenId) return { error: "Token ID is required." };
  if (!to) return { error: "Recipient address is required." };
  if (!cfg.isConfigured) return { error: "Contracts not configured." };

  try {
    const publicClient = await makePublicClient();
    const numericTokenId = BigInt(tokenId);

    const intelligentDatas = (await publicClient.readContract({
      address: cfg.registryAddress!,
      abi: AGENT_REGISTRY_ABI,
      functionName: "intelligentDatasOf",
      args: [numericTokenId],
    })) as ReadonlyArray<{
      dataDescription: string;
      dataHash: `0x${string}`;
    }>;

    const currentHashes = intelligentDatas.map((item) => item.dataHash);

    let accessPayloads: PreparedTransferAgentResult["accessPayloads"] = [];
    let ownershipProofs: PreparedTransferAgentResult["ownershipProofs"] = [];
    let newDataHashes: `0x${string}`[] = [...currentHashes];
    let sealedKey = "0x" as `0x${string}`;
    let from = "0x" as `0x${string}`;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

    if (currentHashes.length > 0) {
      // Read verifier address and current owner — needed for domain-bound proof hashing.
      const [verifierAddress, ownerAddress] = await Promise.all([
        publicClient.readContract({
          address: cfg.registryAddress!,
          abi: AGENT_REGISTRY_ABI,
          functionName: "verifier",
          args: [],
        }) as Promise<`0x${string}`>,
        publicClient.readContract({
          address: cfg.registryAddress!,
          abi: AGENT_REGISTRY_ABI,
          functionName: "ownerOf",
          args: [numericTokenId],
        }) as Promise<`0x${string}`>,
      ]);
      from = ownerAddress;
      if (!cfg.oracleUrl) {
        return {
          error:
            "ORACLE_URL is required for secure agent transfers. Start the oracle server and set ORACLE_URL.",
        };
      }
      {
        // ── Remote oracle path ────────────────────────────────────────────────
        if (!contentKeyB64) {
          return {
            error:
              "contentKey is required when using a remote oracle. Decrypt it locally first.",
          };
        }
        if (!newOwnerPublicKey) {
          return { error: "newOwnerPublicKey is required for remote oracle." };
        }
        if (!blobUrisJson) {
          return {
            error:
              "blobUris is required for remote oracle (JSON array of IPFS gateway URLs).",
          };
        }

        let blobUris: string[];
        try {
          blobUris = JSON.parse(blobUrisJson);
          if (
            !Array.isArray(blobUris) ||
            blobUris.length !== currentHashes.length
          ) {
            return {
              error: `blobUris must be an array of ${currentHashes.length} URIs.`,
            };
          }
        } catch {
          return { error: "blobUris is not valid JSON." };
        }

        const oracleResponse = await fetch(`${cfg.oracleUrl}/reencrypt`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tokenId,
            from,
            to,
            chainId: cfg.chainId,
            verifierAddress,
            registryAddress: cfg.registryAddress,
            deadline: Number(deadline),
            intelligentDataHashes: currentHashes,
            blobUris,
            contentKey: contentKeyB64,
            targetPubkey: newOwnerPublicKey,
          }),
        });

        if (!oracleResponse.ok) {
          const text = await oracleResponse.text().catch(() => "");
          return {
            error: `Oracle re-encryption failed: ${oracleResponse.status} ${text}`,
          };
        }

        const oracleResult = (await oracleResponse.json()) as {
          newDataHashes: `0x${string}`[];
          sealedKey: `0x${string}`;
          ownershipProofs: PreparedTransferAgentResult["ownershipProofs"];
        };

        newDataHashes = oracleResult.newDataHashes;
        sealedKey = oracleResult.sealedKey;
        ownershipProofs = oracleResult.ownershipProofs ?? [];
        accessPayloads = buildAccessPayloads({
          chainId: cfg.chainId,
          verifierAddress,
          registryAddress: cfg.registryAddress!,
          tokenId: numericTokenId,
          from,
          to,
          deadline,
          currentHashes,
        });
      }
    }

    return {
      contractAddress: cfg.registryAddress!,
      tokenId,
      from: from || undefined,
      to,
      deadline: currentHashes.length > 0 ? deadline : undefined,
      newDataHashes,
      sealedKey,
      accessPayloads,
      ownershipProofs,
    };
  } catch (err) {
    return {
      error:
        err instanceof Error ? err.message : "Transfer preparation failed.",
    };
  }
}

/**
 * Prepare a tokenURI update so the connected wallet can submit the on-chain write.
 */
export async function prepareUpdateAgentServices(
  formData: FormData,
): Promise<PreparedUpdateServicesResult> {
  const tokenId = (formData.get("tokenId") as string | null)?.trim();
  const servicesJson =
    (formData.get("servicesJson") as string | null)?.trim() ?? "[]";

  if (!tokenId) return { error: "Token ID is required." };
  if (!cfg.isConfigured) return { error: "Contracts not configured." };

  const { services, error } = parseAgentServicesJson(servicesJson);
  if (error) return { error };

  try {
    const publicClient = await makePublicClient();
    const numericTokenId = BigInt(tokenId);

    const publicMetadataUri = await publicClient.readContract({
      address: cfg.registryAddress!,
      abi: AGENT_REGISTRY_ABI,
      functionName: "tokenURI",
      args: [numericTokenId],
    });

    const publicMetadata = await readJsonFromUri<PublicMetadataDocument>(
      publicMetadataUri as string,
    );

    const preservedAttributes = (publicMetadata.attributes ?? []).filter(
      (attribute) => {
        const traitType = attribute?.trait_type ?? "";
        return (
          traitType !== "Services Count" && !traitType.startsWith("Service:")
        );
      },
    );

    const updatedPublicMetadata: PublicMetadataDocument = {
      ...publicMetadata,
      attributes: [
        ...preservedAttributes,
        ...buildAgentServiceTraits(services ?? []),
      ],
    };

    const tokenUri = `data:application/json;base64,${Buffer.from(JSON.stringify(updatedPublicMetadata)).toString("base64")}`;
    return {
      contractAddress: cfg.registryAddress!,
      tokenId,
      tokenUri,
    };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Updating services failed.",
    };
  }
}

// ─── Unified Create ───────────────────────────────────────────────────────────

export async function prepareCreateAgent(
  formData: FormData,
): Promise<PreparedCreateAgentResult | { tokenId: bigint }> {
  const logPrefix = "[prepareCreateAgent]";
  console.log(`${logPrefix} start`);

  const name = (formData.get("name") as string | null)?.trim();
  const description = (formData.get("description") as string | null)?.trim();
  const imageUrl = (formData.get("imageUrl") as string | null)?.trim();
  const agentType =
    (formData.get("agentType") as string | null)?.trim() ?? "assistant";
  const privateEntriesJson =
    (formData.get("privateEntries") as string | null)?.trim() ?? "[]";
  const servicesJson =
    (formData.get("servicesJson") as string | null)?.trim() ?? "[]";
  const x402Support = (formData.get("x402Support") as string | null) === "true";
  const oasfSkillsJson =
    (formData.get("oasfSkills") as string | null)?.trim() ?? "[]";
  const oasfDomainsJson =
    (formData.get("oasfDomains") as string | null)?.trim() ?? "[]";
  const ownerAddress = (
    formData.get("ownerAddress") as string | null
  )?.trim() as `0x${string}` | undefined;
  const keyEncryptionPublicKey = cfg.keyEncryptionPublicKey;

  console.log(`${logPrefix} form values extracted`, {
    hasName: Boolean(name),
    hasDescription: Boolean(description),
    hasImageUrl: Boolean(imageUrl),
    agentType,
    hasPrivateEntries: privateEntriesJson !== "[]",
    hasServicesJson: Boolean(servicesJson),
    hasOwnerAddress: Boolean(ownerAddress),
  });

  if (!name) {
    console.warn(`${logPrefix} validation failed: missing name`);
    return { error: "Agent name is required." };
  }
  if (!description) {
    console.warn(`${logPrefix} validation failed: missing description`);
    return { error: "Description is required." };
  }

  if (!keyEncryptionPublicKey) {
    console.warn(`${logPrefix} config missing: keyEncryptionPublicKey`);
    return {
      error:
        "TEE key encryption public key not configured (TEE_ENCRYPTION_PUBLIC_KEY).",
    };
  }

  if (!ownerAddress) {
    console.warn(`${logPrefix} validation failed: missing ownerAddress`);
    return { error: "Connect your wallet before creating an agent." };
  }

  let services: Array<{
    name: string;
    endpoint: string;
    version?: string;
    skills?: string[];
    domains?: string[];
  }> = [];
  if (servicesJson) {
    console.log(`${logPrefix} parsing services JSON`);
    const parsedServices = parseAgentServicesJson(servicesJson);
    if (parsedServices.error) {
      console.warn(`${logPrefix} services parse failed`, {
        error: parsedServices.error,
      });
      return { error: parsedServices.error };
    }
    services = (parsedServices.services ?? []).map((s) => ({
      ...s,
      skills: s.skills ? [...s.skills] : undefined,
      domains: s.domains ? [...s.domains] : undefined,
    }));
    console.log(`${logPrefix} services parsed`, {
      serviceCount: services.length,
      serviceNames: services.map((service) => service.name),
    });
  }

  if (!cfg.isConfigured) {
    const fallbackTokenId = BigInt(Math.floor(Math.random() * 9000) + 1000);
    console.warn(
      `${logPrefix} contracts not configured; returning fallback token`,
      {
        fallbackTokenId: fallbackTokenId.toString(),
      },
    );
    return { tokenId: fallbackTokenId };
  }

  try {
    console.log(`${logPrefix} creating public client`);
    const publicClient = await makePublicClient();

    // Read mint fee and predict the next agentId (_nextTokenId == totalSupply).
    console.log(`${logPrefix} reading mint fee and predicted agent ID`);
    const [mintFee, predictedAgentId] = await Promise.all([
      publicClient.readContract({
        address: cfg.registryAddress!,
        abi: AGENT_REGISTRY_ABI,
        functionName: "getMintFee",
      }) as Promise<bigint>,
      publicClient.readContract({
        address: cfg.registryAddress!,
        abi: AGENT_REGISTRY_ABI,
        functionName: "totalSupply",
      }) as Promise<bigint>,
    ]);

    console.log(`${logPrefix} chain reads complete`, {
      mintFee: mintFee.toString(),
      predictedAgentId: predictedAgentId.toString(),
      registryAddress: cfg.registryAddress,
      chainId: cfg.chainId,
    });

    const agentRegistry = `eip155:${cfg.chainId}:${cfg.registryAddress}`;
    console.log(`${logPrefix} agent registry ref built`, { agentRegistry });

    console.log(`${logPrefix} uploading encrypted intelligent data`);
    if (!cfg.zeroGKey) {
      return {
        error:
          "ZERO_G_PRIVATE_KEY (or PRIVATE_KEY fallback) is required for 0G Storage uploads.",
      };
    }
    let privateEntries: Array<{ name: string; data: string }> = [];
    try {
      privateEntries = JSON.parse(privateEntriesJson);
    } catch {
      /* ignore malformed JSON */
    }

    const intelligentData = await uploadEncryptedIntelligentData({
      entries: privateEntries,
      keyEncryptionPublicKey,
      zeroGPrivateKey: cfg.zeroGKey,
      rpcUrl: cfg.zeroGRpcUrl,
      indexerUrl: cfg.zeroGIndexerUrl,
    });
    console.log(`${logPrefix} encrypted intelligent data uploaded to 0G`, {
      itemCount: intelligentData.length,
      hashes: intelligentData.map((item) => item.hash),
    });

    // Auto-generate OASF profile if skills or domains are selected
    let oasfSkills: string[] = [];
    let oasfDomains: string[] = [];
    try {
      oasfSkills = JSON.parse(oasfSkillsJson);
      oasfDomains = JSON.parse(oasfDomainsJson);
    } catch {
      /* ignore malformed JSON */
    }

    if ((oasfSkills.length > 0 || oasfDomains.length > 0) && cfg.pinataJwt) {
      console.log(`${logPrefix} uploading OASF profile to IPFS`, {
        skillCount: oasfSkills.length,
        domainCount: oasfDomains.length,
      });
      const oasfIpfsClient = new IpfsClient({ jwt: cfg.pinataJwt });
      const oasfProfile = {
        schema_version: "0.8",
        skills: oasfSkills,
        domains: oasfDomains,
      };
      const oasfUpload = await oasfIpfsClient.uploadJSON(
        oasfProfile,
        `${name}-oasf-profile`,
      );
      const oasfProfileUri = oasfUpload.url;
      console.log(`${logPrefix} OASF profile uploaded`, { oasfProfileUri });

      // Update existing OASF service entry or insert a new one
      const oasfIdx = services.findIndex((s) => s.name === "OASF");
      const oasfEntry = {
        name: "OASF" as const,
        endpoint: oasfProfileUri,
        version: "0.8",
        ...(oasfSkills.length ? { skills: oasfSkills } : {}),
        ...(oasfDomains.length ? { domains: oasfDomains } : {}),
      };
      if (oasfIdx >= 0) {
        services[oasfIdx] = { ...services[oasfIdx], ...oasfEntry };
      } else {
        services.push(oasfEntry);
      }
    }

    const publicMetadata = {
      name,
      description,
      image: imageUrl || undefined,
      agentType,
      services,
      createdAt: Date.now(),
    };
    console.log(`${logPrefix} public metadata prepared`, {
      hasImage: Boolean(publicMetadata.image),
      serviceCount: services.length,
    });

    const publicMetadataUri = `data:application/json;base64,${Buffer.from(JSON.stringify(publicMetadata)).toString("base64")}`;
    console.log(`${logPrefix} public metadata URI prepared`);

    const agentMetadata = {
      type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
      name,
      description,
      image: imageUrl || undefined,
      services,
      x402Support,
      active: true,
      registrations: [
        {
          agentId: Number(predictedAgentId),
          agentRegistry: agentRegistry,
        },
      ],
      supportedTrust: ["tee-attestation"],
      wallet: ownerAddress,
      owner: ownerAddress,
    };

    console.log(`${logPrefix} uploading metadata to IPFS`);
    if (!cfg.pinataJwt) {
      return {
        error: "PINATA_JWT is required for IPFS metadata uploads.",
      };
    }
    const ipfsClient = new IpfsClient({ jwt: cfg.pinataJwt });
    const agentMetadataUpload = await ipfsClient.uploadJSON(
      agentMetadata,
      name,
    );
    const agentMetadataUri = agentMetadataUpload.url;
    console.log(`${logPrefix} agent metadata URI prepared`, {
      agentMetadataUri,
    });

    console.log(`${logPrefix} success`);

    return {
      contractAddress: cfg.registryAddress!,
      agentRegistry: `${agentRegistry}/${predictedAgentId}`,
      publicMetadataUri,
      agentMetadataUri,
      mintFee: mintFee.toString(),
      intelligentData: intelligentData.map((item) => ({
        dataDescription: item.uri,
        dataHash: item.hash,
      })),
    };
  } catch (err) {
    console.error(`${logPrefix} failed`, err);
    return {
      error: err instanceof Error ? err.message : "Create preparation failed.",
    };
  }
}
