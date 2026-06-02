"use server";

import type { Address } from "viem";
import { getCachedAgents } from "@/lib/agent-cache";
import { syncEvents } from "@/lib/agent-indexer";
import { getServerConfigForChain } from "@/lib/config";
import { getActiveChainId } from "@/lib/active-chain";
import { AgentRegistry } from "@tee-agent/agent/registry";
import { REPUTATION_REGISTRY_ABI } from "@tee-agent/agent/abis";
import { createPublicClient, http } from "viem";
import { prepareFeedback as sdkPrepareFeedback } from "@tee-agent/agent/feedback";
import { prepareValidation as sdkPrepareValidation } from "@tee-agent/agent/validate";
import type {
  RegisteredAgent,
  ResolvedAgentProofData,
  PrepareFeedbackParams,
  PrepareFeedbackResult,
  PrepareValidationParams,
  PrepareValidationResult,
} from "@tee-agent/agent/types";
import {
  getOracleRunHistory,
  fetchPendingValidationsForAgent,
} from "@/lib/actions/agents";

// ─── Dashboard-local types ────────────────────────────────────────────────────

export type AgentFeedbackView = {
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

export type AgentFeedbackOverview = {
  totalScore: number;
  totalCount: number;
  feedbacks: AgentFeedbackView[];
};

export type TransferRecipientAgent = {
  agentId: string;
  name: string;
  owner: Address;
  teeOracleUrl?: string;
};

type PreparedFeedbackResult = PrepareFeedbackResult | { error: string };
type PreparedValidationResult = PrepareValidationResult | { error: string };

function teeOracleUrlFromServices(
  services: readonly { name: string; endpoint: string }[] | undefined,
): string | undefined {
  return services?.find((service) => service.name === "teeOracle")?.endpoint;
}

function normalizeScaledValue(value: bigint, decimals: number): number {
  return Number(value) / Math.pow(10, decimals);
}

async function fetchFeedbackOverview(
  cfg: ReturnType<typeof getServerConfigForChain>,
  erc8004AgentId: string | null,
): Promise<AgentFeedbackOverview> {
  if (!erc8004AgentId || !cfg.reputationRegistryAddress || !cfg.rpcUrl) {
    return { totalScore: 0, totalCount: 0, feedbacks: [] };
  }

  try {
    const publicClient = createPublicClient({
      chain: cfg.chain,
      transport: http(cfg.rpcUrl),
    });
    const agentId = BigInt(erc8004AgentId);
    const clients = (await publicClient.readContract({
      address: cfg.reputationRegistryAddress,
      abi: REPUTATION_REGISTRY_ABI,
      functionName: "getClients",
      args: [agentId],
    })) as Address[];

    if (clients.length === 0) {
      return {
        totalScore: 0,
        totalCount: 0,
        feedbacks: [],
      };
    }

    const [summary, feedbackRows] = (await Promise.all([
      publicClient.readContract({
        address: cfg.reputationRegistryAddress,
        abi: REPUTATION_REGISTRY_ABI,
        functionName: "getSummary",
        args: [agentId, clients, "", ""],
      }),
      publicClient.readContract({
        address: cfg.reputationRegistryAddress,
        abi: REPUTATION_REGISTRY_ABI,
        functionName: "readAllFeedback",
        args: [agentId, clients, "", "", true],
      }),
    ])) as [
      [bigint, bigint, number],
      [
        Address[],
        bigint[],
        bigint[],
        number[],
        string[],
        string[],
        boolean[],
      ],
    ];
    const [
      feedbackClients,
      feedbackIndexes,
      values,
      valueDecimals,
      tag1s,
      tag2s,
      revokedStatuses,
    ] = feedbackRows;
    const summaryResult = {
      count: summary[0],
      summaryValue: summary[1],
      summaryValueDecimals: summary[2],
    };

    const feedbacks = feedbackClients.map((client, index) => ({
      client,
      feedbackIndex: Number(feedbackIndexes[index] ?? 0n),
      value: (values[index] ?? 0n).toString(),
      valueDecimals: valueDecimals[index] ?? 0,
      normalizedValue: normalizeScaledValue(
        values[index] ?? 0n,
        valueDecimals[index] ?? 0,
      ),
      tag1: tag1s[index] ?? "",
      tag2: tag2s[index] ?? "",
      isRevoked: revokedStatuses[index] ?? false,
    }));

    return {
      totalScore: normalizeScaledValue(
        summaryResult.summaryValue,
        summaryResult.summaryValueDecimals,
      ),
      totalCount: Number(summaryResult.count),
      feedbacks,
    };
  } catch (err) {
    console.error("[registry] fetchFeedbackOverview failed:", err);
    return { totalScore: 0, totalCount: 0, feedbacks: [] };
  }
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function getRegisteredAgents(
  chainId?: number,
): Promise<RegisteredAgent[]> {
  const cid = chainId ?? (await getActiveChainId());
  const cfg = getServerConfigForChain(cid);
  if (!cfg.registryAddress) return [];

  try {
    await syncEvents(cid);
  } catch (err) {
    console.error("[registry] syncEvents failed:", err);
  }

  try {
    const cached = await getCachedAgents(cid, cfg.registryAddress);
    return (cached?.agents ?? []).slice().reverse();
  } catch (err) {
    console.error("[registry] getRegisteredAgents failed:", err);
    return [];
  }
}

export async function getAgentPageData(id: string, chainId?: number) {
  const cid = chainId ?? (await getActiveChainId());
  const cfg = getServerConfigForChain(cid);
  if (!cfg.rpcUrl || !cfg.registryAddress)
    throw new Error("Registry not configured");
  const agentId = BigInt(id);
  const registry = new AgentRegistry({
    address: cfg.registryAddress,
    publicClient: createPublicClient({
      chain: cfg.chain,
      transport: http(cfg.rpcUrl),
    }),
  });
  const [agent, intelligentDataInfo] = await Promise.all([
    registry.resolve(agentId).catch(() => null),
    registry.resolveProofData(agentId).catch(
      () =>
        ({
          verifierAddress: undefined,
          erc8004AgentId: undefined,
          intelligentData: [],
        }) as ResolvedAgentProofData,
    ),
  ]);

  const erc8004Id =
    intelligentDataInfo.erc8004AgentId &&
    intelligentDataInfo.erc8004AgentId !== "0"
      ? intelligentDataInfo.erc8004AgentId
      : null;

  const [
    oracleRunsResult,
    pendingValidations,
    registeredAgents,
    feedbackOverview,
  ] = await Promise.all([
    getOracleRunHistory(id, cid),
    erc8004Id
      ? fetchPendingValidationsForAgent(erc8004Id, cid)
      : Promise.resolve([]),
    getRegisteredAgents(cid),
    fetchFeedbackOverview(cfg, erc8004Id),
  ]);
  const recipientAgents: TransferRecipientAgent[] = registeredAgents
    .filter((item) => item.agentId.toString() !== id)
    .map((item) => {
      const teeOracleUrl = teeOracleUrlFromServices(item.metadata.services);
      return {
        agentId: item.agentId.toString(),
        name: item.metadata.name,
        owner: item.owner,
        ...(teeOracleUrl ? { teeOracleUrl } : {}),
      };
    });

  return {
    agent,
    intelligentDataInfo,
    feedbackOverview,
    oracleRunsResult,
    pendingValidations,
    recipientAgents,
  };
}

// ─── Write ────────────────────────────────────────────────────────────────────

export async function prepareFeedback(
  params: PrepareFeedbackParams,
): Promise<PreparedFeedbackResult> {
  if (!params.agentId) return { error: "Agent ID is required." };
  if (params.value === undefined || params.value === null)
    return { error: "Feedback value is required." };
  if (isNaN(params.value) || params.value < -1 || params.value > 1)
    return { error: "Feedback value must be between -1 and 1." };

  try {
    return await sdkPrepareFeedback(
      getServerConfigForChain(await getActiveChainId()),
      params,
    );
  } catch (err) {
    return {
      error:
        err instanceof Error ? err.message : "Feedback preparation failed.",
    };
  }
}

export async function prepareValidation(
  params: PrepareValidationParams,
): Promise<PreparedValidationResult> {
  if (!params.agentId) return { error: "Agent ID is required." };
  if (!params.validatorAddress)
    return { error: "Validator address is required." };

  try {
    return sdkPrepareValidation(
      getServerConfigForChain(await getActiveChainId()),
      params,
    );
  } catch (err) {
    return {
      error:
        err instanceof Error ? err.message : "Validation preparation failed.",
    };
  }
}
