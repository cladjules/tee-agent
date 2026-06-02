/**
 * LLM-based validation scorer.
 *
 * Sends the original claim/input and the agent's recorded response to the
 * configured LLM and returns a score from 0 (completely wrong) to 100
 * (perfectly accurate) together with a brief reasoning string.
 *
 * Environment variables:
 *   LLM_API_KEY           — required
 *   LLM_API_BASE          — required
 *   LLM_VALIDATION_MODEL  — required
 */

export interface ScoreResult {
  score: number;
  reasoning: string;
}

export async function scoreWithLLM(
  originalPayload: Record<string, unknown>,
  originalResult: Record<string, unknown>,
): Promise<ScoreResult> {
  const apiKey = requiredEnv("LLM_API_KEY");
  const apiBase = requiredEnv("LLM_API_BASE");
  const model = requiredEnv("LLM_VALIDATION_MODEL");

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

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}
