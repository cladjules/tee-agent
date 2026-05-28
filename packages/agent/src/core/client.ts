/**
 * Internal helper — creates a viem PublicClient from an AgentConfig.
 * Not exported from the public surface; only used internally by operation files.
 */
import { createPublicClient, http } from "viem";
import type { AgentConfig } from "./types.js";

export function makePublicClient(config: AgentConfig) {
  return createPublicClient({
    chain: config.chain,
    transport: http(config.rpcUrl),
  });
}
