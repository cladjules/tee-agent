"use server";

import { getCachedAgents, type CachedAgentsByChainId } from "@/lib/agent-cache";
import {
  getAvailableChainId,
  getConfiguredChainIds,
  getServerConfigForChain,
} from "@/lib/config";
import { AgentRegistry } from "@tee-agent/agent/registry";
import {
  fetchFeedbackOverview as sdkFetchFeedbackOverview,
  prepareFeedback as sdkPrepareFeedback,
} from "@tee-agent/agent/ops/feedback";
import type {
  ResolvedAgentProofData,
  PrepareFeedbackParams,
  PrepareFeedbackResult,
} from "@tee-agent/agent/types";
import type { FeedbackOverview } from "@tee-agent/agent/ops/feedback";
export type { FeedbackOverview as AgentFeedbackOverview } from "@tee-agent/agent/ops/feedback";
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

export async function getRegisteredAgents(): Promise<CachedAgentsByChainId> {
  const entries = await Promise.all(
    getConfiguredChainIds().map(async (chainId) => {
      const cfg = getServerConfigForChain(chainId);
      try {
        const cached = await getCachedAgents(chainId, cfg.registryAddress);
        return [chainId, (cached?.agents ?? []).slice().reverse()] as const;
      } catch (err) {
        throw new Error(
          `[registry] getRegisteredAgents failed chain=${chainId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }),
  );
  return Object.fromEntries(entries) as CachedAgentsByChainId;
}

export async function getAgentPageData(id: string, _chainId?: number) {
  const chainId = getAvailableChainId(_chainId);
  const cfg = getServerConfigForChain(chainId);
  if (!cfg.rpcUrl) throw new Error(`RPC not configured for chain ${chainId}.`);
  const agentId = BigInt(id);
  const registry = new AgentRegistry({
    address: cfg.registryAddress,
    chainId: chainId,
    rpcUrl: cfg.rpcUrl,
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
      getOracleRunHistory(id, chainId),
      erc8004Id
        ? fetchValidationResponsesForAgent(erc8004Id, chainId)
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
  params: PrepareFeedbackParams & { chainId?: number },
): Promise<PreparedFeedbackResult> {
  if (!params.agentId) return { error: "Agent ID is required." };
  if (params.value === undefined || params.value === null)
    return { error: "Feedback value is required." };
  if (isNaN(params.value) || params.value < -1 || params.value > 1)
    return { error: "Feedback value must be between -1 and 1." };

  try {
    return await sdkPrepareFeedback(
      getServerConfigForChain(params.chainId),
      params,
    );
  } catch (err) {
    return {
      error:
        err instanceof Error ? err.message : "Feedback preparation failed.",
    };
  }
}
