import { z } from "zod";

const hexStringSchema = z
  .string()
  .trim()
  .regex(/^0x[0-9a-fA-F]+$/, "Expected a hex string.");

const hexBytesSchema = z
  .string()
  .trim()
  .regex(/^(0x)?[0-9a-fA-F]+$/, "Expected a hex string.")
  .transform((value) =>
    value.startsWith("0x") || value.startsWith("0X")
      ? (`0x${value.slice(2)}` as `0x${string}`)
      : (`0x${value}` as `0x${string}`),
  );

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
    chainId: z.number().int().positive().optional(),
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

const agentServiceSchema = z
  .object({
    name: z.string().trim().min(1, "Service name is required."),
    endpoint: z.string().trim().min(1, "Service endpoint is required."),
    version: z.string().trim().optional(),
    skills: z.array(z.string().trim().min(1)).optional(),
    domains: z.array(z.string().trim().min(1)).optional(),
  })
  .strict();

export const agentPublicMetadataParamsSchema = z
  .object({
    chainId: z.number().int().positive().optional(),
    tokenId: z.string().trim().min(1, "Token ID is required."),
    name: z.string().trim().min(1, "Name is required."),
    description: z.string().trim().min(1, "Description is required."),
    imageUrl: z
      .string()
      .trim()
      .optional()
      .transform((value) => (value ? value : undefined))
      .refine((value) => {
        if (!value) return true;
        try {
          const url = new URL(value);
          return url.protocol === "http:" || url.protocol === "https:";
        } catch {
          return false;
        }
      }, "Image URL must be a valid http(s) URL."),
    agentType: z
      .string()
      .trim()
      .optional()
      .transform((value) => (value ? value : undefined)),
    services: z.array(agentServiceSchema).optional(),
    x402Support: z.boolean().optional(),
    createdAt: z.number().int().positive().optional(),
  })
  .strict();

export const oracleAddressResponseSchema = z
  .object({
    address: hexStringSchema,
  })
  .passthrough();

const tdxProofSchema = z
  .object({
    type: z.literal("dstack-tdx"),
    quote: hexBytesSchema,
    event_log: z.string().trim().min(1),
    vm_config: z.string().trim().min(1),
    measurements: z
      .object({
        mrtd: z.string().trim().min(1),
        rtmr0: z.string().trim().min(1),
        rtmr1: z.string().trim().min(1),
        rtmr2: z.string().trim().min(1),
        rtmr3: z.string().trim().min(1),
      })
      .optional(),
  })
  .strict();

export const oracleRunResponseSchema = z
  .object({
    agentId: z.string().trim().min(1),
    result: z.record(z.string(), z.unknown()),
    timestamp: z.number(),
    proof: tdxProofSchema,
  })
  .passthrough();

export const oracleValidationResponseSchema = z
  .object({
    score: z.number().int().min(0).max(100),
    evidence: z.record(z.string(), z.unknown()).optional(),
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
export type AgentPublicMetadataParams = z.input<
  typeof agentPublicMetadataParamsSchema
>;
export function zodErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof z.ZodError) {
    return err.issues[0]?.message ?? fallback;
  }
  return err instanceof Error ? err.message : fallback;
}
