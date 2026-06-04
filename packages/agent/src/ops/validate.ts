/**
 * prepareValidation — builds parameters for submitting a validation request.
 */

import { keccak256, toBytes } from "viem";
import type {
  AgentConfig,
  PrepareValidationParams,
  PrepareValidationResult,
} from "../types.js";

export function prepareValidation(
  config: AgentConfig,
  params: PrepareValidationParams,
): PrepareValidationResult {
  const { agentId, validatorAddress, requestURI = "" } = params;

  if (!agentId) throw new Error("Agent ID is required.");
  if (!validatorAddress) throw new Error("Validator address is required.");
  if (!config.validationRegistryAddress) {
    throw new Error("validationRegistryAddress is not configured.");
  }

  const requestHash = keccak256(toBytes(requestURI));

  return {
    contractAddress: config.validationRegistryAddress,
    agentId,
    validatorAddress,
    requestURI,
    requestHash,
  };
}
