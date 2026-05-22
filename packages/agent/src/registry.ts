/**
 * AgentRegistry — Read-only TypeScript client for the on-chain registry.
 *
 * Provides agent identity resolution. Reputation and validation registry methods
 * are stubbed (those contracts no longer exist in this deployment).
 * Frontend owns all write operations via direct viem contract calls.
 */

import { AgentIdentity, AgentRegistrationFile } from "./types.js";
import { Address } from "viem";
import { PublicClient } from "viem";
import { AGENT_REGISTRY_ABI } from "./abis.js";
import { readJsonFromUri } from "./encryption.js";
import { readZeroGJSON } from "./zero-g.js";

const createDebug =
  (namespace: string) =>
  (...args: unknown[]) =>
    console.log(`[${namespace}]`, ...args);

const log = createDebug("oat:registry");
const logRead = createDebug("oat:registry:read");

export interface AgentRegistryConfig {
  agentRegistryAddress: Address;
  publicClient: PublicClient;
}

export class AgentRegistry {
  private readonly _cfg: AgentRegistryConfig;

  constructor(config: AgentRegistryConfig) {
    this._cfg = config;
    log("initialised agentRegistry=%s", config.agentRegistryAddress);
  }

  // ─── Read Operations ──────────────────────────────────────────────────────

  /**
   * Resolve an agent's on-chain identity and fetch metadata from its URI.
   */
  async resolve(
    agentId: bigint,
  ): Promise<AgentIdentity & { metadata: AgentRegistrationFile }> {
    logRead("resolve agentId=%s", agentId.toString());
    const [owner, metadataUri] = (await Promise.all([
      this._cfg.publicClient.readContract({
        address: this._cfg.agentRegistryAddress,
        abi: AGENT_REGISTRY_ABI,
        functionName: "ownerOf",
        args: [agentId],
      }),
      this._cfg.publicClient.readContract({
        address: this._cfg.agentRegistryAddress,
        abi: AGENT_REGISTRY_ABI,
        functionName: "getMetadataUri",
        args: [agentId],
      }),
    ])) as [Address, string];

    const metadata = metadataUri.startsWith("zerog://")
      ? await readZeroGJSON<AgentRegistrationFile>(metadataUri as string)
      : await readJsonFromUri<AgentRegistrationFile>(metadataUri as string);

    logRead(
      "resolved agentId=%s owner=%s name=%s",
      agentId.toString(),
      owner,
      metadata.name,
    );

    return {
      agentId,
      owner: owner as Address,
      agentWallet: owner as Address,
      metadataUri: metadataUri as string,
      registeredAt: 0,
      metadata,
    };
  }
}
