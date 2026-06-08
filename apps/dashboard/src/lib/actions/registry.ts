"use server";

import { getCachedAgents, type CachedAgentIndexRow } from "@/lib/agent-cache";
import { getActiveChainId, getServerConfigForChain } from "@/lib/config";
import { AgentRegistry } from "@tee-agent/agent/registry";
import { createPublicClient, http } from "viem";
import {
  fetchFeedbackOverview as sdkFetchFeedbackOverview,
  prepareFeedback as sdkPrepareFeedback,
} from "@tee-agent/agent/feedback";
import type {
  ResolvedAgentProofData,
  PrepareFeedbackParams,
  PrepareFeedbackResult,
} from "@tee-agent/agent/types";
import type { FeedbackOverview } from "@tee-agent/agent/feedback";
export type { FeedbackOverview as AgentFeedbackOverview } from "@tee-agent/agent/feedback";
import {
  getOracleRunHistory,
  fetchValidationResponsesForAgent,
} from "@/lib/actions/agents";

type PreparedFeedbackResult = PrepareFeedbackResult | { error: string };

async function fetchFeedbackOverview(
  cfg: ReturnType<typeof getServerConfigForChain>,
  erc8004AgentId: string | null,
): Promise<FeedbackOverview> {
  if (!erc8004AgentId || !cfg.reputationRegistryAddress || !cfg.rpcUrl) {
    return { totalScore: 0, totalCount: 0, feedbacks: [] };
  }

  try {
    return await sdkFetchFeedbackOverview(cfg, erc8004AgentId);
  } catch (err) {
    console.error("[registry] fetchFeedbackOverview failed:", err);
    return { totalScore: 0, totalCount: 0, feedbacks: [] };
  }
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function getRegisteredAgents(): Promise<CachedAgentIndexRow[]> {
  const cid = await getActiveChainId();
  const cfg = getServerConfigForChain(cid);
  if (!cfg.registryAddress) return [];

  try {
    const cached = await getCachedAgents(cid, cfg.registryAddress);
    return (cached?.agents ?? []).slice().reverse();
  } catch (err) {
    console.error("[registry] getRegisteredAgents failed:", err);
    return [];
  }
}

export async function getAgentPageData(id: string) {
  const cid = await getActiveChainId();
  const cfg = getServerConfigForChain(cid);
  if (!cfg.rpcUrl || !cfg.registryAddress)
    throw new Error("Registry not configured");
  const agentId = BigInt(id);
  const registry = new AgentRegistry({
    address: cfg.registryAddress,
    publicClient: createPublicClient({
      chain: cfg.chain,
      transport: http(cfg.rpcUrl),
    }),
  });
  const [agent, intelligentDataInfo] = await Promise.all([
    registry.resolve(agentId).catch(() => null),
    registry.resolveProofData(agentId).catch(
      () =>
        ({
          verifierAddress: undefined,
          erc8004AgentId: undefined,
          intelligentData: [],
        }) as ResolvedAgentProofData,
    ),
  ]);

  const erc8004Id =
    intelligentDataInfo.erc8004AgentId &&
    intelligentDataInfo.erc8004AgentId !== "0"
      ? intelligentDataInfo.erc8004AgentId
      : null;

  const [oracleRunsResult, validationResponses, feedbackOverview] =
    await Promise.all([
      getOracleRunHistory(id),
      erc8004Id
        ? fetchValidationResponsesForAgent(erc8004Id)
        : Promise.resolve([]),
      fetchFeedbackOverview(cfg, erc8004Id),
    ]);

  return {
    agent,
    intelligentDataInfo,
    feedbackOverview,
    oracleRunsResult,
    validationResponses,
  };
}

// ─── Write ────────────────────────────────────────────────────────────────────

export async function prepareFeedback(
  params: PrepareFeedbackParams,
): Promise<PreparedFeedbackResult> {
  if (!params.agentId) return { error: "Agent ID is required." };
  if (params.value === undefined || params.value === null)
    return { error: "Feedback value is required." };
  if (isNaN(params.value) || params.value < -1 || params.value > 1)
    return { error: "Feedback value must be between -1 and 1." };

  try {
    return await sdkPrepareFeedback(
      getServerConfigForChain(await getActiveChainId()),
      params,
    );
  } catch (err) {
    return {
      error:
        err instanceof Error ? err.message : "Feedback preparation failed.",
    };
  }
}
