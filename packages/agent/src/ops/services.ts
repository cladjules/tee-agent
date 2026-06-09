/**
 * prepareUpdateServices — builds a new ERC-8004 metadata URI for service updates.
 * prepareRegisterErc8004 — post-mint: patches metadata with correct erc8004AgentId.
 * fetchAgentServices — reads existing services from an ERC-8004 Identity Registry token.
 */

import { parseAgentServicesJson, readJsonFromUri } from "../crypto.js";
import { uploadMetadata } from "./metadata.js";
import { uploadJSONToIPFS } from "../storage/ipfs.js";
import type {
  AgentConfig,
  AgentService,
  UpdateServicesParams,
  UpdateServicesResult,
  FetchAgentServicesParams,
  FetchAgentServicesResult,
  PrepareRegisterErc8004Params,
  PrepareTeeOracleServiceUpdateParams,
  PrepareTeeOracleServiceUpdateResult,
  VerifyTeeOracleResult,
} from "../types.js";
import { AgentRegistry } from "../registry/agent.js";
import { IdentityRegistry } from "../registry/identity.js";

type AgentMetadataJson = Record<string, unknown> & {
  name?: string;
  services?: unknown;
};

function metadataStorage(uri: string): "ipfs" | "data" | "http" {
  if (uri.startsWith("ipfs://")) return "ipfs";
  if (uri.startsWith("data:")) return "data";
  return "http";
}

function normalizeTeeOracleUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  if (!trimmed) throw new Error("teeOracle URL is required.");
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("teeOracle URL must start with http:// or https://.");
    }
    return parsed.toString().replace(/\/+$/, "");
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("teeOracle")) {
      throw err;
    }
    throw new Error("teeOracle URL is invalid.");
  }
}

export async function verifyTeeOracleEndpoint(
  url: string,
): Promise<VerifyTeeOracleResult> {
  const normalizedUrl = normalizeTeeOracleUrl(url);
  let response: Response;
  try {
    response = await fetch(`${normalizedUrl}/address`, {
      cache: "no-store",
    });
  } catch (err) {
    throw new Error(
      `Could not reach teeOracle at ${normalizedUrl}/address: ${String(err)}`,
    );
  }
  if (!response.ok) {
    throw new Error(
      `teeOracle /address returned ${response.status} for ${normalizedUrl}.`,
    );
  }
  const body = (await response.json()) as {
    address?: string;
    publicKey?: string;
  };
  if (!body.address?.startsWith("0x")) {
    throw new Error("teeOracle /address did not return an EVM address.");
  }
  if (!body.publicKey?.startsWith("0x")) {
    throw new Error("teeOracle /address did not return a publicKey.");
  }
  return {
    url: normalizedUrl,
    address: body.address as `0x${string}`,
    publicKey: body.publicKey as `0x${string}`,
  };
}

function servicesFromMetadata(metadata: AgentMetadataJson): AgentService[] {
  const raw = Array.isArray(metadata.services) ? metadata.services : [];
  return raw
    .filter(
      (svc): svc is AgentService =>
        !!svc &&
        typeof svc === "object" &&
        typeof (svc as { name?: unknown }).name === "string" &&
        typeof (svc as { endpoint?: unknown }).endpoint === "string",
    )
    .map((svc) => ({
      name: svc.name,
      endpoint: svc.endpoint,
      ...(svc.version !== undefined ? { version: svc.version } : {}),
      ...(svc.skills && svc.skills.length > 0
        ? { skills: [...svc.skills] }
        : {}),
      ...(svc.domains && svc.domains.length > 0
        ? { domains: [...svc.domains] }
        : {}),
    }));
}

function upsertTeeOracleService(
  services: unknown,
  teeOracleUrl: string,
): unknown[] {
  const list = Array.isArray(services) ? [...services] : [];
  const idx = list.findIndex(
    (svc) =>
      !!svc &&
      typeof svc === "object" &&
      (svc as { name?: unknown }).name === "teeOracle",
  );
  if (idx >= 0) {
    const existing = list[idx];
    list[idx] =
      existing && typeof existing === "object"
        ? { ...existing, name: "teeOracle", endpoint: teeOracleUrl }
        : { name: "teeOracle", endpoint: teeOracleUrl };
  } else {
    list.push({ name: "teeOracle", endpoint: teeOracleUrl });
  }
  return list;
}

async function writeMetadataPreservingStorage(
  config: AgentConfig,
  originalUri: string,
  metadata: Record<string, unknown>,
  label: string,
): Promise<string> {
  if (originalUri.startsWith("data:")) {
    return `data:application/json;base64,${Buffer.from(
      JSON.stringify(metadata),
    ).toString("base64")}`;
  }
  if (originalUri.startsWith("ipfs://")) {
    if (!config.pinataJwt) {
      throw new Error("PINATA_JWT is required to update IPFS metadata.");
    }
    const upload = await uploadJSONToIPFS(metadata, label, {
      jwt: config.pinataJwt,
    });
    return upload.url;
  }
  return uploadMetadata(config, metadata, label);
}

async function prepareMetadataUpdatePreservingStorage(
  config: AgentConfig,
  params: {
    currentUri: string;
    label: string;
    update: (metadata: AgentMetadataJson) => Record<string, unknown>;
  },
): Promise<string> {
  const existingMetadata = await readJsonFromUri<AgentMetadataJson>(
    params.currentUri,
  );
  const metadata = params.update(existingMetadata);
  return writeMetadataPreservingStorage(
    config,
    params.currentUri,
    metadata,
    params.label,
  );
}

export async function prepareUpdateServices(
  config: AgentConfig,
  params: UpdateServicesParams,
): Promise<UpdateServicesResult> {
  const { tokenId, servicesJson } = params;

  if (!tokenId) throw new Error("Token ID is required.");
  if (!config.identityRegistryAddress)
    throw new Error("identityRegistryAddress is not configured.");

  const services = parseAgentServicesJson(servicesJson);

  const registry = new AgentRegistry({
    address: config.registryAddress!,
    chainId: config.chain.id,
    rpcUrl: config.rpcUrl,
  });
  const numericTokenId = BigInt(tokenId);

  const [currentMetadataUri, erc8004AgentIdRaw] = await Promise.all([
    registry.getMetadataUri(numericTokenId),
    registry.getERC8004AgentId(numericTokenId),
  ]);

  const agentRegistryRef = `eip155:${config.chain.id}:${config.registryAddress}`;
  const identityRegistryRef = config.identityRegistryAddress
    ? `eip155:${config.chain.id}:${config.identityRegistryAddress}`
    : undefined;

  const registrations = [
    { agentId: Number(tokenId), agentRegistry: agentRegistryRef },
    ...(erc8004AgentIdRaw > 0n && identityRegistryRef
      ? [
          {
            agentId: Number(erc8004AgentIdRaw),
            agentRegistry: identityRegistryRef,
          },
        ]
      : []),
  ];

  const tokenUri = await prepareMetadataUpdatePreservingStorage(config, {
    currentUri: currentMetadataUri,
    label: `agent-${tokenId}-services-update`,
    update: (metadata) => ({
      ...metadata,
      services,
      registrations,
    }),
  });

  return {
    erc8004RegistryAddress: config.identityRegistryAddress,
    erc8004AgentId: erc8004AgentIdRaw.toString(),
    tokenUri,
  };
}

/**
 * Patches the agent metadata URI with the correct ERC-8004 IdentityRegistry
 * registration entry. Call post-mint after reading `getERC8004AgentId(tokenId)`.
 * Returns an `UpdateServicesResult` ready for `buildUpdateServicesTxArgs`.
 */
export async function prepareRegisterErc8004(
  config: AgentConfig,
  params: PrepareRegisterErc8004Params,
): Promise<UpdateServicesResult> {
  const { erc8004AgentId, agentMetadataUri } = params;

  if (!erc8004AgentId) throw new Error("erc8004AgentId is required.");
  if (!agentMetadataUri) throw new Error("agentMetadataUri is required.");
  if (!config.identityRegistryAddress)
    throw new Error("identityRegistryAddress is not configured.");

  const existingMetadata =
    await readJsonFromUri<Record<string, unknown>>(agentMetadataUri);

  const identityRegistryRef = `eip155:${config.chain.id}:${config.identityRegistryAddress}`;

  // Keep all non-IdentityRegistry registrations; add the correct entry.
  const existingRegs =
    (existingMetadata.registrations as Array<{
      agentId: number;
      agentRegistry: string;
    }>) ?? [];
  const filteredRegs = existingRegs.filter(
    (r) =>
      !r.agentRegistry.startsWith(
        `eip155:${config.chain.id}:${config.identityRegistryAddress}`,
      ),
  );
  const registrations = [
    ...filteredRegs,
    { agentId: Number(erc8004AgentId), agentRegistry: identityRegistryRef },
  ];

  const updatedMetadata = { ...existingMetadata, registrations };
  const tokenUri = await uploadMetadata(
    config,
    updatedMetadata,
    `erc8004-registration-${erc8004AgentId}`,
  );

  return {
    erc8004RegistryAddress: config.identityRegistryAddress,
    erc8004AgentId,
    tokenUri,
  };
}

export async function prepareTeeOracleServiceUpdate(
  config: AgentConfig,
  params: PrepareTeeOracleServiceUpdateParams,
): Promise<PrepareTeeOracleServiceUpdateResult> {
  const { erc8004AgentId, teeOracleUrl } = params;

  if (!erc8004AgentId.trim()) throw new Error("ERC-8004 token ID is required.");
  if (!config.identityRegistryAddress) {
    throw new Error("identityRegistryAddress is not configured.");
  }

  const oracle = await verifyTeeOracleEndpoint(teeOracleUrl);
  const identityRegistry = new IdentityRegistry({
    chainId: config.chain.id,
    rpcUrl: config.rpcUrl,
  });
  const tokenId = BigInt(erc8004AgentId.trim());
  const currentUri = await identityRegistry.tokenURI(tokenId);
  if (!currentUri) {
    throw new Error(`ERC-8004 agent #${erc8004AgentId} has no metadata URI.`);
  }

  const tokenUri = await prepareMetadataUpdatePreservingStorage(config, {
    currentUri,
    label: `erc8004-${erc8004AgentId}-tee-oracle`,
    update: (metadata) => ({
      ...metadata,
      services: upsertTeeOracleService(metadata.services, oracle.url),
    }),
  });

  return {
    erc8004RegistryAddress: config.identityRegistryAddress,
    erc8004AgentId,
    tokenUri,
    teeOracleUrl: oracle.url,
  };
}

export async function fetchAgentServices(
  config: AgentConfig,
  params: FetchAgentServicesParams,
): Promise<FetchAgentServicesResult> {
  const { tokenId, expectedOwner } = params;

  if (!tokenId.trim()) throw new Error("Token ID is required.");
  if (!config.identityRegistryAddress) {
    throw new Error("identityRegistryAddress is not configured.");
  }

  const identityRegistry = new IdentityRegistry({
    chainId: config.chain.id,
    rpcUrl: config.rpcUrl,
  });

  const numericId = BigInt(tokenId.trim());

  if (expectedOwner) {
    const owner = await identityRegistry.ownerOf(numericId);
    if (owner.toLowerCase() !== expectedOwner.toLowerCase()) {
      throw new Error(
        `You do not own ERC-8004 agent #${tokenId}. Owner is ${owner}.`,
      );
    }
  }

  const metadataUri = await identityRegistry.tokenURI(numericId);

  if (!metadataUri) {
    throw new Error(`ERC-8004 agent #${tokenId} has no metadata URI.`);
  }

  const metadata = await readJsonFromUri<{
    name?: string;
    services?: unknown;
  }>(metadataUri);
  const services = servicesFromMetadata(metadata);
  const teeOracle = services.find((service) => service.name === "teeOracle");

  return {
    services,
    agentName: metadata.name ?? `Agent #${tokenId}`,
    metadataUri,
    ...(teeOracle ? { teeOracleUrl: teeOracle.endpoint } : {}),
    metadataStorage: metadataStorage(metadataUri),
  };
}
