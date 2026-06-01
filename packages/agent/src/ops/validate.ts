/**
 * prepareValidation — builds parameters for submitting a validation request.
 */

import { keccak256, toHex } from "viem";
import type {
  AgentConfig,
  PrepareValidationParams,
  PrepareValidationResult,
} from "../core/types.js";

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
