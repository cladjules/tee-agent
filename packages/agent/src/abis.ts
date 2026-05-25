// ABI re-exports for @open-agents-toolkit/agent.
// Source of truth: ./abis/*.json — regenerate with: node contracts/scripts/gen-abis.mjs
// ReputationRegistry.json is the official ERC-8004 ABI and must be updated manually.

import AgentRegistryAbi from "./abis/AgentRegistry.json" with { type: "json" };
import TEEVerifierAbi from "./abis/TEEVerifier.json" with { type: "json" };
import VerifierAbi from "./abis/Verifier.json" with { type: "json" };
import ReputationRegistryAbi from "./abis/ReputationRegistry.json" with { type: "json" };
import ValidationRegistryAbi from "./abis/ValidationRegistry.json" with { type: "json" };

export const AGENT_REGISTRY_ABI = AgentRegistryAbi;
export const AGENT_NFT_ABI = AGENT_REGISTRY_ABI;
export const TEE_VERIFIER_ABI = TEEVerifierAbi;
export const VERIFIER_ABI = VerifierAbi;
export const REPUTATION_REGISTRY_ABI = ReputationRegistryAbi;
export const VALIDATION_REGISTRY_ABI = ValidationRegistryAbi;
