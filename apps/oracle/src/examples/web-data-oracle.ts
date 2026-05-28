/**
 * Web Data Oracle — single-handler oracle entry point
 * ─────────────────────────────────────────────────────────────────────────────
 * Starts a TEE oracle that exposes only the "web-fetcher" skill.
 * The handler fetches a URL inside the enclave and returns a TEE-attested
 * content hash + optional JSON value extracted via a dot-path selector.
 * If the skill blob includes `llm` config, it also runs an LLM analysis and
 * returns the LLM's ECDSA response signature (Phala Red Pill).
 *
 * Two encrypted iData blobs are stored on-chain at mint time:
 *   iData[0]  SKILL.md  — system prompt markdown (used as LLM system message when llm is set)
 *   iData[1]  config    — { allowedDomains?: string[], llm?: { model: string, temperature: number } }
 *                          API keys are NOT stored here; set LLM_API_KEY on the oracle.
 * Payload (caller-supplied at run time):
 *   { url: string, selector?: string }
 *
 * Local dev:
 *   npm run dev:web-fetcher            # from apps/oracle/
 *
 * Deploy to Phala Cloud:
 *   npm run deploy:web-fetcher         # from apps/oracle/
 */

import "dotenv/config";
import { ethers } from "ethers";
import { z } from "zod";
import { startOracle, type AgentHandler } from "../server.js";

// ─── Config schema ────────────────────────────────────────────────────────────
// Shape of data encrypted into the agent's ERC-7857 config blob (iData[1]).
// API keys are configured on the oracle server via LLM_API_KEY / LLM_API_BASE.

const configSchema = z.object({
  /** Optional list of allowed domains. If set, any URL not matching is rejected. */
  allowedDomains: z.array(z.string()).optional(),
  /**
   * Optional Phala Confidential AI config. When present the oracle runs an
   * LLM analysis on the fetched content and includes the LLM's ECDSA response
   * signature in the result. Get an API key at https://red-pill.ai
   */
  llm: z
    .object({
      model: z.string(),
      temperature: z.number(),
    })
    .optional(),
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

const webFetcher: AgentHandler = {
  async run(skillContent, rawConfig, rawPayload) {
    const config = configSchema.parse(rawConfig);
    const { allowedDomains } = config;
    const { url, selector } = payloadSchema.parse(rawPayload);

    const apiKey = process.env.LLM_API_KEY;
    const apiBase = process.env.LLM_API_BASE ?? "https://api.red-pill.ai/v1";
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
        const json = JSON.parse(body) as unknown;
        value = resolveDotPath(json, selector);
      } catch {
        // body wasn't JSON — value stays null
      }
    }

    // ── Confidential AI API: optional LLM analysis with response signature ──
    let llmAnalysis: {
      content: string;
      llmSignature: {
        text: string;
        signature: string;
        signingAddress: string;
        signingAlgo: string;
      } | null;
    } | null = null;

    if (config.llm) {
      const { model } = config.llm;
      if (!apiKey) throw new Error("LLM_API_KEY is not set on the oracle.");

      const llmRes = await fetch(`${apiBase}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: skillContent },
            {
              role: "user",
              content: `URL: ${url}\n\nContent:\n${body.slice(0, 8000)}`,
            },
          ],
          temperature: config.llm.temperature,
        }),
      });

      if (llmRes.ok) {
        const llmJson = (await llmRes.json()) as {
          id?: string;
          choices: Array<{ message: { content: string } }>;
        };
        const analysis = llmJson.choices[0]?.message?.content ?? "";

        let llmSignature: {
          text: string;
          signature: string;
          signingAddress: string;
          signingAlgo: string;
        } | null = null;

        if (llmJson.id) {
          try {
            const sigRes = await fetch(
              `${apiBase}/signature/${encodeURIComponent(llmJson.id)}?model=${encodeURIComponent(model)}`,
              { headers: { Authorization: `Bearer ${apiKey}` } },
            );
            if (sigRes.ok) {
              const sigJson = (await sigRes.json()) as {
                text: string;
                signature: string;
                signing_address: string;
                signing_algo: string;
              };
              llmSignature = {
                text: sigJson.text,
                signature: sigJson.signature,
                signingAddress: sigJson.signing_address,
                signingAlgo: sigJson.signing_algo,
              };
            }
          } catch {
            // Signature fetch failed — analysis still included, just not LLM-attested.
          }
        }

        llmAnalysis = { content: analysis, llmSignature };
      }
    }

    return {
      url,
      statusCode: response.status,
      contentHash,
      value,
      fetchedAt: Math.floor(Date.now() / 1000),
      llmAnalysis,
    };
  },

  score(result) {
    const { statusCode } = result as { statusCode?: number };
    return typeof statusCode === "number" && statusCode < 400 ? 100 : 0;
  },
};

// ─── Start oracle ─────────────────────────────────────────────────────────────

await startOracle({
  handlers: { "web-fetcher": webFetcher },
});
