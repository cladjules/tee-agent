"use server";

import type { Address } from "viem";
import { getCachedAgents, type CachedAgentIndexRow } from "@/lib/agent-cache";
import { getActiveChainId, getServerConfigForChain } from "@/lib/config";
import { AgentRegistry } from "@tee-agent/agent/registry";
import { REPUTATION_REGISTRY_ABI } from "@tee-agent/agent/abis";
import { createPublicClient, http } from "viem";
import { prepareFeedback as sdkPrepareFeedback } from "@tee-agent/agent/feedback";
import type {
  ResolvedAgentProofData,
  PrepareFeedbackParams,
  PrepareFeedbackResult,
} from "@tee-agent/agent/types";
import {
  getOracleRunHistory,
  fetchValidationResponsesForAgent,
} from "@/lib/actions/agents";

// ─── Dashboard-local types ────────────────────────────────────────────────────

export type AgentFeedbackView = {
  client: Address;
  feedbackIndex: number;
  value: string;
  valueDecimals: number;
  normalizedValue: number;
  tag1: string;
  tag2: string;
  isRevoked: boolean;
  endpoint?: string;
  feedbackURI?: string;
  feedbackHash?: `0x${string}`;
};

export type AgentFeedbackOverview = {
  totalScore: number;
  totalCount: number;
  feedbacks: AgentFeedbackView[];
};

type PreparedFeedbackResult = PrepareFeedbackResult | { error: string };

function normalizeScaledValue(value: bigint, decimals: number): number {
  return Number(value) / Math.pow(10, decimals);
}

async function fetchFeedbackOverview(
  cfg: ReturnType<typeof getServerConfigForChain>,
  erc8004AgentId: string | null,
): Promise<AgentFeedbackOverview> {
  if (!erc8004AgentId || !cfg.reputationRegistryAddress || !cfg.rpcUrl) {
    return { totalScore: 0, totalCount: 0, feedbacks: [] };
  }

  try {
    const publicClient = createPublicClient({
      chain: cfg.chain,
      transport: http(cfg.rpcUrl),
    });
    const agentId = BigInt(erc8004AgentId);
    const clients = (await publicClient.readContract({
      address: cfg.reputationRegistryAddress,
      abi: REPUTATION_REGISTRY_ABI,
      functionName: "getClients",
      args: [agentId],
    })) as Address[];

    if (clients.length === 0) {
      return {
        totalScore: 0,
        totalCount: 0,
        feedbacks: [],
      };
    }

    const [summary, feedbackRows] = (await Promise.all([
      publicClient.readContract({
        address: cfg.reputationRegistryAddress,
        abi: REPUTATION_REGISTRY_ABI,
        functionName: "getSummary",
        args: [agentId, clients, "", ""],
      }),
      publicClient.readContract({
        address: cfg.reputationRegistryAddress,
        abi: REPUTATION_REGISTRY_ABI,
        functionName: "readAllFeedback",
        args: [agentId, clients, "", "", true],
      }),
    ])) as [
      [bigint, bigint, number],
      [Address[], bigint[], bigint[], number[], string[], string[], boolean[]],
    ];
    const [
      feedbackClients,
      feedbackIndexes,
      values,
      valueDecimals,
      tag1s,
      tag2s,
      revokedStatuses,
    ] = feedbackRows;
    const summaryResult = {
      count: summary[0],
      summaryValue: summary[1],
      summaryValueDecimals: summary[2],
    };

    const feedbacks = feedbackClients.map((client, index) => ({
      client,
      feedbackIndex: Number(feedbackIndexes[index] ?? 0n),
      value: (values[index] ?? 0n).toString(),
      valueDecimals: valueDecimals[index] ?? 0,
      normalizedValue: normalizeScaledValue(
        values[index] ?? 0n,
        valueDecimals[index] ?? 0,
      ),
      tag1: tag1s[index] ?? "",
      tag2: tag2s[index] ?? "",
      isRevoked: revokedStatuses[index] ?? false,
    }));

    return {
      totalScore: normalizeScaledValue(
        summaryResult.summaryValue,
        summaryResult.summaryValueDecimals,
      ),
      totalCount: Number(summaryResult.count),
      feedbacks,
    };
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
