/**
 * Prediction Market Verifier — single-handler oracle entry point
 * ─────────────────────────────────────────────────────────────────────────────
 * Starts a TEE oracle that exposes only the "prediction-verifier" skill.
 * The handler calls a Phala-attested LLM (Red Pill) and returns a signed
 * YES / NO / INVALID verdict with the LLM's ECDSA response signature.
 *
 * Two encrypted iData blobs are stored on-chain at mint time:
 *   iData[0]  SKILL.md  — system prompt markdown (used verbatim as the LLM system message)
 *   iData[1]  config    — { model: string, temperature: number }
 *                          API keys are NOT stored here; set LLM_API_KEY on the oracle.
 * Payload (caller-supplied at run time):
 *   { question: string, url?: string }
 *
 * Arbitrum Sepolia dev:
 *   npm run dev:prediction-market     # from apps/oracle/
 *
 * Deploy to Phala Cloud:
 *   npm run oracle:deploy -- src/examples/prediction-market.ts
 */

import { z } from "zod";
import {
  startOracle,
  type AgentHandler,
  type OracleRunResult,
} from "@tee-agent/oracle";
import deploymentsJson from "../../../../deployments.json" with { type: "json" };

// ─── Config schema ───────────────────────────────────────────────────────────
// Shape of data encrypted into the agent's ERC-7857 config blob (iData[1]).
// API keys are configured on the oracle server via LLM_API_KEY / LLM_API_BASE.
//
// Phala AI (Red Pill) is the recommended provider — OpenAI-compatible gateway
// at https://api.red-pill.ai/v1. Models prefixed with "phala/" run inside
// TDX-attested enclaves and sign every response with ECDSA.
// Get an API key at https://red-pill.ai
//
// Notable models:
//   google/gemma-4-31b-it             Gemma-4 26B-A4B Uncensored (default)
//   phala/deepseek-v3.2               DeepSeek V3.2, TEE-attested
//   phala/gpt-oss-20b                 OpenAI GPT OSS 20B, TEE-attested
//   phala/glm-4.7-flash               Z.AI GLM 4.7 Flash, TEE-attested
//   google/gemini-3-flash-preview     Gemini 3 Flash Preview (non-attested)
//   openai/gpt-4o-mini                GPT-4o Mini (non-attested)

const configSchema = z.object({
  model: z.string(),
  top_p: z.number(),
  temperature: z.number(),
});

const payloadSchema = z.object({
  question: z.string(),
  url: z.string().url().optional(),
});

const MAX_EVIDENCE_CHARS = 24_000;
const EVIDENCE_FETCH_TIMEOUT_MS = 15_000;
const MAX_RESEARCH_SOURCES = 3;

type EvidenceDocument = {
  url: string;
  text: string;
};

type PredictionOutcome = {
  verdict: "YES" | "NO" | "INVALID";
  confidence: number;
  reasoning: string;
  sourceURLs: string[];
};

type LlmSignature = {
  text: string;
  signature: string;
  signingAddress: string;
  signingAlgo: string;
};

type PredictionResult = OracleRunResult<
  PredictionOutcome,
  {
    llmSignature: LlmSignature | null;
  }
>;

function normalizeVerdict(value: unknown): "YES" | "NO" | "INVALID" {
  if (typeof value === "boolean") return value ? "YES" : "NO";
  const verdict = String(value).trim().toUpperCase();
  if (verdict === "TRUE") return "YES";
  if (verdict === "FALSE") return "NO";
  if (verdict === "YES" || verdict === "NO" || verdict === "INVALID") {
    return verdict;
  }
  throw new Error(`Unexpected verdict: ${String(value)}`);
}

async function fetchUrlEvidence(url: string): Promise<EvidenceDocument> {
  const parsedUrl = new URL(url);
  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    throw new Error("url must use http or https.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    EVIDENCE_FETCH_TIMEOUT_MS,
  );
  try {
    const response = await fetch(parsedUrl, {
      headers: {
        Accept: "application/json,text/plain,text/html;q=0.8,*/*;q=0.5",
      },
      signal: controller.signal,
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(
        `Evidence fetch failed ${response.status}: ${body.slice(0, 500)}`,
      );
    }

    const contentType = response.headers.get("content-type") ?? "unknown";
    let evidenceText = body;
    if (contentType.includes("application/json")) {
      try {
        evidenceText = JSON.stringify(JSON.parse(body), null, 2);
      } catch {
        evidenceText = body;
      }
    }

    return {
      url: parsedUrl.toString(),
      text: evidenceText.slice(0, MAX_EVIDENCE_CHARS),
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(
        `Evidence fetch timed out after ${EVIDENCE_FETCH_TIMEOUT_MS}ms.`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

const tavilySearchResponseSchema = z.object({
  results: z.array(
    z.object({
      url: z.string().url(),
      title: z.string().optional(),
      content: z.string().optional(),
      raw_content: z.string().optional(),
    }),
  ),
});

async function tavilySearch(body: object) {
  const apiKey = requiredEnv("TAVILY_API_KEY");
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Tavily /search failed ${response.status}: ${raw}`);
  }
  return raw ? (JSON.parse(raw) as unknown) : {};
}

async function researchEvidence(question: string): Promise<EvidenceDocument[]> {
  const searchJson = await tavilySearch({
    query: question,
    search_depth: "basic",
    include_raw_content: "markdown",
    include_answer: false,
    max_results: MAX_RESEARCH_SOURCES,
    topic: "general",
  });
  const search = tavilySearchResponseSchema.parse(searchJson);
  const searchResults = search.results.slice(0, MAX_RESEARCH_SOURCES);
  if (searchResults.length === 0) {
    throw new Error("Tavily returned no sourceURLs for the question.");
  }

  const documents: EvidenceDocument[] = [];
  for (const result of searchResults) {
    const content = result.raw_content?.trim() || result.content?.trim();
    if (!content) continue;
    documents.push({
      url: result.url,
      text: content.slice(0, MAX_EVIDENCE_CHARS),
    });
  }

  if (documents.length === 0) {
    throw new Error("Tavily returned no raw content for the question.");
  }
  return documents;
}

async function resolveEvidence(
  question: string,
  url: string | undefined,
): Promise<EvidenceDocument[]> {
  if (url) return [await fetchUrlEvidence(url)];
  return researchEvidence(question);
}

// ─── Handler ──────────────────────────────────────────────────────────────────

const predictionVerifier: AgentHandler<PredictionResult> = {
  async run(rawPayload, ctx) {
    const skillContent = ctx.blobs[0] as string;
    const rawConfig = ctx.blobs[1];
    console.log(
      "Received prediction verification request with config:",
      rawConfig,
    );
    const cfg = configSchema.parse(rawConfig);
    const { question, url } = payloadSchema.parse(rawPayload);
    const evidenceDocuments = await resolveEvidence(question, url);

    const apiKey = requiredEnv("LLM_API_KEY");
    const apiBase = requiredEnv("LLM_API_BASE");

    const currentDate = new Date().toISOString().slice(0, 10);
    const userContent = [
      `Current UTC date: ${currentDate}`,
      `Question: ${question}`,
      "Answer using only the source evidence below.",
      evidenceDocuments.map((document) => document.text).join("\n\n---\n\n"),
    ]
      .filter(Boolean)
      .join("\n\n");

    const response = await fetch(`${apiBase}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          { role: "system", content: skillContent },
          { role: "user", content: userContent },
        ],
        temperature: cfg.temperature,
        top_p: cfg.top_p,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      throw new Error(
        `LLM API error ${response.status}: ${await response.text()}`,
      );
    }

    const json = (await response.json()) as {
      id?: string;
      choices: Array<{ message: { content: string } }>;
    };
    const content = json.choices[0]?.message?.content;
    if (!content) throw new Error("LLM returned empty content");

    const parsed = JSON.parse(content) as {
      verdict?: string;
      confidence?: number;
      reasoning?: string;
    };
    const verdict = normalizeVerdict(parsed.verdict);

    // ── Confidential AI API: fetch the LLM's ECDSA response signature ──────
    // GET /v1/signature/{request_id}?model=... returns a signature over
    // "model_name:sha256(request):sha256(response)" signed by the TEE's key.
    // Pair with GET /v1/attestation/report to get full on-chain-verifiable
    // proof that the inference ran inside a genuine TDX + GPU TEE.
    let llmSignature: LlmSignature | null = null;

    if (json.id) {
      try {
        const sigRes = await fetch(
          `${apiBase}/signature/${encodeURIComponent(json.id)}?model=${encodeURIComponent(cfg.model)}`,
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
        // Signature fetch failed — result is still valid, just not LLM-attested.
      }
    }

    return {
      outcome: {
        verdict,
        confidence: parsed.confidence ?? 0,
        reasoning: parsed.reasoning ?? "",
        sourceURLs: evidenceDocuments.map((document) => document.url),
      } satisfies PredictionOutcome,
      extra: {
        llmSignature,
      },
    };
  },
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

// ─── Start oracle ─────────────────────────────────────────────────────────────

await startOracle({
  handler: predictionVerifier,
  deployments: deploymentsJson,
});
