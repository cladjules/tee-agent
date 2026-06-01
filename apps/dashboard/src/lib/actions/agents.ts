"use server";

import { prepareMint } from "@tee-agent/agent/mint";
import { prepareTransfer } from "@tee-agent/agent/transfer";
import {
  prepareUpdateServices,
  fetchAgentServices as sdkFetchAgentServices,
  prepareRegisterErc8004 as sdkPrepareRegisterErc8004,
} from "@tee-agent/agent/services";
import type {
  FetchAgentServicesResult,
  UpdateServicesResult,
  MintParams,
  TransferParams,
  UpdateServicesParams,
  PrepareRegisterErc8004Params,
} from "@tee-agent/agent/types";
import { cfg, isConfigured } from "@/lib/config";
import {
  addCachedOracleRun,
  getCachedOracleRuns,
  getCachedValidations,
  type CachedOracleRun,
} from "@/lib/agent-cache";

export type PendingValidation = {
  requestHash: string;
  /** data:application/json;base64,… encoding the run payload */
  requestURI: string;
  agentId: string;
  validatorAddress: string;
  /** Present once the on-chain ValidationResponse has been indexed. */
  response?: {
    score: number;
    txHash?: string;
    timestamp: number;
  };
};

// ─── Write ────────────────────────────────────────────────────────────────────

export async function prepareCreateAgent(params: MintParams) {
  if (!isConfigured) return { error: "Contracts not configured." };

  try {
    return await prepareMint(cfg, params);
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Create preparation failed.",
    };
  }
}

export async function prepareTransferAgent(params: TransferParams) {
  if (!params.tokenId) return { error: "Token ID is required." };
  if (!params.to) return { error: "Recipient address is required." };
  if (!isConfigured) return { error: "Contracts not configured." };

  try {
    return await prepareTransfer(cfg, params);
  } catch (err) {
    return {
      error:
        err instanceof Error ? err.message : "Transfer preparation failed.",
    };
  }
}

export async function prepareUpdateAgentServices(
  params: UpdateServicesParams,
): Promise<UpdateServicesResult | { error: string }> {
  if (!params.tokenId) return { error: "Token ID is required." };
  if (!isConfigured) return { error: "Contracts not configured." };

  try {
    return await prepareUpdateServices(cfg, params);
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Updating services failed.",
    };
  }
}

/**
 * Post-mint: patch the agent metadata with the correct ERC-8004 IdentityRegistry
 * registration entry. Call with data from the `ERC8004Registered` event.
 * Returns an `UpdateServicesResult` ready for `buildUpdateServicesTxArgs`.
 */
export async function preparePostMintRegistration(
  params: PrepareRegisterErc8004Params,
): Promise<UpdateServicesResult | { error: string }> {
  if (!params.erc8004AgentId) return { error: "erc8004AgentId is required." };
  if (!params.agentMetadataUri)
    return { error: "agentMetadataUri is required." };
  if (!isConfigured) return { error: "Contracts not configured." };

  try {
    return await sdkPrepareRegisterErc8004(cfg, params);
  } catch (err) {
    return {
      error:
        err instanceof Error ? err.message : "ERC-8004 registration failed.",
    };
  }
}

export async function fetchAgentServices(
  tokenId: string,
): Promise<FetchAgentServicesResult | { error: string }> {
  if (!isConfigured) return { error: "Contracts not configured." };

  try {
    return await sdkFetchAgentServices(cfg, { tokenId });
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

export async function fetchPendingValidationsForAgent(
  agentId: string,
): Promise<PendingValidation[]> {
  try {
    const items = await getCachedValidations(BigInt(agentId));
    return items.map((item) => ({
      requestHash: item.requestHash,
      requestURI: item.requestURI,
      agentId: item.agentId,
      validatorAddress: item.validatorAddress,
      response: item.response,
    }));
  } catch {
    return [];
  }
}

export async function getOracleRunHistory(agentId: string) {
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
