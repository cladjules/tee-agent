/**
 * Web Data Oracle — single-handler oracle entry point
 * ─────────────────────────────────────────────────────────────────────────────
 * Starts a TEE oracle that exposes only the "web-fetcher" skill.
 * The handler fetches a URL inside the enclave and returns a TEE-attested
 * content hash + optional JSON value extracted via a dot-path selector.
 *
 * Two encrypted iData blobs are stored on-chain at mint time:
 *   iData[0]  SKILL.md  — notes for the operator / agent metadata
 *   iData[1]  config    — { allowedDomains?: string[] }
 * Payload (caller-supplied at run time):
 *   { url: string, selector?: string }
 *
 * Arbitrum Sepolia dev:
 *   npm run dev:web-fetcher            # from apps/oracle/
 *
 * Deploy to Phala Cloud:
 *   npm run oracle:deploy -- src/examples/web-data-oracle.ts
 */

import { ethers } from "ethers";
import { z } from "zod";
import {
  startOracle,
  type AgentHandler,
  type OracleRunResult,
} from "@tee-agent/oracle";
import deploymentsJson from "../../../../deployments.json" with { type: "json" };

// ─── Config schema ────────────────────────────────────────────────────────────
// Shape of data encrypted into the agent's ERC-7857 config blob (iData[1]).

const configSchema = z.object({
  /** Optional list of allowed domains. If set, any URL not matching is rejected. */
  allowedDomains: z.array(z.string()).optional(),
});

const payloadSchema = z.object({
  url: z.string().url(),
  /** Dot-path into the JSON response body, e.g. "data.amount" */
  selector: z.string().optional(),
});

// ─── Helper ──────────────────────────────────────────────────────────────────

function resolveDotPath(obj: unknown, path: string): string | null {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur === null || typeof cur !== "object") return null;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur !== undefined && cur !== null ? String(cur) : null;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

type WebFetcherResult = OracleRunResult<{
  statusCode: number;
  contentHash: string;
  value: string | null;
}>;

const webFetcher: AgentHandler<WebFetcherResult> = {
  async run(rawPayload, ctx) {
    const rawConfig = ctx.blobs[1];
    const config = configSchema.parse(rawConfig);
    const { allowedDomains } = config;
    const { url, selector } = payloadSchema.parse(rawPayload);

    if (allowedDomains && allowedDomains.length > 0) {
      const hostname = new URL(url).hostname;
      if (
        !allowedDomains.some(
          (d) => hostname === d || hostname.endsWith(`.${d}`),
        )
      ) {
        throw new Error(`Domain not allowed: ${hostname}`);
      }
    }

    const response = await fetch(url, {
      headers: { "User-Agent": "TeeAgentOracle/1.0" },
    });
    const body = await response.text();
    const contentHash = ethers.keccak256(ethers.toUtf8Bytes(body));

    let value: string | null = null;
    if (selector) {
      try {
        const json = JSON.parse(body);
        value = resolveDotPath(json, selector);
      } catch {
        // body wasn't JSON — value stays null
      }
    }

    return {
      outcome: {
        statusCode: response.status,
        contentHash,
        value,
      },
    };
  },
};

// ─── Start oracle ─────────────────────────────────────────────────────────────

await startOracle({
  handler: webFetcher,
  deployments: deploymentsJson,
});
