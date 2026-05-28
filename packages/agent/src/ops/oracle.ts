/**
 * prepareFeedback — builds parameters for submitting ERC-8004 reputation feedback.
 * prepareValidation — builds parameters for submitting a validation request.
 */

import { keccak256, toHex } from "viem";
import type {
  AgentConfig,
  PrepareFeedbackParams,
  PrepareFeedbackResult,
  PrepareValidationParams,
  PrepareValidationResult,
} from "../core/types.js";

function toScaledFeedbackValue(valueNum: number, decimals: number): bigint {
  return BigInt(Math.round(valueNum * Math.pow(10, decimals)));
}

async function parseFeedbackData(
  feedbackJson?: string,
  feedbackFile?: File | null,
): Promise<{ data?: unknown; error?: string }> {
  if (feedbackFile instanceof File && feedbackFile.size > 0) {
    const text = await feedbackFile.text();
    try {
      return { data: JSON.parse(text) };
    } catch {
      return { error: "Feedback file must contain valid JSON." };
    }
  }
  if (feedbackJson) {
    try {
      return { data: JSON.parse(feedbackJson) };
    } catch {
      return { error: "Feedback JSON is invalid." };
    }
  }
  return { error: "Provide feedback JSON text or upload a .json file." };
}

export async function prepareFeedback(
  config: AgentConfig,
  params: PrepareFeedbackParams,
): Promise<PrepareFeedbackResult> {
  const { agentId, value, tag1, tag2, feedbackJson, feedbackFile } = params;

  if (!agentId) return { error: "Agent ID is required." };
  if (value === undefined || value === null)
    return { error: "Feedback value is required." };
  if (isNaN(value) || value < -1 || value > 1) {
    return { error: "Feedback value must be between -1 and 1." };
  }

  if (!config.reputationRegistryAddress) {
    return { error: "reputationRegistryAddress is not configured." };
  }

  const parsedFeedback = await parseFeedbackData(feedbackJson, feedbackFile);
  if (parsedFeedback.error) return { error: parsedFeedback.error };

  const payload = {
    agentId,
    value,
    tags: [tag1, tag2].filter(Boolean),
    createdAt: new Date().toISOString(),
    feedback: parsedFeedback.data,
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
    tag1,
    tag2,
    feedbackURI,
  };
}

export function prepareValidation(
  config: AgentConfig,
  params: PrepareValidationParams,
): PrepareValidationResult {
  const { agentId, validatorAddress, requestURI = "" } = params;

  if (!agentId) return { error: "Agent ID is required." };
  if (!validatorAddress) return { error: "Validator address is required." };
  if (!config.validationRegistryAddress) {
    return { error: "validationRegistryAddress is not configured." };
  }

  const requestHash = keccak256(
    toHex(`${agentId}:${validatorAddress}:${requestURI}:${Date.now()}`),
  );

  return {
    contractAddress: config.validationRegistryAddress,
    agentId,
    validatorAddress,
    requestURI,
    requestHash,
  };
}
