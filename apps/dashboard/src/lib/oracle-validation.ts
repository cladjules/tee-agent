import "server-only";

import { buildValidateTypedData } from "@tee-agent/agent/typed-data";
import { fetchAgentServices as sdkFetchAgentServices } from "@tee-agent/agent/ops/services";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { getServerConfigForChain } from "@/lib/config";
import { addCachedValidationResponses } from "@/lib/agent-cache";
import {
  oracleAddressResponseSchema,
  oracleErrorResponseSchema,
  oracleValidationResponseSchema,
  oracleUrlSchema,
  zodErrorMessage,
} from "@/lib/actions/schemas";

export type SubmitOracleValidationParams = {
  erc8004AgentId: string;
  validatorAddress: `0x${string}`;
  requestHash: `0x${string}`;
  payload: Record<string, unknown>;
  validationRegistryAddress: `0x${string}`;
  oracleUrl: string;
};

let validationOracleUrlsCache: Set<string> | undefined;

function decodeJsonDataUri(uri: string): Record<string, unknown> | undefined {
  const prefix = "data:application/json;base64,";
  if (!uri.startsWith(prefix)) return undefined;

  try {
    const parsed = JSON.parse(
      Buffer.from(uri.slice(prefix.length), "base64").toString("utf8"),
    ) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function validationSignerAddress(): `0x${string}` {
  const privateKey = process.env.PRIVATE_KEY?.trim();
  if (!privateKey) throw new Error("PRIVATE_KEY is required.");
  return privateKeyToAccount(privateKey as Hex).address;
}

function configuredValidationOracleUrls(): Set<string> {
  if (validationOracleUrlsCache) return validationOracleUrlsCache;

  const raw = process.env.VALIDATION_ORACLE_URLS?.trim();
  if (!raw) throw new Error("VALIDATION_ORACLE_URLS is required.");

  const urls = raw
    .split(",")
    .map((value) => oracleUrlSchema.parse(value))
    .filter((value) => value.length > 0);
  if (urls.length === 0) {
    throw new Error("VALIDATION_ORACLE_URLS is required.");
  }
  validationOracleUrlsCache = new Set(urls);
  return validationOracleUrlsCache;
}

export async function submitOracleValidation(
  chainId: number,
  params: SubmitOracleValidationParams,
): Promise<{ ok: true; txHash?: string } | { ok: false; error: string }> {
  try {
    const oracleUrl = oracleUrlSchema.parse(params.oracleUrl);

    const addressRes = await fetch(`${oracleUrl}/address`, {
      cache: "no-store",
    });
    if (!addressRes.ok) {
      throw new Error(`GET /address failed: ${addressRes.status}`);
    }
    const oracleInfo = oracleAddressResponseSchema.parse(
      await addressRes.json(),
    );

    const privateKey = process.env.PRIVATE_KEY?.trim();
    if (!privateKey) throw new Error("PRIVATE_KEY is required.");
    const account = privateKeyToAccount(privateKey as Hex);
    const deadline = Math.floor(Date.now() / 1000) + 3600;
    const typedData = buildValidateTypedData({
      oracleAddress: oracleInfo.address as `0x${string}`,
      chainId,
      erc8004AgentId: BigInt(params.erc8004AgentId),
      requestHash: params.requestHash,
      payload: params.payload,
      deadline,
    });
    const signature = await account.signTypedData(typedData);

    const res = await fetch(`${oracleUrl}/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        erc8004AgentId: params.erc8004AgentId,
        requestHash: params.requestHash,
        payload: params.payload,
        validationRegistryAddress: params.validationRegistryAddress,
        signature,
        deadline,
      }),
    });
    const raw = await res.text();
    const data = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    if (!res.ok || typeof data.error === "string") {
      const parsedError = oracleErrorResponseSchema.safeParse(data);
      throw new Error(
        parsedError.success
          ? parsedError.data.error
          : `Oracle returned HTTP ${res.status}`,
      );
    }
    const parsed = oracleValidationResponseSchema.parse(data);
    const responseUriEvidence = decodeJsonDataUri(parsed.responseURI);
    const evidence = parsed.evidence ?? responseUriEvidence;
    await addCachedValidationResponses(
      chainId,
      params.validationRegistryAddress,
      [
        {
          requestHash: params.requestHash,
          agentId: params.erc8004AgentId,
          validatorAddress: params.validatorAddress,
          score: parsed.score,
          txHash: parsed.txHash as `0x${string}` | undefined,
          timestamp: Math.floor(Date.now() / 1000),
          responseURI: parsed.responseURI,
          responseHash: parsed.responseHash as `0x${string}`,
          tag: parsed.tag,
          evidence,
        },
      ],
    );

    return {
      ok: true,
      txHash: parsed.txHash as `0x${string}` | undefined,
    };
  } catch (err) {
    return {
      ok: false,
      error: zodErrorMessage(err, "Failed to submit oracle validation."),
    };
  }
}

export async function resolveOwnedValidationOracleUrl(
  chainId: number,
  erc8004AgentId: string,
): Promise<string | undefined> {
  const cfg = getServerConfigForChain(chainId);
  let services: Awaited<ReturnType<typeof sdkFetchAgentServices>>;
  try {
    services = await sdkFetchAgentServices(cfg, {
      tokenId: erc8004AgentId,
      expectedOwner: validationSignerAddress(),
    });
  } catch (err) {
    if (
      err instanceof Error &&
      err.message.includes("You do not own ERC-8004 agent")
    ) {
      return undefined;
    }
    throw err;
  }
  if (!services.teeOracleUrl) return undefined;
  const oracleUrl = oracleUrlSchema.parse(services.teeOracleUrl);
  return configuredValidationOracleUrls().has(oracleUrl)
    ? oracleUrl
    : undefined;
}
