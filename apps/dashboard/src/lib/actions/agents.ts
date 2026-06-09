"use server";

import { prepareMint } from "@tee-agent/agent/ops/mint";
import { preparePublicMetadataUpdate } from "@tee-agent/agent/ops/metadata";
import { createTransferOffer } from "@tee-agent/agent/ops/transfer";
import {
  prepareUpdateServices,
  fetchAgentServices as sdkFetchAgentServices,
  prepareRegisterErc8004 as sdkPrepareRegisterErc8004,
  prepareTeeOracleServiceUpdate as sdkPrepareTeeOracleServiceUpdate,
} from "@tee-agent/agent/ops/services";
import type {
  FetchAgentServicesResult,
  UpdateServicesResult,
  MintParams,
  TransferParams,
  UpdateServicesParams,
  PrepareRegisterErc8004Params,
  PrepareTeeOracleServiceUpdateParams,
  PrepareTeeOracleServiceUpdateResult,
} from "@tee-agent/agent/types";
import { getAvailableChainId, getServerConfigForChain } from "@/lib/config";
import {
  addCachedOracleRun,
  getCachedOracleRuns,
  getCachedValidationResponses,
  type IndexedValidationResponse,
  type CachedOracleRun,
} from "@/lib/agent-cache";
import {
  oracleAddressResponseSchema,
  oracleErrorResponseSchema,
  oracleRunResponseSchema,
  oracleUrlSchema,
  agentPublicMetadataParamsSchema,
  recordOracleRunParamsSchema,
  type AgentPublicMetadataParams,
  type RecordOracleRunParams,
  zodErrorMessage,
} from "./schemas";

export type ValidationResponse = IndexedValidationResponse;
type ChainScoped<T> = T & { chainId?: number };

// ─── Write ────────────────────────────────────────────────────────────────────

export async function prepareCreateAgent(params: ChainScoped<MintParams>) {
  const chainId = getAvailableChainId(params.chainId);
  try {
    return await prepareMint(getServerConfigForChain(chainId), params);
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Create preparation failed.",
    };
  }
}

export async function prepareUpdateAgentPublicMetadata(
  params: AgentPublicMetadataParams,
) {
  const chainId = getAvailableChainId(params.chainId);
  try {
    const parsed = agentPublicMetadataParamsSchema.parse(params);
    return await preparePublicMetadataUpdate(
      getServerConfigForChain(chainId),
      parsed,
    );
  } catch (err) {
    return {
      error: zodErrorMessage(err, "Updating ERC-721 metadata failed."),
    };
  }
}

export async function prepareTransferOfferAgent(
  params: ChainScoped<TransferParams>,
) {
  if (!params.tokenId) return { error: "Token ID is required." };
  if (!params.to) return { error: "Recipient address is required." };
  const chainId = getAvailableChainId(params.chainId);
  try {
    return await createTransferOffer(getServerConfigForChain(chainId), params);
  } catch (err) {
    return {
      error:
        err instanceof Error
          ? err.message
          : "Transfer offer preparation failed.",
    };
  }
}

export async function prepareUpdateAgentServices(
  params: ChainScoped<UpdateServicesParams>,
): Promise<UpdateServicesResult | { error: string }> {
  if (!params.tokenId) return { error: "Token ID is required." };
  const chainId = getAvailableChainId(params.chainId);
  try {
    return await prepareUpdateServices(
      getServerConfigForChain(chainId),
      params,
    );
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Updating services failed.",
    };
  }
}

/**
 * Post-mint: patch the agent metadata with the correct ERC-8004 IdentityRegistry
 * registration entry after reading `getERC8004AgentId(tokenId)`.
 * Returns an `UpdateServicesResult` ready for `buildUpdateServicesTxArgs`.
 */
export async function preparePostMintRegistration(
  params: ChainScoped<PrepareRegisterErc8004Params>,
): Promise<UpdateServicesResult | { error: string }> {
  if (!params.erc8004AgentId) return { error: "erc8004AgentId is required." };
  if (!params.agentMetadataUri)
    return { error: "agentMetadataUri is required." };
  const chainId = getAvailableChainId(params.chainId);
  try {
    return await sdkPrepareRegisterErc8004(
      getServerConfigForChain(chainId),
      params,
    );
  } catch (err) {
    return {
      error:
        err instanceof Error ? err.message : "ERC-8004 registration failed.",
    };
  }
}

export async function prepareTeeOracleServiceUpdate(
  params: ChainScoped<PrepareTeeOracleServiceUpdateParams>,
): Promise<PrepareTeeOracleServiceUpdateResult | { error: string }> {
  if (!params.erc8004AgentId.trim())
    return { error: "ERC-8004 token ID is required." };
  if (!params.teeOracleUrl.trim())
    return { error: "teeOracle URL is required." };
  const chainId = getAvailableChainId(params.chainId);
  try {
    return await sdkPrepareTeeOracleServiceUpdate(
      getServerConfigForChain(chainId),
      params,
    );
  } catch (err) {
    return {
      error:
        err instanceof Error
          ? err.message
          : "Preparing teeOracle metadata update failed.",
    };
  }
}

export async function fetchAgentServices(
  tokenId: string,
  expectedOwner?: `0x${string}`,
  _chainId?: number,
): Promise<FetchAgentServicesResult | { error: string }> {
  const chainId = getAvailableChainId(_chainId);
  try {
    return await sdkFetchAgentServices(getServerConfigForChain(chainId), {
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
  params: RecordOracleRunParams,
): Promise<{ ok: true; run: CachedOracleRun } | { ok: false; error: string }> {
  const chainId = getAvailableChainId(params.chainId);
  const { registryAddress } = getServerConfigForChain(chainId);
  try {
    const parsedParams = recordOracleRunParamsSchema.parse(params);

    const oracleUrl = parsedParams.teeOracleUrl;
    const services = await sdkFetchAgentServices(
      getServerConfigForChain(chainId),
      {
        tokenId: parsedParams.erc8004AgentId,
      },
    );
    const registeredOracleUrl = services.teeOracleUrl
      ? oracleUrlSchema.parse(services.teeOracleUrl)
      : "";
    if (oracleUrl !== registeredOracleUrl) {
      throw new Error(
        "teeOracleUrl does not match the registered agent service.",
      );
    }

    const addressRes = await fetch(`${oracleUrl}/address`, {
      cache: "no-store",
    });
    if (!addressRes.ok) {
      throw new Error(`GET /address failed: ${addressRes.status}`);
    }
    const oracleInfo = oracleAddressResponseSchema.parse(
      await addressRes.json(),
    );

    const runRes = await fetch(`${oracleUrl}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        agentId: parsedParams.agentId,
        payload: parsedParams.payload,
        signature: parsedParams.signature,
        deadline: parsedParams.deadline,
        registryAddress,
      }),
    });
    const raw = await runRes.text();
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    if (!runRes.ok) {
      const errorBody = oracleErrorResponseSchema.safeParse(parsed);
      throw new Error(
        errorBody.success
          ? errorBody.data.error
          : `Oracle error ${runRes.status}`,
      );
    }
    const runResponse = oracleRunResponseSchema.parse(parsed);
    if (runResponse.agentId !== parsedParams.agentId) {
      throw new Error("Oracle response agentId mismatch.");
    }

    const run: CachedOracleRun = {
      agentId: parsedParams.agentId,
      result: runResponse.result as CachedOracleRun["result"],
      timestamp: runResponse.timestamp,
      quote: runResponse.quote,
      event_log: runResponse.event_log,
      oracleAddress: oracleInfo.address,
      payload: parsedParams.payload,
    };
    await addCachedOracleRun(
      chainId,
      registryAddress,
      BigInt(parsedParams.agentId),
      run,
    );
    return { ok: true, run };
  } catch (err) {
    return {
      ok: false,
      error: zodErrorMessage(err, "Failed to record run."),
    };
  }
}

export async function fetchValidationResponsesForAgent(
  agentId: string,
  _chainId?: number,
): Promise<ValidationResponse[]> {
  const chainId = getAvailableChainId(_chainId);
  const cfg = getServerConfigForChain(chainId);
  try {
    if (!cfg.validationRegistryAddress) return [];
    return await getCachedValidationResponses(
      chainId,
      cfg.validationRegistryAddress,
      BigInt(agentId),
    );
  } catch {
    return [];
  }
}

export async function getOracleRunHistory(agentId: string, _chainId?: number) {
  const chainId = getAvailableChainId(_chainId);
  const { registryAddress } = getServerConfigForChain(chainId);
  try {
    const runs = await getCachedOracleRuns(
      chainId,
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
