/**
 * The treasurer agent's answer: the JSON it must return for one receipt check, as a JSON schema for
 * structured outputs (`output_config.format`) and as the zod schema that validates it.
 *
 * Structured outputs guarantee the shape, but not every limit (the API ignores lengths and
 * ranges), and recordings are read back from storage, so every answer is validated with zod.
 * Amounts are whole cents. The two schemas must list the same fields; a test checks that.
 */
import type { BetaMessage } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";

export const SUMMARY_MAX_WORDS = 25;
export const MAX_AI_FINDINGS = 6;
const MAX_CENTS = 100_000_000;

const wordCount = (text: string): number => text.split(/\s+/).filter(Boolean).length;
const line = (max: number) => z.string().trim().min(1).max(max);

const findingSchema = z
  .object({
    severity: z.enum(["info", "warn", "stop"]),
    text: line(300),
    evidence: line(300),
  })
  .strict();

export const treasurerAnswerSchema = z
  .object({
    vendor: line(120).nullable(),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
    items: z
      .array(z.object({ description: line(160), amountCents: z.number().int().min(-MAX_CENTS).max(MAX_CENTS) }).strict())
      .max(40),
    totalCents: z.number().int().min(0).max(MAX_CENTS).nullable(),
    matchesRequest: z.boolean(),
    findings: z.array(findingSchema).max(MAX_AI_FINDINGS),
    verdict: z.enum(["clear", "check", "stop"]),
    summary: line(400).refine((text) => wordCount(text) <= SUMMARY_MAX_WORDS, `at most ${SUMMARY_MAX_WORDS} words`),
  })
  .strict();

export type TreasurerAnswer = z.infer<typeof treasurerAnswerSchema>;

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: "null" }] });

/** Sent as `output_config.format.schema`. Only features structured outputs supports. */
export const TREASURER_ANSWER_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["vendor", "date", "items", "totalCents", "matchesRequest", "findings", "verdict", "summary"],
  properties: {
    vendor: { ...nullable({ type: "string" }), description: "The shop's name as printed, or null if unreadable." },
    date: { ...nullable({ type: "string", format: "date" }), description: "The date printed on the receipt, YYYY-MM-DD, or null." },
    items: {
      type: "array",
      description: "Each line item as printed, with its line total in whole cents.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["description", "amountCents"],
        properties: { description: { type: "string" }, amountCents: { type: "integer" } },
      },
    },
    totalCents: { ...nullable({ type: "integer" }), description: "The receipt's total in whole cents, or null if unreadable." },
    matchesRequest: { type: "boolean", description: "True only if the total equals the amount asked for and the receipt supports the description." },
    findings: {
      type: "array",
      description: "What the receipt shows that a signer should know. At most 4.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["severity", "text", "evidence"],
        properties: {
          severity: { type: "string", enum: ["info", "warn", "stop"] },
          text: { type: "string", description: "One plain sentence." },
          evidence: { type: "string", description: "The receipt line or fact it rests on." },
        },
      },
    },
    verdict: { type: "string", enum: ["clear", "check", "stop"] },
    summary: { type: "string", description: "At most 20 words." },
  },
} as const;

export type AnswerProblem = "refusal" | "max_tokens" | "no_text" | "invalid_json" | "invalid_shape";
export type ParsedAnswer = { ok: true; answer: TreasurerAnswer } | { ok: false; problem: AnswerProblem };

/** Validates stored or recorded JSON (no message around it). */
export function parseAnswerJson(json: unknown): ParsedAnswer {
  const result = treasurerAnswerSchema.safeParse(json);
  return result.success ? { ok: true, answer: result.data } : { ok: false, problem: "invalid_shape" };
}

/** The answer in a final message: its text blocks joined, parsed as JSON, then validated. */
export function parseAnswer(message: BetaMessage): ParsedAnswer {
  if (message.stop_reason === "refusal") return { ok: false, problem: "refusal" };
  if (message.stop_reason === "max_tokens") return { ok: false, problem: "max_tokens" };
  const text = message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
  if (!text.trim()) return { ok: false, problem: "no_text" };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, problem: "invalid_json" };
  }
  return parseAnswerJson(json);
}
