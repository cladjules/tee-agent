/**
 * prepareFeedback — builds parameters for submitting ERC-8004 reputation feedback.
 */

import type {
  AgentConfig,
  PrepareFeedbackParams,
  PrepareFeedbackResult,
} from "../types.js";
import type { Address } from "viem";
import { ReputationRegistry } from "../registry/reputation.js";

export type FeedbackView = {
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

export type FeedbackOverview = {
  totalScore: number;
  totalCount: number;
  feedbacks: FeedbackView[];
};

function toScaledFeedbackValue(valueNum: number, decimals: number): bigint {
  return BigInt(Math.round(valueNum * Math.pow(10, decimals)));
}

function normalizeScaledValue(value: bigint, decimals: number): number {
  return Number(value) / Math.pow(10, decimals);
}

async function parseFeedbackData(
  feedbackJson?: string,
  feedbackFile?: File | null,
): Promise<unknown> {
  if (feedbackFile instanceof File && feedbackFile.size > 0) {
    const text = await feedbackFile.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error("Feedback file must contain valid JSON.");
    }
  }
  if (feedbackJson) {
    try {
      return JSON.parse(feedbackJson);
    } catch {
      throw new Error("Feedback JSON is invalid.");
    }
  }
  throw new Error("Provide feedback JSON text or upload a .json file.");
}

export async function prepareFeedback(
  config: AgentConfig,
  params: PrepareFeedbackParams,
): Promise<PrepareFeedbackResult> {
  const { agentId, value, tag1, tag2, feedbackJson, feedbackFile } = params;

  if (!agentId) throw new Error("Agent ID is required.");
  if (value === undefined || value === null)
    throw new Error("Feedback value is required.");
  if (isNaN(value) || value < -1 || value > 1) {
    throw new Error("Feedback value must be between -1 and 1.");
  }

  if (!config.reputationRegistryAddress) {
    throw new Error("reputationRegistryAddress is not configured.");
  }

  const feedbackData = await parseFeedbackData(feedbackJson, feedbackFile);

  const payload = {
    agentId,
    value,
    tags: [tag1, tag2].filter(Boolean),
    createdAt: new Date().toISOString(),
    feedback: feedbackData,
  };

  const feedbackURI = `data:application/json;base64,${Buffer.from(
    JSON.stringify(payload),
  ).toString("base64")}`;

  const decimals = 4;
  const scaledValue = toScaledFeedbackValue(value, decimals);

  return {
    contractAddress: config.reputationRegistryAddress,
    agentId,
    value: scaledValue.toString(),
    valueDecimals: decimals,
    tag1: tag1 ?? "",
    tag2: tag2 ?? "",
    feedbackURI,
  };
}

export async function fetchFeedbackOverview(
  config: AgentConfig,
  erc8004AgentId: string | bigint | null,
): Promise<FeedbackOverview> {
  if (!erc8004AgentId || !config.reputationRegistryAddress || !config.rpcUrl) {
    return { totalScore: 0, totalCount: 0, feedbacks: [] };
  }

  const registry = new ReputationRegistry({
    chainId: config.chain.id,
    rpcUrl: config.rpcUrl,
  });
  const agentId =
    typeof erc8004AgentId === "bigint"
      ? erc8004AgentId
      : BigInt(erc8004AgentId);
  const clients = await registry.getClients(agentId);

  if (clients.length === 0) {
    return { totalScore: 0, totalCount: 0, feedbacks: [] };
  }

  const [summary, feedbackRows] = await Promise.all([
    registry.getSummary(agentId, clients, "", ""),
    registry.readAllFeedback(agentId, clients, "", "", true),
  ]);

  const feedbacks = feedbackRows.clients.map((client, index) => {
    const value = feedbackRows.values[index] ?? 0n;
    const valueDecimals = feedbackRows.valueDecimals[index] ?? 0;
    return {
      client,
      feedbackIndex: Number(feedbackRows.feedbackIndexes[index] ?? 0n),
      value: value.toString(),
      valueDecimals,
      normalizedValue: normalizeScaledValue(value, valueDecimals),
      tag1: feedbackRows.tag1s[index] ?? "",
      tag2: feedbackRows.tag2s[index] ?? "",
      isRevoked: feedbackRows.revokedStatuses[index] ?? false,
    };
  });

  return {
    totalScore: normalizeScaledValue(
      summary.summaryValue,
      summary.summaryValueDecimals,
    ),
    totalCount: Number(summary.count),
    feedbacks,
  };
}
