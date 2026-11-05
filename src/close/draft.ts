/**
 * The AI's draft of the monthly close (spec §5.6): a short plain-words reconciliation summary
 * (at most 120 words) and two to four points for the Reviewer to check, written from the computed
 * figures only. It is recorded once in development (scripts/record-close-draft.sh) into
 * ./recorded-draft.json and served from there labelled "Drafted by the AI (recorded)": no judge
 * ever triggers a live call.
 *
 * Structured outputs guarantee the JSON's shape but not its limits (lengths, counts), and the
 * recording is read back from a file, so every draft is validated with zod on the way in and out.
 * The JSON schema and the zod schema list the same fields; a test checks it.
 *
 * recorded-draft.json maps a close hash to its draft, so a draft made from other figures is never
 * shown against these: `{}` means "not recorded yet".
 */
import type { BetaMessage } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";
import type { CloseDraft, CloseDraftView } from "./contracts";

export const DRAFT_SUMMARY_MAX_WORDS = 120;
export const DRAFT_MIN_POINTS = 2;
export const DRAFT_MAX_POINTS = 4;
const POINT_MAX_WORDS = 40;

const wordCount = (text: string): number => text.split(/\s+/).filter(Boolean).length;
const words = (max: number, chars: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(chars)
    .refine((text) => wordCount(text) <= max, `at most ${max} words`);

export const closeDraftSchema = z
  .object({
    summary: words(DRAFT_SUMMARY_MAX_WORDS, 1_200),
    points: z
      .array(z.object({ check: words(POINT_MAX_WORDS, 400), basis: words(POINT_MAX_WORDS, 300) }).strict())
      .min(DRAFT_MIN_POINTS)
      .max(DRAFT_MAX_POINTS),
  })
  .strict();

/** Sent as `output_config.format.schema`. Only features structured outputs supports. */
export const CLOSE_DRAFT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "points"],
  properties: {
    summary: { type: "string", description: `The reconciliation in plain words, at most ${DRAFT_SUMMARY_MAX_WORDS} words.` },
    points: {
      type: "array",
      description: `${DRAFT_MIN_POINTS} to ${DRAFT_MAX_POINTS} things the Reviewer should check before signing.`,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["check", "basis"],
        properties: {
          check: { type: "string", description: "One plain sentence: what to check, and with whom." },
          basis: { type: "string", description: "The figure from the close that it rests on." },
        },
      },
    },
  },
} as const;

export type DraftProblem = "refusal" | "max_tokens" | "no_text" | "invalid_json" | "invalid_shape";
export type ParsedDraft = { ok: true; draft: CloseDraft } | { ok: false; problem: DraftProblem };

export function parseDraftJson(json: unknown): ParsedDraft {
  const result = closeDraftSchema.safeParse(json);
  return result.success ? { ok: true, draft: result.data } : { ok: false, problem: "invalid_shape" };
}

/** The draft in a final message: its text blocks joined, parsed as JSON, then validated. */
export function parseDraftMessage(message: BetaMessage): ParsedDraft {
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
  return parseDraftJson(json);
}

// ---------------------------------------------------------------------------------------------
// recorded-draft.json
// ---------------------------------------------------------------------------------------------

const CLOSE_HASH = /^[0-9a-f]{64}$/;

const entrySchema = z
  .object({
    month: z.string().regex(/^\d{4}-\d{2}$/),
    /** Kept for people reading the file; never sent to the page. */
    model: z.string().min(1),
    recordedAt: z.iso.datetime(),
    costUsd: z.number().nonnegative(),
    draft: z.unknown(),
  })
  .strict();

export type RecordedDraftEntry = z.infer<typeof entrySchema>;

/**
 * The recorded draft for this close hash, as the page shows it. Anything missing, malformed or made
 * from other figures reads as "not recorded" (and is logged by a fixed code, never its contents).
 */
export function recordedDraftFor(json: unknown, closeHash: string, log: (line: string) => void = () => undefined): CloseDraftView {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return { state: "not_recorded" };
  const raw = (json as Record<string, unknown>)[closeHash];
  if (raw === undefined) {
    if (Object.keys(json).length > 0) log("[close/draft] recorded=stale");
    return { state: "not_recorded" };
  }
  const entry = entrySchema.safeParse(raw);
  const draft = entry.success ? parseDraftJson(entry.data.draft) : undefined;
  if (!CLOSE_HASH.test(closeHash) || !entry.success || !draft?.ok) {
    log("[close/draft] recorded=invalid");
    return { state: "not_recorded" };
  }
  return { state: "recorded", recordedAt: entry.data.recordedAt, draft: draft.draft };
}

/** recorded-draft.json's text: keys sorted, two-space indent, trailing newline. */
export function serializeRecordedDraft(entries: Readonly<Record<string, RecordedDraftEntry>>): string {
  const sorted = Object.fromEntries(Object.keys(entries).sort().map((key) => [key, entries[key]]));
  return `${JSON.stringify(sorted, null, 2)}\n`;
}
