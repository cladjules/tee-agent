/**
 * LLM-based validation scorer.
 *
 * Sends the original question/input and the agent's recorded response to the
 * configured LLM and returns a score from 0 (completely wrong) to 100
 * (perfectly accurate) together with a brief reasoning string.
 *
 * Environment variables:
 *   LLM_API_KEY           — required
 *   LLM_API_BASE          — required
 *   LLM_VALIDATION_MODEL  — required
 *   TAVILY_API_KEY        — optional fallback when direct source fetches are blocked
 */

import { z } from "zod";

export interface ScoreResult {
  score: number;
  reasoning: string;
  evidence?: Record<string, unknown>;
}

const MAX_EVIDENCE_CHARS = 24_000;
const SOURCE_FETCH_TIMEOUT_MS = 15_000;

const urlSchema = z.string().url();

const tavilyExtractResponseSchema = z.object({
  results: z.array(
    z.object({
      url: z.string().url(),
      raw_content: z.string().optional(),
      content: z.string().optional(),
    }),
  ),
  failed_results: z
    .array(
      z.object({
        url: z.string().url(),
        error: z.string().optional(),
      }),
    )
    .optional(),
});

type SourceFetchResult =
  | {
      status: "ok";
      url: string;
      text: string;
      contentType: string;
    }
  | {
      status: "blocked" | "failed";
      url: string;
      reason: string;
    };

export default async function validateRun(
  originalPayload: Record<string, unknown>,
  originalResult: Record<string, unknown>,
): Promise<ScoreResult> {
  const sourceValidation = await validateSourcesIfPresent(
    originalPayload,
    originalResult,
  );
  if (sourceValidation) return sourceValidation;

  return scoreWithModel({
    originalPayload,
    originalResult,
  });
}

async function validateSourcesIfPresent(
  originalPayload: Record<string, unknown>,
  originalResult: Record<string, unknown>,
): Promise<ScoreResult | null> {
  const sources = collectSources(originalResult, originalPayload);
  if (sources.length === 0) return null;

  const documents: string[] = [];
  let unavailableSources: Array<{
    url: string;
    status: "blocked" | "failed";
    reason: string;
  }> = [];

  for (const source of sources) {
    try {
      const current = await fetchUrlEvidence(source);
      if (current.status === "ok") {
        documents.push(formatEvidenceDocument(current));
      } else {
        unavailableSources.push({
          url: current.url,
          status: current.status,
          reason: current.reason,
        });
      }
    } catch (err) {
      unavailableSources.push({
        url: source,
        status: "failed",
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (unavailableSources.length > 0) {
    const tavilyResults = await fetchSourcesWithTavily(
      unavailableSources.map((s) => s.url),
      originalPayload,
    );
    for (const result of tavilyResults) {
      if (result.status === "ok") {
        documents.push(formatEvidenceDocument(result));
        unavailableSources = unavailableSources.filter(
          (s) => s.url !== result.url,
        );
      }
    }
  }

  if (documents.length === 0) {
    return {
      score: 20,
      reasoning:
        "No usable source evidence could be re-fetched, so the original answer cannot be validated.",
      evidence: {
        unavailableSources,
      },
    };
  }

  const scored = await scoreWithModel({
    originalPayload,
    originalResult,
    evidenceText: documents.join("\n\n---\n\n"),
  });
  return unavailableSources.length === 0
    ? scored
    : {
        ...scored,
        evidence: {
          ...(scored.evidence ?? {}),
          unavailableSources,
        },
      };
}

async function scoreWithModel(input: {
  originalPayload: Record<string, unknown>;
  originalResult: Record<string, unknown>;
  evidenceText?: string;
}): Promise<ScoreResult> {
  const apiKey = requiredEnv("LLM_API_KEY");
  const apiBase = requiredEnv("LLM_API_BASE");
  const model = requiredEnv("LLM_VALIDATION_MODEL");
  const currentDate = new Date().toISOString().slice(0, 10);

  const res = await fetch(`${apiBase}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are an impartial fact-checker. " +
            `Current UTC date: ${currentDate}. Use this date to decide whether dated questions are past or future. ` +
            "A question date before the current UTC date is not a future date. " +
            "Given the original input question and the agent's recorded response, " +
            "score the accuracy of the response from 0 (completely wrong or no response) " +
            "to 100 (perfectly accurate and complete). " +
            "When source evidence is provided, score only from that evidence. " +
            'Reply with a JSON object: { "score": <integer 0-100>, "reasoning": "<brief explanation>" }',
        },
        {
          role: "user",
          content:
            `Original input:\n${JSON.stringify(input.originalPayload, null, 2)}\n\n` +
            `Agent response:\n${JSON.stringify(input.originalResult, null, 2)}` +
            (input.evidenceText
              ? `\n\nRe-fetched source evidence:\n${input.evidenceText}`
              : ""),
        },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`LLM API error ${res.status}: ${await res.text()}`);
  }

  const json = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  const content = json.choices[0]?.message?.content;
  if (!content) throw new Error("LLM returned empty content");

  const parsed = JSON.parse(content) as { score?: number; reasoning?: string };
  return {
    score: Math.max(0, Math.min(100, Math.round(Number(parsed.score ?? 0)))),
    reasoning: parsed.reasoning ?? "",
  };
}

function formatEvidenceDocument(
  result: Extract<SourceFetchResult, { status: "ok" }>,
): string {
  return `Source: ${result.url}\nContent-Type: ${result.contentType}\n\n${result.text}`;
}

async function fetchUrlEvidence(url: string): Promise<SourceFetchResult> {
  const parsedUrl = new URL(url);
  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    throw new Error("Source URL must use http or https.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SOURCE_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(parsedUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; TeeAgentValidator/1.0; +https://tee-agent.local)",
        Accept:
          "text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
      signal: controller.signal,
    });
    const body = await response.text();
    if (!response.ok) {
      return {
        status: "failed",
        url,
        reason: `Source fetch failed with HTTP ${response.status}.`,
      };
    }
    const contentType = response.headers.get("content-type") ?? "unknown";
    const text = contentType.includes("application/json")
      ? formatJsonBody(body)
      : body;

    const blockedReason = detectBlockedPage(text);
    if (blockedReason) {
      return {
        status: "blocked",
        url,
        reason: blockedReason,
      };
    }

    return {
      status: "ok",
      url,
      text: text.slice(0, MAX_EVIDENCE_CHARS),
      contentType,
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(
        `Source fetch timed out after ${SOURCE_FETCH_TIMEOUT_MS}ms.`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchSourcesWithTavily(
  urls: string[],
  originalPayload: Record<string, unknown>,
): Promise<SourceFetchResult[]> {
  const apiKey = process.env.TAVILY_API_KEY?.trim();
  if (!apiKey) {
    return urls.map((url) => ({
      status: "failed",
      url,
      reason:
        "TAVILY_API_KEY is not configured, so Tavily fallback extraction was skipped.",
    }));
  }

  const response = await fetch("https://api.tavily.com/extract", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      urls,
      query: validationQuery(originalPayload),
      extract_depth: "advanced",
      format: "markdown",
      timeout: 20,
    }),
  });
  const raw = await response.text();
  if (!response.ok) {
    return urls.map((url) => ({
      status: "failed",
      url,
      reason: `Tavily /extract failed ${response.status}: ${raw.slice(0, 500)}`,
    }));
  }

  const extracted = tavilyExtractResponseSchema.parse(
    raw ? JSON.parse(raw) : {},
  );
  const resultsByUrl = new Map<string, SourceFetchResult>();

  for (const result of extracted.results) {
    const text = result.raw_content?.trim() || result.content?.trim();
    if (!text) {
      resultsByUrl.set(result.url, {
        status: "failed",
        url: result.url,
        reason: "Tavily returned no extracted content.",
      });
      continue;
    }

    const blockedReason = detectBlockedPage(text);
    if (blockedReason) {
      resultsByUrl.set(result.url, {
        status: "blocked",
        url: result.url,
        reason: blockedReason,
      });
      continue;
    }

    resultsByUrl.set(result.url, {
      status: "ok",
      url: result.url,
      text: text.slice(0, MAX_EVIDENCE_CHARS),
      contentType: "text/markdown; source=tavily",
    });
  }

  for (const failed of extracted.failed_results ?? []) {
    resultsByUrl.set(failed.url, {
      status: "failed",
      url: failed.url,
      reason: failed.error ?? "Tavily could not extract this source.",
    });
  }

  return urls.map(
    (url) =>
      resultsByUrl.get(url) ?? {
        status: "failed",
        url,
        reason: "Tavily returned no result for this source.",
      },
  );
}

function validationQuery(originalPayload: Record<string, unknown>): string {
  const question = originalPayload.question;
  if (typeof question === "string" && question.trim()) return question.trim();
  return JSON.stringify(originalPayload).slice(0, 1_000);
}

function detectBlockedPage(text: string): string | null {
  const normalized = text
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  const blockedPatterns = [
    "web application firewall",
    "request access",
    "automated scraping",
    "enable javascript",
    "checking your browser",
    "captcha",
    "access denied",
    "verify you are human",
    "unusual traffic",
    "cloudflare ray id",
  ];

  const matchedPattern = blockedPatterns.find((pattern) =>
    normalized.includes(pattern),
  );

  return matchedPattern
    ? `Fetched page appears to be access-control content (${matchedPattern}).`
    : null;
}

function collectSources(
  originalResult: Record<string, unknown>,
  originalPayload: Record<string, unknown>,
): string[] {
  const sources: string[] = [];

  const sourceURLs = z.array(urlSchema).safeParse(originalResult.sourceURLs);
  if (sourceURLs.success) {
    sources.push(...sourceURLs.data);
  }

  const url = urlSchema.safeParse(originalPayload.url);
  if (url.success) {
    sources.push(url.data);
  }

  return sources;
}

function formatJsonBody(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}
