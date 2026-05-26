"use server";

import type {
  AgentIdentity,
  AgentRegistrationFile,
} from "@open-agents-toolkit/agent/types";
import { AgentRegistry } from "@open-agents-toolkit/agent/registry";
import { readJsonFromUri } from "@open-agents-toolkit/agent/encryption";
import { AGENT_REGISTRY_ABI } from "@open-agents-toolkit/agent/abis";
import type { Address } from "viem";
import { createPublicClient, http, keccak256, parseAbiItem, toHex } from "viem";
import { cfg } from "@/lib/config";

// ─── Types ────────────────────────────────────────────────────────────────────

export type RegisteredAgent = AgentIdentity & {
  metadata: AgentRegistrationFile;
};

export type AgentIntelligentDataEntry = {
  name?: string;
  dataDescription: string;
  dataHash: `0x${string}`;
};

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

type PublicIntelligentDataItem = {
  name?: string;
  uri?: string;
  hash?: `0x${string}`;
};

type PublicTokenMetadata = {
  intelligentData?: PublicIntelligentDataItem[];
};

type AgentIntelligentDataRecord = {
  dataDescription: string;
  dataHash: `0x${string}`;
};

type FeedbackPayload = {
  agentId: string;
  value: number;
  tags: string[];
  createdAt: string;
  feedback: unknown;
};

function isReadableUri(value: string) {
  return (
    value.startsWith("data:") ||
    value.startsWith("http://") ||
    value.startsWith("https://")
  );
}

function makePublicClient() {
  if (!cfg.rpcUrl) return null;
  return createPublicClient({
    chain: cfg.chain as any,
    transport: http(cfg.rpcUrl),
  });
}

function makeAgentRegistryClient() {
  if (!cfg.registryAddress) return null;
  const publicClient = makePublicClient();
  if (!publicClient) return null;

  return new AgentRegistry({
    agentRegistryAddress: cfg.registryAddress,
    publicClient: publicClient as any,
  });
}

function toDataDetailsByHash(items: PublicIntelligentDataItem[]) {
  const byHash = new Map<string, PublicIntelligentDataItem>();
  for (const item of items) {
    if (item?.hash) {
      byHash.set(item.hash.toLowerCase(), item);
    }
  }
  return byHash;
}

function getFormValue(formData: FormData, key: string) {
  return (formData.get(key) as string | null)?.trim() ?? "";
}

function parseJsonString(
  value: string,
  invalidMessage: string,
): { data?: unknown; error?: string } {
  try {
    return { data: JSON.parse(value) };
  } catch {
    return { error: invalidMessage };
  }
}

async function parseFeedbackInput(
  feedbackJson: string,
  feedbackFile: FormDataEntryValue | null,
): Promise<{ data?: unknown; error?: string }> {
  if (feedbackFile instanceof File && feedbackFile.size > 0) {
    const fileText = await feedbackFile.text();
    return parseJsonString(fileText, "Feedback file must contain valid JSON.");
  }

  if (feedbackJson) {
    return parseJsonString(feedbackJson, "Feedback JSON is invalid.");
  }

  return { error: "Provide feedback JSON text or upload a .json file." };
}

async function uploadFeedbackPayload(
  payload: FeedbackPayload,
): Promise<{ uri?: string; error?: string }> {
  try {
    const uri = `data:application/json;base64,${Buffer.from(JSON.stringify(payload)).toString("base64")}`;
    return { uri };
  } catch (err) {
    return {
      error:
        err instanceof Error
          ? err.message
          : "Failed to encode feedback payload.",
    };
  }
}

function toScaledFeedbackValue(valueNum: number, decimals: number) {
  return BigInt(Math.round(valueNum * Math.pow(10, decimals)));
}

async function readPublicMetadataIntelligentDataMap(agentId: bigint) {
  if (!cfg.registryAddress) {
    return new Map<string, PublicIntelligentDataItem>();
  }

  try {
    const publicClient = makePublicClient();
    if (!publicClient) {
      return new Map<string, PublicIntelligentDataItem>();
    }

    const tokenUri = (await publicClient.readContract({
      address: cfg.registryAddress,
      abi: AGENT_REGISTRY_ABI,
      functionName: "tokenURI",
      args: [agentId],
    })) as string;

    const metadata = await readJsonFromUri<PublicTokenMetadata>(tokenUri);
    return toDataDetailsByHash(metadata.intelligentData ?? []);
  } catch {
    return new Map<string, PublicIntelligentDataItem>();
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

type PreparedFeedbackResult = {
  contractAddress?: `0x${string}`;
  agentId?: string;
  value?: string;
  valueDecimals?: number;
  tag1?: string;
  tag2?: string;
  feedbackURI?: string;
  error?: string;
};

type PreparedValidationResult = {
  contractAddress?: `0x${string}`;
  agentId?: string;
  validatorAddress?: `0x${string}`;
  requestURI?: string;
  requestHash?: `0x${string}`;
  error?: string;
};

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function getRegisteredAgents(): Promise<RegisteredAgent[]> {
  if (!cfg.registryAddress) return [];

  try {
    const publicClient = makePublicClient();
    const registry = makeAgentRegistryClient();
    if (!publicClient || !registry) return [];

    const registeredEvent = parseAbiItem(
      "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
    );

    // Paginate in chunks of 2000 blocks (Base Sepolia public RPC limit).
    const PAGE = 2000n;
    const latestBlock = await publicClient.getBlockNumber();
    const allLogs = [];
    for (let from = cfg.registryFromBlock; from <= latestBlock; from += PAGE) {
      const to =
        from + PAGE - 1n < latestBlock ? from + PAGE - 1n : latestBlock;
      const chunk = await publicClient.getLogs({
        address: cfg.registryAddress,
        event: registeredEvent,
        fromBlock: from,
        toBlock: to,
      });
      allLogs.push(...chunk);
    }
    const logs = allLogs;

    const agents = await Promise.allSettled(
      logs.map((log) => registry.resolve(log.args.agentId as bigint)),
    );
    agents.forEach((r, i) => {
      if (r.status === "rejected")
        console.error(
          `[registry] resolve agentId=${logs[i]?.args.agentId} failed:`,
          r.reason,
        );
    });
    return agents
      .filter(
        (r): r is PromiseFulfilledResult<RegisteredAgent> =>
          r.status === "fulfilled",
      )
      .map((r) => r.value)
      .reverse();
  } catch (err) {
    console.error("[registry] getRegisteredAgents failed:", err);
    return [];
  }
}

export async function getAgent(id: bigint): Promise<RegisteredAgent | null> {
  if (!cfg.registryAddress) return null;

  try {
    const registry = makeAgentRegistryClient();
    if (!registry) return null;

    return await registry.resolve(id);
  } catch {
    return null;
  }
}

export async function getAgentIntelligentData(agentId: bigint): Promise<{
  verifierAddress?: `0x${string}`;
  intelligentData: AgentIntelligentDataEntry[];
}> {
  if (!cfg.registryAddress) {
    return { intelligentData: [] };
  }

  try {
    const publicClient = makePublicClient();
    if (!publicClient) {
      return { intelligentData: [] };
    }

    const [verifierAddress, rawData] = await Promise.all([
      publicClient.readContract({
        address: cfg.registryAddress,
        abi: AGENT_REGISTRY_ABI,
        functionName: "verifier",
        args: [],
      }),
      publicClient.readContract({
        address: cfg.registryAddress,
        abi: AGENT_REGISTRY_ABI,
        functionName: "intelligentDatasOf",
        args: [agentId],
      }),
    ]);

    const uriByHash = await readPublicMetadataIntelligentDataMap(agentId);
    const intelligentData = (
      rawData as ReadonlyArray<AgentIntelligentDataRecord>
    ).map((entry) => {
      const mapped = uriByHash.get(entry.dataHash.toLowerCase());
      const resolvedDescription =
        isReadableUri(entry.dataDescription) || !mapped?.uri
          ? entry.dataDescription
          : mapped.uri;

      return {
        name: mapped?.name,
        dataDescription: resolvedDescription,
        dataHash: entry.dataHash,
      };
    });

    return {
      verifierAddress: verifierAddress as `0x${string}`,
      intelligentData,
    };
  } catch {
    return { intelligentData: [] };
  }
}

export async function getAgentFeedbackOverview(
  _agentId: bigint,
): Promise<AgentFeedbackOverview> {
  return { totalScore: 0, totalCount: 0, feedbacks: [] };
}

// ─── Write ────────────────────────────────────────────────────────────────────

export async function prepareFeedback(
  formData: FormData,
): Promise<PreparedFeedbackResult> {
  const agentId = getFormValue(formData, "agentId");
  const valueStr = getFormValue(formData, "value");
  const tag1 = getFormValue(formData, "tag1");
  const tag2 = getFormValue(formData, "tag2");
  const feedbackJson = getFormValue(formData, "feedbackJson");
  const feedbackFile = formData.get("feedbackFile");

  if (!agentId) return { error: "Agent ID is required." };
  if (!valueStr) return { error: "Feedback value is required." };

  const valueNum = parseFloat(valueStr);
  if (isNaN(valueNum) || valueNum < -1 || valueNum > 1) {
    return { error: "Feedback value must be between -1 and 1." };
  }

  const parsedFeedback = await parseFeedbackInput(feedbackJson, feedbackFile);
  if (parsedFeedback.error) {
    return { error: parsedFeedback.error };
  }

  const uploaded = await uploadFeedbackPayload({
    agentId,
    value: valueNum,
    tags: [tag1, tag2].filter(Boolean),
    createdAt: new Date().toISOString(),
    feedback: parsedFeedback.data,
  });
  if (uploaded.error || !uploaded.uri) {
    return { error: uploaded.error ?? "Failed to prepare feedback payload." };
  }

  try {
    const decimals = 4;
    const value = toScaledFeedbackValue(valueNum, decimals);
    return {
      contractAddress: cfg.reputationAddress,
      agentId,
      value: value.toString(),
      valueDecimals: decimals,
      tag1,
      tag2,
      feedbackURI: uploaded.uri,
    };
  } catch (err) {
    return {
      error:
        err instanceof Error ? err.message : "Feedback preparation failed.",
    };
  }
}

export async function prepareValidation(
  formData: FormData,
): Promise<PreparedValidationResult> {
  const agentId = getFormValue(formData, "agentId");
  const validatorAddress = getFormValue(formData, "validatorAddress") as
    | `0x${string}`
    | "";
  const requestURI = getFormValue(formData, "requestURI");

  if (!agentId) return { error: "Agent ID is required." };
  if (!validatorAddress) return { error: "Validator address is required." };

  if (!cfg.isConfigured || !cfg.validationAddress) {
    return { error: "Validation registry is not configured." };
  }

  try {
    const requestHash = keccak256(
      toHex(`${agentId}:${validatorAddress}:${requestURI}:${Date.now()}`),
    );
    return {
      contractAddress: cfg.validationAddress,
      agentId,
      validatorAddress,
      requestURI,
      requestHash,
    };
  } catch (err) {
    return {
      error:
        err instanceof Error
          ? err.message
          : "Validation request preparation failed.",
    };
  }
}
