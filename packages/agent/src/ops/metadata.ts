import { uploadJSONToIPFS } from "../storage/ipfs.js";
import type {
  AgentConfig,
  AgentPublicMetadata,
  AgentService,
  PreparePublicMetadataUpdateParams,
  PreparePublicMetadataUpdateResult,
} from "../types.js";

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

export function buildAgentPublicMetadata(
  params: Omit<PreparePublicMetadataUpdateParams, "tokenId">,
): AgentPublicMetadata {
  const name = params.name.trim();
  const description = params.description.trim();
  if (!name) throw new Error("Name is required.");
  if (!description) throw new Error("Description is required.");

  const attributes: AgentPublicMetadata["attributes"] = [];
  const agentType = params.agentType?.trim();
  if (agentType) {
    attributes.push({ trait_type: "Agent Type", value: agentType });
  }
  if (params.createdAt !== undefined) {
    attributes.push({
      trait_type: "Created",
      value: params.createdAt,
      display_type: "date",
    });
  }
  attributes.push(...serviceAttributes(params.services ?? []));
  if (typeof params.x402Support === "boolean") {
    attributes.push({
      trait_type: "x402 Support",
      value: params.x402Support ? "Yes" : "No",
    });
  }

  const metadata: AgentPublicMetadata = {
    name,
    description,
  };
  const image = params.imageUrl?.trim();
  if (image) metadata.image = image;
  if (attributes.length > 0) metadata.attributes = attributes;
  return metadata;
}

function serviceAttributes(
  services: readonly AgentService[],
): NonNullable<AgentPublicMetadata["attributes"]> {
  const names = [
    ...new Set(
      services
        .map((service) => service.name.trim())
        .filter((name) => name.length > 0),
    ),
  ];
  if (names.length === 0) return [];

  const attributes: NonNullable<AgentPublicMetadata["attributes"]> = [
    { trait_type: "Service Count", value: names.length },
    { trait_type: "Services", value: names.join(", ") },
  ];

  if (names.includes("teeOracle")) {
    attributes.push({ trait_type: "TEE Oracle", value: "Configured" });
  }

  const oasf = services.find((service) => service.name === "OASF");
  if (oasf?.skills && oasf.skills.length > 0) {
    attributes.push({
      trait_type: "OASF Skill Count",
      value: oasf.skills.length,
    });
    attributes.push({
      trait_type: "OASF Skills",
      value: oasf.skills.join(", "),
    });
  }
  if (oasf?.domains && oasf.domains.length > 0) {
    attributes.push({
      trait_type: "OASF Domain Count",
      value: oasf.domains.length,
    });
    attributes.push({
      trait_type: "OASF Domains",
      value: oasf.domains.join(", "),
    });
  }

  return attributes;
}

export async function preparePublicMetadataUpdate(
  config: AgentConfig,
  params: PreparePublicMetadataUpdateParams,
): Promise<PreparePublicMetadataUpdateResult> {
  if (!params.tokenId.trim()) throw new Error("Token ID is required.");
  if (!config.registryAddress) throw new Error("registryAddress is required.");
  if (!config.pinataJwt) {
    throw new Error("pinataJwt is required for IPFS metadata uploads.");
  }

  const publicMetadata = buildAgentPublicMetadata(params);
  const publicMetadataUri = await uploadMetadata(
    config,
    publicMetadata,
    `${publicMetadata.name}-public`,
  );

  return {
    contractAddress: config.registryAddress,
    tokenId: params.tokenId.trim(),
    publicMetadataUri,
    publicMetadata,
  };
}
