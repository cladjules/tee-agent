"use server";

import type { Address } from "viem";
import { cfg } from "@/lib/config";
import {
  getCachedAgents,
  getCachedProofs,
  setCachedProofs,
} from "@/lib/agent-cache";
import { syncEvents } from "@/lib/agent-indexer";
import { makeAgentRegistryClient, toAgentConfig } from "@/lib/registry-client";
import { resolveAgentProofData as sdkResolveAgentProofData } from "@tee-agent/agent/resolve";
import {
  prepareFeedback as sdkPrepareFeedback,
  prepareValidation as sdkPrepareValidation,
} from "@tee-agent/agent/oracle";
import type {
  RegisteredAgent,
  ResolvedAgentProofData,
  PrepareFeedbackResult,
  PrepareValidationResult,
} from "@tee-agent/agent/types";

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

type PreparedFeedbackResult = PrepareFeedbackResult;
type PreparedValidationResult = PrepareValidationResult;

function getFormValue(formData: FormData, key: string) {
  return (formData.get(key) as string | null)?.trim() ?? "";
}

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

export async function getAgent(id: bigint): Promise<RegisteredAgent | null> {
  if (!cfg.registryAddress) return null;

  try {
    const registry = makeAgentRegistryClient();
    if (!registry) return null;
    return await registry.resolve(id);
  } catch {
    return null;
  }
}

export async function getAgentIntelligentData(
  agentId: bigint,
): Promise<ResolvedAgentProofData> {
  const cached = await getCachedProofs(agentId);
  if (cached) return cached;

  const result = await sdkResolveAgentProofData(toAgentConfig(), agentId);

  setCachedProofs(agentId, result).catch((err) =>
    console.error("[registry] proofs cache write failed:", err),
  );

  return result;
}

export async function getAgentFeedbackOverview(
  _agentId: bigint,
): Promise<AgentFeedbackOverview> {
  return { totalScore: 0, totalCount: 0, feedbacks: [] };
}

// ─── Write ────────────────────────────────────────────────────────────────────

export async function prepareFeedback(
  formData: FormData,
): Promise<PreparedFeedbackResult> {
  const agentId = getFormValue(formData, "agentId");
  const valueStr = getFormValue(formData, "value");
  const tag1 = getFormValue(formData, "tag1");
  const tag2 = getFormValue(formData, "tag2");
  const feedbackJson = getFormValue(formData, "feedbackJson");
  const feedbackFile = formData.get("feedbackFile");

  if (!agentId) return { error: "Agent ID is required." };
  if (!valueStr) return { error: "Feedback value is required." };

  const valueNum = parseFloat(valueStr);
  if (isNaN(valueNum) || valueNum < -1 || valueNum > 1) {
    return { error: "Feedback value must be between -1 and 1." };
  }

  return sdkPrepareFeedback(toAgentConfig(), {
    agentId,
    value: valueNum,
    tag1,
    tag2,
    feedbackJson: feedbackJson || undefined,
    feedbackFile: feedbackFile instanceof File ? feedbackFile : null,
  });
}

export async function prepareValidation(
  formData: FormData,
): Promise<PreparedValidationResult> {
  const agentId = getFormValue(formData, "agentId");
  const validatorAddress = getFormValue(formData, "validatorAddress") as
    | `0x${string}`
    | "";
  const requestURI = getFormValue(formData, "requestURI");

  if (!agentId) return { error: "Agent ID is required." };
  if (!validatorAddress) return { error: "Validator address is required." };

  return sdkPrepareValidation(toAgentConfig(), {
    agentId,
    validatorAddress,
    requestURI,
  });
}
