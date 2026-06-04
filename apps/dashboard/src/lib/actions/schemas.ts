import { z } from "zod";

const hexStringSchema = z
  .string()
  .trim()
  .regex(/^0x[0-9a-fA-F]+$/, "Expected a hex string.");

export const oracleUrlSchema = z
  .string()
  .trim()
  .min(1, "teeOracleUrl is required.")
  .transform((value) => value.replace(/\/+$/, ""))
  .refine((value) => {
    try {
      const parsed = new URL(value);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  }, "teeOracleUrl must be a valid http(s) URL.");

export const recordOracleRunParamsSchema = z
  .object({
    agentId: z.string().trim().min(1, "agentId is required."),
    erc8004AgentId: z
      .string()
      .trim()
      .min(1, "erc8004AgentId is required.")
      .refine((value) => value !== "0", "erc8004AgentId is required."),
    teeOracleUrl: oracleUrlSchema,
    payload: z.record(z.string(), z.unknown()),
    signature: hexStringSchema,
    deadline: z.number().int().positive("deadline must be a positive integer."),
  })
  .strict();

export const oracleAddressResponseSchema = z
  .object({
    address: hexStringSchema,
  })
  .passthrough();

export const oracleRunResponseSchema = z
  .object({
    agentId: z.string().trim().min(1),
    result: z.record(z.string(), z.unknown()),
    timestamp: z.number(),
    quote: z.string().trim().min(1),
    event_log: z.string().trim().min(1),
  })
  .passthrough();

export const oracleValidationResponseSchema = z
  .object({
    score: z.number().int().min(0).max(100),
    reasoning: z.string().optional(),
    responseURI: z.string().trim().min(1),
    responseHash: hexStringSchema,
    tag: z.string().optional(),
    txHash: hexStringSchema.optional(),
  })
  .passthrough();

export const oracleErrorResponseSchema = z
  .object({
    error: z.string().trim().min(1),
  })
  .passthrough();

export type RecordOracleRunParams = z.input<typeof recordOracleRunParamsSchema>;

export function zodErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof z.ZodError) {
    return err.issues[0]?.message ?? fallback;
  }
  return err instanceof Error ? err.message : fallback;
}
