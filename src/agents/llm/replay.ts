/**
 * Recorded answers, for when the live AI is unavailable (budget used up, or no API key).
 *
 * Every live turn that completes is recorded under its replay key (./replay-key.ts) as the NDJSON
 * it streamed, with consecutive text and tool-argument deltas joined (same events, fewer lines).
 * A replay serves that recording behind a `replay` marker line, so the browser can label it
 * (wire.ts, REPLAY_LABEL). The original token usage is dropped from the replayed response: the
 * replay itself used no tokens. When no recording matches, the turn is answered with one plain
 * message instead (`unavailableLines`), which calls no tools, so Studio's run ends there.
 */
import type { AgAiEvent, AgLlmResponse } from "ag-studio";
import type { TurnRecording } from "./ai-turn-log";
import { createLineDecoder, encodeLine, type WireLine } from "./wire";

/** D1 caps a row at about 2 MB; recordings stay well under it. */
export const MAX_RECORDING_BYTES = 1_000_000;

export type UnavailableReason = "total_budget" | "session_budget" | "off";

export const UNAVAILABLE_MESSAGES: Readonly<Record<UnavailableReason, string>> = {
  total_budget: "The live AI budget for this demo is used up. Try one of the suggested questions.",
  session_budget: "This session's share of the live AI budget is used up. Try one of the suggested questions.",
  off: "The live AI is switched off for this demo. Try one of the suggested questions.",
};

type CompleteLine = Extract<WireLine, { type: "complete" }>;

/** Joins `next` onto `last` when both are deltas of the same text message or tool call. */
function joined(last: AgAiEvent | undefined, next: AgAiEvent): AgAiEvent | undefined {
  if (last?.type === "TEXT_MESSAGE_CONTENT" && next.type === "TEXT_MESSAGE_CONTENT" && last.messageId === next.messageId) {
    return { ...last, delta: last.delta + next.delta };
  }
  if (last?.type === "TOOL_CALL_ARGS" && next.type === "TOOL_CALL_ARGS" && last.toolCallId === next.toolCallId) {
    return { ...last, delta: last.delta + next.delta };
  }
  return undefined;
}

export interface RecordingBuffer {
  add(line: WireLine): void;
  /** The recording's NDJSON, or undefined when it would be too large to store. */
  finish(complete: CompleteLine): string | undefined;
}

export function createRecordingBuffer(): RecordingBuffer {
  const events: AgAiEvent[] = [];
  return {
    add(line) {
      if (line.type !== "event") return;
      const merged = joined(events.at(-1), line.event);
      if (merged) events[events.length - 1] = merged;
      else events.push(line.event);
    },
    finish(complete) {
      const ndjson = [...events.map((event) => encodeLine({ type: "event", event })), encodeLine(complete)].join("");
      return new TextEncoder().encode(ndjson).byteLength <= MAX_RECORDING_BYTES ? ndjson : undefined;
    },
  };
}

/** The lines to stream for a recording. Throws on a recording that is not events then one complete. */
export function replayLines(recording: TurnRecording): WireLine[] {
  let lines: WireLine[];
  try {
    const decoder = createLineDecoder();
    lines = [...decoder.push(recording.ndjson), ...decoder.flush()];
  } catch {
    throw new Error("Corrupt recording: not NDJSON wire lines");
  }
  const last = lines.at(-1);
  const body = lines.slice(0, -1);
  if (last?.type !== "complete" || body.some((line) => line.type !== "event")) {
    throw new Error("Corrupt recording: expected event lines then one complete line");
  }
  const { usage: _usage, ...response } = last.response;
  return [{ type: "replay", replay: { recordedAt: recording.recordedAt } }, ...body, { type: "complete", response }];
}

export function unavailableLines(reason: UnavailableReason, turnId: string, now: () => number = Date.now): WireLine[] {
  const id = `twokey-unavailable-${turnId}`;
  const text = UNAVAILABLE_MESSAGES[reason];
  const response: AgLlmResponse = {
    id,
    createdAt: now(),
    status: "completed",
    output: [{ id, kind: "output", type: "message", role: "assistant", status: "completed", content: [{ type: "text", text, annotations: [] }] }],
  };
  return [
    { type: "event", event: { type: "TEXT_MESSAGE_START", messageId: id, role: "assistant" } },
    { type: "event", event: { type: "TEXT_MESSAGE_CONTENT", messageId: id, delta: text } },
    { type: "event", event: { type: "TEXT_MESSAGE_END", messageId: id } },
    { type: "complete", response },
  ];
}
