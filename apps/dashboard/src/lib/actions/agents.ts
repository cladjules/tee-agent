"use server";

import { prepareMint } from "@tee-agent/agent/mint";
import { prepareTransfer } from "@tee-agent/agent/transfer";
import {
  prepareUpdateServices,
  fetchAgentServices as sdkFetchAgentServices,
  prepareRegisterErc8004 as sdkPrepareRegisterErc8004,
  prepareImportedErc8004TeeOracle as sdkPrepareImportedErc8004TeeOracle,
} from "@tee-agent/agent/services";
import type {
  FetchAgentServicesResult,
  UpdateServicesResult,
  MintParams,
  TransferParams,
  UpdateServicesParams,
  PrepareRegisterErc8004Params,
  PrepareImportedErc8004TeeOracleParams,
  PrepareImportedErc8004TeeOracleResult,
} from "@tee-agent/agent/types";
import {
  getMutationConfigForChain,
  getServerConfigForChain,
  isConfigured,
} from "@/lib/config";
import { getActiveChainId } from "@/lib/active-chain";
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
    responseURI?: string;
    responseHash?: string;
    tag?: string;
    reasoning?: string;
    evidence?: Record<string, unknown>;
  };
};

// ─── Write ────────────────────────────────────────────────────────────────────

export async function prepareCreateAgent(params: MintParams, chainId?: number) {
  if (!isConfigured) return { error: "Contracts not configured." };
  const cid = chainId ?? (await getActiveChainId());
  try {
    return await prepareMint(getMutationConfigForChain(cid), params);
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Create preparation failed.",
    };
  }
}

export async function prepareTransferAgent(
  params: TransferParams,
  chainId?: number,
) {
  if (!params.tokenId) return { error: "Token ID is required." };
  if (!params.to) return { error: "Recipient address is required." };
  if (!isConfigured) return { error: "Contracts not configured." };
  const cid = chainId ?? (await getActiveChainId());
  try {
    return await prepareTransfer(getMutationConfigForChain(cid), params);
  } catch (err) {
    return {
      error:
        err instanceof Error ? err.message : "Transfer preparation failed.",
    };
  }
}

export async function prepareUpdateAgentServices(
  params: UpdateServicesParams,
  chainId?: number,
): Promise<UpdateServicesResult | { error: string }> {
  if (!params.tokenId) return { error: "Token ID is required." };
  if (!isConfigured) return { error: "Contracts not configured." };
  const cid = chainId ?? (await getActiveChainId());
  try {
    return await prepareUpdateServices(getMutationConfigForChain(cid), params);
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
  chainId?: number,
): Promise<UpdateServicesResult | { error: string }> {
  if (!params.erc8004AgentId) return { error: "erc8004AgentId is required." };
  if (!params.agentMetadataUri)
    return { error: "agentMetadataUri is required." };
  if (!isConfigured) return { error: "Contracts not configured." };
  const cid = chainId ?? (await getActiveChainId());
  try {
    return await sdkPrepareRegisterErc8004(
      getMutationConfigForChain(cid),
      params,
    );
  } catch (err) {
    return {
      error:
        err instanceof Error ? err.message : "ERC-8004 registration failed.",
    };
  }
}

export async function prepareImportedErc8004TeeOracle(
  params: PrepareImportedErc8004TeeOracleParams,
  chainId?: number,
): Promise<PrepareImportedErc8004TeeOracleResult | { error: string }> {
  if (!params.erc8004AgentId.trim())
    return { error: "ERC-8004 token ID is required." };
  if (!params.teeOracleUrl.trim())
    return { error: "teeOracle URL is required." };
  if (!isConfigured) return { error: "Contracts not configured." };
  const cid = chainId ?? (await getActiveChainId());
  try {
    return await sdkPrepareImportedErc8004TeeOracle(
      getMutationConfigForChain(cid),
      params,
    );
  } catch (err) {
    return {
      error:
        err instanceof Error
          ? err.message
          : "Preparing ERC-8004 metadata update failed.",
    };
  }
}

export async function fetchAgentServices(
  tokenId: string,
  expectedOwner?: `0x${string}`,
  chainId?: number,
): Promise<FetchAgentServicesResult | { error: string }> {
  if (!isConfigured) return { error: "Contracts not configured." };
  const cid = chainId ?? (await getActiveChainId());
  try {
    return await sdkFetchAgentServices(getServerConfigForChain(cid), {
      tokenId,
      expectedOwner,
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
  chainId?: number,
): Promise<{ ok: boolean; error?: string }> {
  const cid = chainId ?? (await getActiveChainId());
  const { registryAddress } = getServerConfigForChain(cid);
  try {
    await addCachedOracleRun(cid, registryAddress, BigInt(run.agentId), run);
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
  chainId?: number,
): Promise<PendingValidation[]> {
  const cid = chainId ?? (await getActiveChainId());
  const { registryAddress } = getServerConfigForChain(cid);
  try {
    const items = await getCachedValidations(
      cid,
      registryAddress,
      BigInt(agentId),
    );
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

export async function getOracleRunHistory(agentId: string, chainId?: number) {
  const cid = chainId ?? (await getActiveChainId());
  const { registryAddress } = getServerConfigForChain(cid);
  try {
    const runs = await getCachedOracleRuns(
      cid,
      registryAddress,
      BigInt(agentId),
    );
    return { runs };
  } catch (err) {
    return {
      runs: [],
      error: err instanceof Error ? err.message : "Failed to fetch history.",
    };
  }
}
