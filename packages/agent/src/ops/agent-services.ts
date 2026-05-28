/**
 * prepareUpdateServices — builds a new ERC-8004 metadata URI for service updates.
 * fetchAgentServices — reads existing services from an ERC-8004 Identity Registry token.
 */

import { makePublicClient } from "../core/client.js";
import { AgentRegistry, IdentityRegistry } from "../core/registry.js";
import { parseAgentServicesJson, readJsonFromUri } from "../crypto/index.js";
import { IpfsClient } from "../storage/ipfs.js";
import type {
  AgentConfig,
  AgentService,
  UpdateServicesParams,
  UpdateServicesResult,
  FetchAgentServicesParams,
  FetchAgentServicesResult,
} from "../core/types.js";

function makeRegistry(config: AgentConfig): AgentRegistry {
  return new AgentRegistry({
    agentRegistryAddress: config.registryAddress,
    publicClient: makePublicClient(config) as any,
  });
}

export async function prepareUpdateServices(
  config: AgentConfig,
  params: UpdateServicesParams,
): Promise<UpdateServicesResult> {
  const { tokenId, servicesJson } = params;

  if (!tokenId) return { error: "Token ID is required." };
  if (!config.identityRegistryAddress)
    return { error: "identityRegistryAddress is not configured." };

  const { services, error } = parseAgentServicesJson(servicesJson);
  if (error) return { error };

  const registry = makeRegistry(config);
  const numericTokenId = BigInt(tokenId);

  const [currentMetadataUri, erc8004AgentIdRaw] = await Promise.all([
    registry.getMetadataUri(numericTokenId),
    registry.getERC8004AgentId(numericTokenId),
  ]);

  const existingMetadata =
    await readJsonFromUri<Record<string, unknown>>(currentMetadataUri);

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

  const updatedMetadata = {
    ...existingMetadata,
    services: services ?? [],
    registrations,
  };

  let tokenUri: string;
  if (config.pinataJwt) {
    const ipfsClient = new IpfsClient({ jwt: config.pinataJwt });
    const upload = await ipfsClient.uploadJSON(
      updatedMetadata,
      `agent-${tokenId}-services-update`,
    );
    tokenUri = upload.url;
  } else {
    tokenUri = `data:application/json;base64,${Buffer.from(
      JSON.stringify(updatedMetadata),
    ).toString("base64")}`;
  }

  return {
    erc8004RegistryAddress: config.identityRegistryAddress,
    erc8004AgentId: erc8004AgentIdRaw.toString(),
    tokenUri,
  };
}

export async function fetchAgentServices(
  config: AgentConfig,
  params: FetchAgentServicesParams,
): Promise<FetchAgentServicesResult> {
  const { tokenId, ownerAddress } = params;

  if (!tokenId.trim()) return { error: "Token ID is required." };
  if (!config.identityRegistryAddress) {
    return { error: "identityRegistryAddress is not configured." };
  }

  const identityRegistry = new IdentityRegistry({
    address: config.identityRegistryAddress,
    publicClient: makePublicClient(config) as any,
  });
  const numericId = BigInt(tokenId.trim());

  const [owner, metadataUri] = await Promise.all([
    identityRegistry.ownerOf(numericId),
    identityRegistry.tokenURI(numericId),
  ]);

  if (owner.toLowerCase() !== ownerAddress.toLowerCase()) {
    return {
      error: `ERC-8004 agent #${tokenId} is not owned by your wallet.`,
    };
  }

  if (!metadataUri) {
    return { error: `ERC-8004 agent #${tokenId} has no metadata URI.` };
  }

  const metadata = await readJsonFromUri<{
    name?: string;
    services?: AgentService[];
  }>(metadataUri);

  return {
    services: (metadata.services ?? []).map((s) => ({
      name: s.name,
      endpoint: s.endpoint,
      ...(s.version !== undefined ? { version: s.version } : {}),
      ...(s.skills && s.skills.length > 0 ? { skills: [...s.skills] } : {}),
      ...(s.domains && s.domains.length > 0 ? { domains: [...s.domains] } : {}),
    })) as AgentService[],
    agentName: metadata.name ?? `Agent #${tokenId}`,
  };
}
