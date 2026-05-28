// ABI re-exports for @tee-agent/agent.
// Source of truth: ./abis/*.json — regenerate with: node contracts/scripts/gen-abis.mjs
// ReputationRegistry.json is the official ERC-8004 ABI and must be updated manually.

import { parseAbiItem } from "viem";
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

// ─── Pre-parsed event fragments (viem getLogs) ────────────────────────────────

export const REGISTERED_EVENT = parseAbiItem(
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
);

export const VALIDATION_REQUEST_EVENT = parseAbiItem(
  "event ValidationRequest(address indexed validatorAddress, uint256 indexed agentId, string requestURI, bytes32 indexed requestHash)",
);

export const VALIDATION_RESPONSE_EVENT = parseAbiItem(
  "event ValidationResponse(address indexed validatorAddress, uint256 indexed agentId, bytes32 indexed requestHash, uint8 response, string responseURI, bytes32 responseHash, string tag)",
);

// ─── Typed ABI subsets (viem readContract) ────────────────────────────────────

/** getValidationStatus — typed for precise viem return-type inference. */
export const VALIDATION_STATUS_ABI = [
  {
    name: "getValidationStatus",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "requestHash", type: "bytes32" }],
    outputs: [
      { name: "validatorAddress", type: "address" },
      { name: "agentId", type: "uint256" },
      { name: "response", type: "uint8" },
      { name: "responseHash", type: "bytes32" },
      { name: "tag", type: "string" },
      { name: "lastUpdate", type: "uint256" },
    ],
  },
] as const;

/** Minimal ERC-721 read ABI (ownerOf + tokenURI). */
export const ERC721_ABI = [
  {
    name: "ownerOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "tokenURI",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "string" }],
  },
] as const;

/**
 * ERC-8004 Identity Registry — minimal ABI covering the functions called by
 * the dashboard (ownerOf, tokenURI, setAgentURI).
 */
export const IDENTITY_REGISTRY_ABI = [
  {
    name: "ownerOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "tokenURI",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "string" }],
  },
  {
    name: "setAgentURI",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "newURI", type: "string" },
    ],
    outputs: [],
  },
] as const;
