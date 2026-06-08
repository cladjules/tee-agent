"use server";

import { prepareMint } from "@tee-agent/agent/mint";
import { preparePublicMetadataUpdate } from "@tee-agent/agent/metadata";
import { createTransferOffer } from "@tee-agent/agent/transfer";
import {
  prepareUpdateServices,
  fetchAgentServices as sdkFetchAgentServices,
  prepareRegisterErc8004 as sdkPrepareRegisterErc8004,
  prepareTeeOracleServiceUpdate as sdkPrepareTeeOracleServiceUpdate,
} from "@tee-agent/agent/services";
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
import { getActiveChainId, getServerConfigForChain } from "@/lib/config";
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

// ─── Write ────────────────────────────────────────────────────────────────────

export async function prepareCreateAgent(params: MintParams) {
  const cid = await getActiveChainId();
  try {
    return await prepareMint(getServerConfigForChain(cid), params);
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Create preparation failed.",
    };
  }
}

export async function prepareUpdateAgentPublicMetadata(
  params: AgentPublicMetadataParams,
) {
  const cid = await getActiveChainId();
  try {
    const parsed = agentPublicMetadataParamsSchema.parse(params);
    return await preparePublicMetadataUpdate(
      getServerConfigForChain(cid),
      parsed,
    );
  } catch (err) {
    return {
      error: zodErrorMessage(err, "Updating ERC-721 metadata failed."),
    };
  }
}

export async function prepareTransferOfferAgent(params: TransferParams) {
  if (!params.tokenId) return { error: "Token ID is required." };
  if (!params.to) return { error: "Recipient address is required." };
  const cid = await getActiveChainId();
  try {
    return await createTransferOffer(getServerConfigForChain(cid), params);
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
  params: UpdateServicesParams,
): Promise<UpdateServicesResult | { error: string }> {
  if (!params.tokenId) return { error: "Token ID is required." };
  const cid = await getActiveChainId();
  try {
    return await prepareUpdateServices(getServerConfigForChain(cid), params);
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
  params: PrepareRegisterErc8004Params,
): Promise<UpdateServicesResult | { error: string }> {
  if (!params.erc8004AgentId) return { error: "erc8004AgentId is required." };
  if (!params.agentMetadataUri)
    return { error: "agentMetadataUri is required." };
  const cid = await getActiveChainId();
  try {
    return await sdkPrepareRegisterErc8004(
      getServerConfigForChain(cid),
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
  params: PrepareTeeOracleServiceUpdateParams,
): Promise<PrepareTeeOracleServiceUpdateResult | { error: string }> {
  if (!params.erc8004AgentId.trim())
    return { error: "ERC-8004 token ID is required." };
  if (!params.teeOracleUrl.trim())
    return { error: "teeOracle URL is required." };
  const cid = await getActiveChainId();
  try {
    return await sdkPrepareTeeOracleServiceUpdate(
      getServerConfigForChain(cid),
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
): Promise<FetchAgentServicesResult | { error: string }> {
  const cid = await getActiveChainId();
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
  params: RecordOracleRunParams,
): Promise<{ ok: true; run: CachedOracleRun } | { ok: false; error: string }> {
  const cid = await getActiveChainId();
  const { registryAddress } = getServerConfigForChain(cid);
  if (!registryAddress) {
    return { ok: false, error: "AgentRegistry is not configured." };
  }
  try {
    const parsedParams = recordOracleRunParamsSchema.parse(params);

    const oracleUrl = parsedParams.teeOracleUrl;
    const services = await sdkFetchAgentServices(getServerConfigForChain(cid), {
      tokenId: parsedParams.erc8004AgentId,
    });
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
      cid,
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
): Promise<ValidationResponse[]> {
  const cid = await getActiveChainId();
  const cfg = getServerConfigForChain(cid);
  try {
    if (!cfg.validationRegistryAddress) return [];
    return await getCachedValidationResponses(
      cid,
      cfg.validationRegistryAddress,
      BigInt(agentId),
    );
  } catch {
    return [];
  }
}

export async function getOracleRunHistory(agentId: string) {
  const cid = await getActiveChainId();
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
