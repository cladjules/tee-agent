"use server";

import type { Address } from "viem";
import { cfg } from "@/lib/config";
import { getCachedAgents } from "@/lib/agent-cache";
import { syncEvents } from "@/lib/agent-indexer";
import { AgentRegistry } from "@tee-agent/agent/registry";
import { createPublicClient, http } from "viem";
import { prepareFeedback as sdkPrepareFeedback } from "@tee-agent/agent/feedback";
import { prepareValidation as sdkPrepareValidation } from "@tee-agent/agent/validate";
import type {
  RegisteredAgent,
  ResolvedAgentProofData,
  PrepareFeedbackParams,
  PrepareFeedbackResult,
  PrepareValidationParams,
  PrepareValidationResult,
} from "@tee-agent/agent/types";
import {
  getOracleRunHistory,
  fetchPendingValidationsForAgent,
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
type PreparedValidationResult = PrepareValidationResult | { error: string };

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function getRegisteredAgents(): Promise<RegisteredAgent[]> {
  if (!cfg.registryAddress) return [];

  try {
    await syncEvents();
  } catch (err) {
    console.error("[registry] syncEvents failed:", err);
  }

  try {
    const cached = await getCachedAgents();
    return (cached?.agents ?? []).slice().reverse();
  } catch (err) {
    console.error("[registry] getRegisteredAgents failed:", err);
    return [];
  }
}

export async function getAgentPageData(id: string) {
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

  const [oracleRunsResult, pendingValidations] = await Promise.all([
    getOracleRunHistory(id),
    erc8004Id
      ? fetchPendingValidationsForAgent(erc8004Id)
      : Promise.resolve([]),
  ]);
  return {
    agent,
    intelligentDataInfo,
    feedbackOverview: {
      totalScore: 0,
      totalCount: 0,
      feedbacks: [],
    } as AgentFeedbackOverview,
    oracleRunsResult,
    pendingValidations,
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
    return await sdkPrepareFeedback(cfg, params);
  } catch (err) {
    return {
      error:
        err instanceof Error ? err.message : "Feedback preparation failed.",
    };
  }
}

export async function prepareValidation(
  params: PrepareValidationParams,
): Promise<PreparedValidationResult> {
  if (!params.agentId) return { error: "Agent ID is required." };
  if (!params.validatorAddress)
    return { error: "Validator address is required." };

  try {
    return sdkPrepareValidation(cfg, params);
  } catch (err) {
    return {
      error:
        err instanceof Error ? err.message : "Validation preparation failed.",
    };
  }
}
