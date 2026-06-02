/**
 * prepareFeedback — builds parameters for submitting ERC-8004 reputation feedback.
 */

import type {
  AgentConfig,
  PrepareFeedbackParams,
  PrepareFeedbackResult,
} from "../types.js";

function toScaledFeedbackValue(valueNum: number, decimals: number): bigint {
  return BigInt(Math.round(valueNum * Math.pow(10, decimals)));
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
