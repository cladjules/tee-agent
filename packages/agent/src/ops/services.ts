/**
 * prepareUpdateServices — builds a new ERC-8004 metadata URI for service updates.
 * prepareRegisterErc8004 — post-mint: patches metadata with correct erc8004AgentId.
 * fetchAgentServices — reads existing services from an ERC-8004 Identity Registry token.
 */

import { parseAgentServicesJson, readJsonFromUri } from "../core/crypto.js";
import { uploadMetadata } from "./metadata.js";
import type {
  AgentConfig,
  AgentService,
  UpdateServicesParams,
  UpdateServicesResult,
  FetchAgentServicesParams,
  FetchAgentServicesResult,
  PrepareRegisterErc8004Params,
} from "../core/types.js";
import { createPublicClient, http } from "viem";
import { AgentRegistry } from "../core/registry/agent.js";
import { IdentityRegistry } from "../core/registry/identity.js";

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
    publicClient: createPublicClient({
      chain: config.chain,
      transport: http(config.rpcUrl),
    }),
  });
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
    services,
    registrations,
  };

  const tokenUri = await uploadMetadata(
    config,
    updatedMetadata,
    `agent-${tokenId}-services-update`,
  );

  return {
    erc8004RegistryAddress: config.identityRegistryAddress,
    erc8004AgentId: erc8004AgentIdRaw.toString(),
    tokenUri,
  };
}

/**
 * Patches the agent metadata URI with the correct ERC-8004 IdentityRegistry
 * registration entry. Call post-mint using the `ERC8004Registered` event data.
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

export async function fetchAgentServices(
  config: AgentConfig,
  params: FetchAgentServicesParams,
): Promise<FetchAgentServicesResult> {
  const { tokenId } = params;

  if (!tokenId.trim()) throw new Error("Token ID is required.");
  if (!config.identityRegistryAddress) {
    throw new Error("identityRegistryAddress is not configured.");
  }

  const identityRegistry = new IdentityRegistry({
    address: config.identityRegistryAddress!,
    publicClient: createPublicClient({
      chain: config.chain,
      transport: http(config.rpcUrl),
    }),
  });

  const numericId = BigInt(tokenId.trim());

  const metadataUri = await identityRegistry.tokenURI(numericId);

  if (!metadataUri) {
    throw new Error(`ERC-8004 agent #${tokenId} has no metadata URI.`);
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
