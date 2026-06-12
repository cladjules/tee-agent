/**
 * prepareFeedback — builds parameters for submitting ERC-8004 reputation feedback.
 */

import type {
  AgentConfig,
  PrepareFeedbackParams,
  PrepareFeedbackResult,
} from "../types.js";
import {
  createPublicClient,
  http,
  keccak256,
  stringToBytes,
  type Address,
  type Hex,
} from "viem";
import { VALIDATION_REGISTRY_ABI } from "../abis.js";
import { ReputationRegistry } from "../registry/reputation.js";

export type FeedbackView = {
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

export type FeedbackOverview = {
  totalScore: number;
  totalCount: number;
  feedbacks: FeedbackView[];
};

export type FeedbackVerificationResult = {
  status: "verified" | "unverified";
  reason?: string;
  chainId?: number;
  agentId?: string;
  requestHash?: Hex;
  validationTxHash?: Hex;
  feedbackURI?: string;
  feedbackHash?: Hex;
};

function toScaledFeedbackValue(valueNum: number, decimals: number): bigint {
  return BigInt(Math.round(valueNum * Math.pow(10, decimals)));
}

function normalizeScaledValue(value: bigint, decimals: number): number {
  return Number(value) / Math.pow(10, decimals);
}

function toFeedbackHash(payloadJson: string): Hex {
  return keccak256(stringToBytes(payloadJson));
}

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toEip155Reference(chainId: number, value: string): string {
  return `eip155:${chainId}:${value}`;
}

function parseEip155ChainId(value: string | undefined): number | null {
  if (!value) return null;
  const [namespace, chainId, address] = value.split(":");
  if (namespace !== "eip155" || !chainId || !address) return null;
  const parsed = Number(chainId);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function toFeedbackAgentId(value: string): number {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 0) {
    throw new Error("Agent ID must be a safe integer for feedback JSON.");
  }
  return numeric;
}

async function parseFeedbackData(
  feedbackJson?: string,
  feedbackFile?: File | null,
): Promise<JsonValue> {
  if (feedbackFile instanceof File && feedbackFile.size > 0) {
    const text = await feedbackFile.text();
    try {
      return JSON.parse(text) as JsonValue;
    } catch {
      throw new Error("Feedback file must contain valid JSON.");
    }
  }
  if (feedbackJson) {
    try {
      return JSON.parse(feedbackJson) as JsonValue;
    } catch {
      throw new Error("Feedback JSON is invalid.");
    }
  }
  throw new Error("Provide feedback JSON text or upload a .json file.");
}

export async function prepareFeedback(
  config: AgentConfig,
  params: PrepareFeedbackParams,
): Promise<PrepareFeedbackResult> {
  const {
    agentId,
    clientAddress,
    value,
    tag1,
    tag2,
    feedbackJson,
    feedbackFile,
  } = params;

  if (!agentId) throw new Error("Agent ID is required.");
  if (!clientAddress) throw new Error("Client address is required.");
  if (value === undefined || value === null)
    throw new Error("Feedback value is required.");
  if (isNaN(value) || value < -1 || value > 1) {
    throw new Error("Feedback value must be between -1 and 1.");
  }

  if (!config.reputationRegistryAddress) {
    throw new Error("reputationRegistryAddress is not configured.");
  }
  if (!config.identityRegistryAddress) {
    throw new Error("identityRegistryAddress is not configured.");
  }

  const feedbackData = await parseFeedbackData(feedbackJson, feedbackFile);
  if (!isJsonObject(feedbackData)) {
    throw new Error("Feedback JSON must be an object.");
  }
  const decimals = 4;
  const scaledValue = toScaledFeedbackValue(value, decimals);

  const payload: JsonObject = {
    ...feedbackData,
    agentRegistry: toEip155Reference(
      config.chain.id,
      config.identityRegistryAddress,
    ),
    agentId: toFeedbackAgentId(agentId),
    clientAddress: toEip155Reference(config.chain.id, clientAddress),
    createdAt: new Date().toISOString(),
    value: Number(scaledValue),
    valueDecimals: decimals,
    tag1: tag1 ?? "",
    tag2: tag2 ?? "",
  };

  const payloadJson = JSON.stringify(payload);
  const feedbackURI = `data:application/json;base64,${Buffer.from(
    payloadJson,
  ).toString("base64")}`;
  const feedbackHash = toFeedbackHash(payloadJson);

  return {
    contractAddress: config.reputationRegistryAddress,
    agentId,
    value: scaledValue.toString(),
    valueDecimals: decimals,
    tag1: tag1 ?? "",
    tag2: tag2 ?? "",
    feedbackURI,
    feedbackHash,
  };
}

export type DecodedFeedbackPayload = {
  payload: FeedbackPayload;
  payloadJson: string;
};

export type FeedbackPayload = {
  agentRegistry?: string;
  agentId?: string | number;
  clientAddress?: string;
  value?: number;
  valueDecimals?: number;
  tag1?: string;
  tag2?: string;
  validation?: {
    requestHash?: Hex;
    responseHash?: Hex;
    txHash?: Hex;
    validationRegistry?: string;
    validatorAddress?: string;
  };
};

export function getFeedbackPayloadChainId(
  payload: FeedbackPayload,
): number | null {
  return parseEip155ChainId(payload.agentRegistry);
}

export function decodeFeedbackURI(
  uri: string | undefined,
): DecodedFeedbackPayload | null {
  if (!uri?.startsWith("data:application/json;base64,")) return null;
  try {
    const payloadJson = Buffer.from(
      uri.split(",", 2)[1] ?? "",
      "base64",
    ).toString("utf8");
    return {
      payload: JSON.parse(payloadJson) as FeedbackPayload,
      payloadJson,
    };
  } catch {
    return null;
  }
}

export async function verifyFeedbackURI(
  config: AgentConfig,
  decoded: DecodedFeedbackPayload,
): Promise<FeedbackVerificationResult> {
  const { payload, payloadJson } = decoded;
  const feedbackHash = toFeedbackHash(payloadJson);
  const chainId = getFeedbackPayloadChainId(payload);
  if (!chainId) {
    return { status: "unverified", reason: "Missing agent registry." };
  }
  if (chainId !== config.chain.id) {
    return { status: "unverified", reason: "Chain mismatch." };
  }
  if (!payload.agentId) {
    return { status: "unverified", reason: "Agent mismatch." };
  }
  let agentId: bigint;
  try {
    agentId = BigInt(payload.agentId);
  } catch {
    return { status: "unverified", reason: "Agent mismatch." };
  }
  const validation = payload.validation;
  if (!validation?.requestHash || !validation.responseHash) {
    return { status: "unverified", reason: "Missing validation reference." };
  }
  if (!config.rpcUrl || !config.validationRegistryAddress) {
    return { status: "unverified", reason: "Validation registry unavailable." };
  }

  const publicClient = createPublicClient({
    chain: config.chain,
    transport: http(config.rpcUrl),
  });
  let validationStatus: [Address, bigint, number, Hex, string, bigint];
  try {
    validationStatus = (await publicClient.readContract({
      address: config.validationRegistryAddress,
      abi: VALIDATION_REGISTRY_ABI,
      functionName: "getValidationStatus",
      args: [validation.requestHash],
    })) as [Address, bigint, number, Hex, string, bigint];
  } catch (err) {
    console.debug("[feedback] validation status lookup failed:", err);
    return {
      status: "unverified",
      reason: "Validation status unavailable.",
    };
  }

  const [
    validatorAddress,
    statusAgentId,
    ,
    responseHash,
    ,
    lastUpdate,
  ] = validationStatus;

  if (lastUpdate === 0n) {
    return { status: "unverified", reason: "Validation has no response." };
  }
  if (statusAgentId !== agentId) {
    return { status: "unverified", reason: "Validation agent mismatch." };
  }
  if (
    config.teeVerifierAddress &&
    validatorAddress.toLowerCase() !== config.teeVerifierAddress.toLowerCase()
  ) {
    return { status: "unverified", reason: "Validation was not TEE verified." };
  }
  if (responseHash.toLowerCase() !== validation.responseHash.toLowerCase()) {
    return {
      status: "unverified",
      reason: "Validation response hash mismatch.",
    };
  }

  return {
    status: "verified",
    chainId: config.chain.id,
    agentId: agentId.toString(),
    validationTxHash: validation.txHash,
    requestHash: validation.requestHash,
    feedbackHash,
  };
}

export async function fetchFeedbackOverview(
  config: AgentConfig,
  erc8004AgentId: string | bigint | null,
): Promise<FeedbackOverview> {
  if (!erc8004AgentId || !config.reputationRegistryAddress || !config.rpcUrl) {
    return { totalScore: 0, totalCount: 0, feedbacks: [] };
  }

  const registry = new ReputationRegistry({
    chainId: config.chain.id,
    rpcUrl: config.rpcUrl,
  });
  const agentId = BigInt(erc8004AgentId);
  const clients = await registry.getClients(agentId);

  if (clients.length === 0) {
    return { totalScore: 0, totalCount: 0, feedbacks: [] };
  }

  const [summary, feedbackRows, feedbackEvents] = await Promise.all([
    registry.getSummary(agentId, clients, "", ""),
    registry.readAllFeedback(agentId, clients, "", "", true),
    registry.getNewFeedbackEvents(agentId, config.registryFromBlock),
  ]);

  const eventByFeedbackKey = new Map<
    string,
    (typeof feedbackEvents)[number]
  >();
  for (const event of feedbackEvents) {
    eventByFeedbackKey.set(
      `${event.client.toLowerCase()}:${event.feedbackIndex.toString()}`,
      event,
    );
  }

  const feedbacks = feedbackRows.clients.map((client, index): FeedbackView => {
    const value = feedbackRows.values[index] ?? 0n;
    const valueDecimals = feedbackRows.valueDecimals[index] ?? 0;
    const feedbackIndex = feedbackRows.feedbackIndexes[index] ?? 0n;
    const event = eventByFeedbackKey.get(
      `${client.toLowerCase()}:${feedbackIndex.toString()}`,
    );
    return {
      client,
      feedbackIndex: Number(feedbackIndex),
      value: value.toString(),
      valueDecimals,
      normalizedValue: normalizeScaledValue(value, valueDecimals),
      tag1: feedbackRows.tag1s[index] ?? "",
      tag2: feedbackRows.tag2s[index] ?? "",
      isRevoked: feedbackRows.revokedStatuses[index] ?? false,
      endpoint: event?.endpoint ?? undefined,
      feedbackURI: event?.feedbackURI ?? undefined,
      feedbackHash: event?.feedbackHash ?? undefined,
    };
  });
  return {
    totalScore: normalizeScaledValue(
      summary.summaryValue,
      summary.summaryValueDecimals,
    ),
    totalCount: Number(summary.count),
    feedbacks,
  };
}
