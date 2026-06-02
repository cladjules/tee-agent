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
 *   { claim: string, evidence?: string }
 *
 * Base Sepolia dev:
 *   npm run dev:prediction-market     # from apps/oracle/
 *
 * Deploy to Phala Cloud:
 *   npm run deploy:prediction-market   # from apps/oracle/
 */

import "dotenv/config";
import { z } from "zod";
import { startOracle, type AgentHandler } from "@tee-agent/server";
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
//   phala/gemma-4-26b-a4b-uncensored  Gemma-4 26B-A4B Uncensored (default)
//   phala/deepseek-v3.2               DeepSeek V3.2, TEE-attested
//   phala/gpt-oss-20b                 OpenAI GPT OSS 20B, TEE-attested
//   phala/glm-4.7-flash               Z.AI GLM 4.7 Flash, TEE-attested
//   google/gemini-2.5-flash           Gemini 2.5 Flash (non-attested)
//   openai/gpt-4o-mini                GPT-4o Mini (non-attested)

const configSchema = z.object({
  model: z.string(),
  top_p: z.number(),
  temperature: z.number(),
});

const payloadSchema = z.object({
  claim: z.string(),
  evidence: z.string().optional(),
});

// ─── Handler ──────────────────────────────────────────────────────────────────

const predictionVerifier: AgentHandler = {
  async run(rawPayload, ctx) {
    const skillContent = ctx.blobs[0] as string;
    const rawConfig = ctx.blobs[1];
    console.log(
      "Received prediction verification request with config:",
      rawConfig,
    );
    console.log(
      "Received prediction verification request with payload:",
      rawPayload,
    );
    const cfg = configSchema.parse(rawConfig);
    const { claim, evidence } = payloadSchema.parse(rawPayload);

    const apiKey = requiredEnv("LLM_API_KEY");
    const apiBase = requiredEnv("LLM_API_BASE");

    const userContent = evidence
      ? `Claim: ${claim}\n\nEvidence URL: ${evidence}`
      : `Claim: ${claim}`;

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
    const verdict = parsed.verdict;
    if (verdict !== "YES" && verdict !== "NO" && verdict !== "INVALID") {
      throw new Error(`Unexpected verdict: ${String(verdict)}`);
    }

    // ── Confidential AI API: fetch the LLM's ECDSA response signature ──────
    // GET /v1/signature/{request_id}?model=... returns a signature over
    // "model_name:sha256(request):sha256(response)" signed by the TEE's key.
    // Pair with GET /v1/attestation/report to get full on-chain-verifiable
    // proof that the inference ran inside a genuine TDX + GPU TEE.
    let llmSignature: {
      text: string;
      signature: string;
      signingAddress: string;
      signingAlgo: string;
    } | null = null;

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
        confidence:
          typeof parsed.confidence === "number" ? parsed.confidence : 0,
        reasoning: parsed.reasoning ?? "",
      },
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
