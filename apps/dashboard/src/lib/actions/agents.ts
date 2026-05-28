"use server";

import { prepareMint } from "@tee-agent/agent/mint";
import { prepareTransfer } from "@tee-agent/agent/transfer";
import {
  prepareUpdateServices,
  fetchAgentServices as sdkFetchAgentServices,
} from "@tee-agent/agent/agent-services";
import type {
  FetchAgentServicesResult,
  UpdateServicesResult,
  AgentConfig,
} from "@tee-agent/agent/types";
import { cfg } from "@/lib/config";
import {
  addCachedOracleRun,
  getCachedOracleRuns,
  updateOracleRunValidationHash,
  getPendingValidationsForAgent,
  removePendingValidation,
  type CachedOracleRun,
  type PendingValidation,
} from "@/lib/agent-cache";

// ─── Config bridge ────────────────────────────────────────────────────────────

function toAgentConfig(): AgentConfig {
  return {
    rpcUrl: cfg.rpcUrl ?? "",
    chain: cfg.chain,
    registryAddress: cfg.registryAddress ?? ("0x" as `0x${string}`),
    identityRegistryAddress: cfg.identityRegistryAddress,
    reputationRegistryAddress: cfg.reputationAddress,
    validationRegistryAddress: cfg.validationAddress,
    teeVerifierAddress: cfg.teeVerifierAddress,
    oracleUrl: cfg.oracleUrl,
    pinataJwt: cfg.pinataJwt,
    zeroGPrivateKey: cfg.zeroGKey,
    zeroGRpcUrl: cfg.zeroGRpcUrl,
    zeroGIndexerUrl: cfg.zeroGIndexerUrl,
  };
}

export type PreparedCreateAgentResult = {
  contractAddress?: `0x${string}`;
  agentRegistry?: string;
  publicMetadataUri?: string;
  agentMetadataUri?: string;
  mintFee?: string;
  intelligentData?: Array<{ dataDescription: string; dataHash: `0x${string}` }>;
  error?: string;
};

export type PreparedTransferAgentResult = {
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

// ─── Write ────────────────────────────────────────────────────────────────────

export async function prepareCreateAgent(
  formData: FormData,
): Promise<PreparedCreateAgentResult | { tokenId: bigint }> {
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

  if (!cfg.isConfigured) {
    const fallbackTokenId = BigInt(Math.floor(Math.random() * 9000) + 1000);
    return { tokenId: fallbackTokenId };
  }

  let privateEntries: Array<{ name: string; data: string }> = [];
  try {
    privateEntries = JSON.parse(privateEntriesJson) as typeof privateEntries;
  } catch {
    /* ignore malformed JSON */
  }

  let oasfSkills: string[] = [];
  let oasfDomains: string[] = [];
  try {
    oasfSkills = JSON.parse(oasfSkillsJson) as string[];
    oasfDomains = JSON.parse(oasfDomainsJson) as string[];
  } catch {
    /* ignore malformed JSON */
  }

  let services: Array<{
    name: string;
    endpoint: string;
    version?: string;
    skills?: string[];
    domains?: string[];
  }> = [];
  if (servicesJson) {
    try {
      services = JSON.parse(servicesJson) as typeof services;
    } catch {
      /* ignore malformed JSON */
    }
  }

  try {
    const result = await prepareMint(toAgentConfig(), {
      name: name ?? "",
      description: description ?? "",
      imageUrl: imageUrl ?? undefined,
      agentType,
      services,
      x402Support,
      privateEntries,
      oasfSkills,
      oasfDomains,
      ownerAddress: ownerAddress ?? ("0x" as `0x${string}`),
    });

    if ("error" in result) return { error: result.error };

    return {
      contractAddress: result.contractAddress,
      agentRegistry: result.agentRegistry,
      publicMetadataUri: result.publicMetadataUri,
      agentMetadataUri: result.agentMetadataUri,
      mintFee: result.mintFee,
      intelligentData: result.intelligentData,
    };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Create preparation failed.",
    };
  }
}

export async function prepareTransferAgent(
  formData: FormData,
): Promise<PreparedTransferAgentResult> {
  const tokenId = (formData.get("tokenId") as string | null)?.trim();
  const to = (formData.get("to") as string | null)?.trim() as
    | `0x${string}`
    | undefined;
  const newOwnerPublicKey = (
    formData.get("newOwnerPublicKey") as string | null
  )?.trim() as `0x${string}` | undefined;
  const oracleSignature = (
    formData.get("oracleSignature") as string | null
  )?.trim();
  const oracleDeadline = (
    formData.get("oracleDeadline") as string | null
  )?.trim();

  if (!tokenId) return { error: "Token ID is required." };
  if (!to) return { error: "Recipient address is required." };
  if (!cfg.isConfigured) return { error: "Contracts not configured." };

  try {
    const result = await prepareTransfer(toAgentConfig(), {
      tokenId,
      to,
      newOwnerPublicKey,
      oracleSignature,
      oracleDeadline,
    });

    if ("error" in result) return { error: result.error };

    return {
      contractAddress: result.contractAddress,
      tokenId: result.tokenId,
      from: result.from,
      to: result.to,
      deadline: result.deadline,
      newDataHashes: result.newDataHashes,
      sealedKey: result.sealedKey,
      accessPayloads: result.accessPayloads,
      ownershipProofs: result.ownershipProofs,
    };
  } catch (err) {
    return {
      error:
        err instanceof Error ? err.message : "Transfer preparation failed.",
    };
  }
}

export async function prepareUpdateAgentServices(
  formData: FormData,
): Promise<UpdateServicesResult> {
  const tokenId = (formData.get("tokenId") as string | null)?.trim();
  const servicesJson =
    (formData.get("servicesJson") as string | null)?.trim() ?? "[]";

  if (!tokenId) return { error: "Token ID is required." };
  if (!cfg.isConfigured) return { error: "Contracts not configured." };

  try {
    return await prepareUpdateServices(toAgentConfig(), {
      tokenId,
      servicesJson,
    });
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Updating services failed.",
    };
  }
}

export async function fetchAgentServices(
  tokenId: string,
  ownerAddress: string,
): Promise<FetchAgentServicesResult> {
  if (!cfg.isConfigured) return { error: "Contracts not configured." };

  try {
    return await sdkFetchAgentServices(toAgentConfig(), {
      tokenId,
      ownerAddress,
    });
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Failed to fetch agent.",
    };
  }
}

// ─── Oracle run persistence (Redis — stays in dashboard) ─────────────────────

export async function recordOracleRun(
  run: Omit<CachedOracleRun, never>,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await addCachedOracleRun(BigInt(run.agentId), run);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to record run.",
    };
  }
}

export async function markRunValidationRequested(
  agentId: string,
  runTimestamp: number,
  requestHash: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await updateOracleRunValidationHash(
      BigInt(agentId),
      runTimestamp,
      requestHash,
    );
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to update run.",
    };
  }
}

export async function fetchPendingValidationsForAgent(
  agentId: string,
): Promise<PendingValidation[]> {
  try {
    return await getPendingValidationsForAgent(agentId);
  } catch {
    return [];
  }
}

export async function markValidationComplete(
  agentId: string,
  requestHash: string,
  run: Omit<CachedOracleRun, never>,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await Promise.all([
      removePendingValidation(agentId, requestHash),
      addCachedOracleRun(BigInt(agentId), run),
    ]);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to mark complete.",
    };
  }
}

export async function getOracleRunHistory(
  agentId: string,
): Promise<{ runs: CachedOracleRun[]; error?: string }> {
  try {
    const runs = await getCachedOracleRuns(BigInt(agentId));
    return { runs };
  } catch (err) {
    return {
      runs: [],
      error: err instanceof Error ? err.message : "Failed to fetch history.",
    };
  }
}
