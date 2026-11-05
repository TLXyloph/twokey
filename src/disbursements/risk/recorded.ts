/**
 * Stored AI answers, in two places:
 *
 * - recorded-cards.json (committed): the answers for the seeded requests, made once in development
 *   by scripts/record-seed-risk-cards.sh. Keyed by replay key. A card served from it is "recorded":
 *   no call, no reservation.
 * - the AI route's recordings store (D1 `ai_turn_recordings`, shared with /api/ai/turn): every live
 *   answer that validated, under its replay key. Served as "replay" when the live AI is unavailable.
 *   The row's text column holds `{"kind": RISK_RECORDING_KIND, "answer": ...}`; a chat turn's key is
 *   a hash of a different prompt, so the two never share a key, and the kind marks it anyway.
 *
 * Both are validated on the way out; an entry that doesn't validate is treated as missing.
 */
import { z } from "zod";
import { parseAnswerJson, type TreasurerAnswer } from "@/agents/treasurer/answer";

export const RISK_RECORDING_KIND = "twokey-risk-answer-v1";
const REPLAY_KEY = /^[0-9a-f]{64}$/;

export interface RecordedCard {
  model: string;
  /** ISO time the answer was recorded. */
  recordedAt: string;
  answer: TreasurerAnswer;
}

export type RecordedCards = ReadonlyMap<string, RecordedCard>;

const entrySchema = z
  .object({
    /** Which seeded request it is, for people reading the file. */
    label: z.string(),
    model: z.string().min(1),
    recordedAt: z.iso.datetime(),
    costUsd: z.number().nonnegative(),
    answer: z.unknown(),
  })
  .strict();

export type RecordedCardEntry = z.infer<typeof entrySchema>;

/** The committed file's entries that validate; the rest are logged by key and skipped. */
export function loadRecordedCards(json: unknown, log: (line: string) => void = () => undefined): RecordedCards {
  const cards = new Map<string, RecordedCard>();
  if (typeof json !== "object" || json === null || Array.isArray(json)) return cards;
  for (const [key, value] of Object.entries(json)) {
    const entry = entrySchema.safeParse(value);
    const answer = entry.success ? parseAnswerJson(entry.data.answer) : undefined;
    if (!REPLAY_KEY.test(key) || !entry.success || !answer?.ok) {
      log(`[risk/ai] recorded=skipped key=${key.slice(0, 12)}`);
      continue;
    }
    cards.set(key, { model: entry.data.model, recordedAt: entry.data.recordedAt, answer: answer.answer });
  }
  return cards;
}

export function encodeRiskRecording(answer: TreasurerAnswer): string {
  return JSON.stringify({ kind: RISK_RECORDING_KIND, answer });
}

/** The answer in a recordings-store row, or null if the row isn't a valid risk answer. */
export function decodeRiskRecording(text: string): TreasurerAnswer | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof json !== "object" || json === null || (json as { kind?: unknown }).kind !== RISK_RECORDING_KIND) return null;
  const parsed = parseAnswerJson((json as { answer?: unknown }).answer);
  return parsed.ok ? parsed.answer : null;
}
