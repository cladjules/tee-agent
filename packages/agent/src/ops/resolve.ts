/**
 * Registry resolution — reads agent identity and proof data from chain.
 *
 * Delegates to AgentRegistry class methods; standalone consumers can also
 * instantiate AgentRegistry directly.
 */

import { makePublicClient } from "../core/client.js";
import { AgentRegistry } from "../core/registry.js";
import type {
  AgentConfig,
  RegisteredAgent,
  ResolvedAgentProofData,
} from "../core/types.js";

function makeRegistry(config: AgentConfig): AgentRegistry {
  return new AgentRegistry({
    agentRegistryAddress: config.registryAddress,
    publicClient: makePublicClient(config) as any,
  });
}

export async function resolveAgent(
  config: AgentConfig,
  agentId: bigint,
): Promise<RegisteredAgent | null> {
  try {
    return await makeRegistry(config).resolve(agentId);
  } catch {
    return null;
  }
}

export async function resolveAgentProofData(
  config: AgentConfig,
  agentId: bigint,
): Promise<ResolvedAgentProofData> {
  return makeRegistry(config).resolveProofData(agentId);
}
