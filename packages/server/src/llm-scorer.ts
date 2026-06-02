/**
 * LLM-based validation scorer.
 *
 * Sends the original claim/input and the agent's recorded response to the
 * configured LLM and returns a score from 0 (completely wrong) to 100
 * (perfectly accurate) together with a brief reasoning string.
 *
 * Environment variables:
 *   LLM_API_KEY           — required
 *   LLM_API_BASE          — defaults to https://api.red-pill.ai/v1
 *   LLM_VALIDATION_MODEL  — overrides LLM_MODEL for validation calls
 */

export interface ScoreResult {
  score: number;
  reasoning: string;
}

export async function scoreWithLLM(
  originalPayload: Record<string, unknown>,
  originalResult: Record<string, unknown>,
): Promise<ScoreResult> {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) throw new Error("LLM_API_KEY is not set on the oracle.");
  const apiBase = process.env.LLM_API_BASE ?? "https://api.red-pill.ai/v1";
  const model =
    process.env.LLM_VALIDATION_MODEL ?? "phala/gemma-4-26b-a4b-uncensored";

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
            "Given the original input claim and the agent's recorded response, " +
            "score the accuracy of the response from 0 (completely wrong or no response) " +
            "to 100 (perfectly accurate and complete). " +
            'Reply with a JSON object: { "score": <integer 0-100>, "reasoning": "<brief explanation>" }',
        },
        {
          role: "user",
          content:
            `Original claim / input:\n${JSON.stringify(originalPayload, null, 2)}\n\n` +
            `Agent response:\n${JSON.stringify(originalResult, null, 2)}`,
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
