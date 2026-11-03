/**
 * Wire contract between the browser-side Claude adapter (AG Studio's `AgLlmAdapter`)
 * and the server routes `POST /api/ai/session` and `POST /api/ai/turn`.
 *
 * Session: `POST /api/ai/session` (same origin, no body) sets the HttpOnly judge-session cookie.
 *          The turn route refuses a request without a valid one (401 `no_session`).
 * Request:  JSON body `{ "request": TurnRequest }`.
 * Response: HTTP 200, `Content-Type: application/x-ndjson`, one `WireLine` per line.
 *           A replayed answer starts with ONE `replay` line. Then zero or more `event` lines, then
 *           exactly ONE terminal line: `complete` or `error`.
 *           A stream that ends without a terminal line is a transport failure.
 * Non-200:  JSON `{ "error": WireError }` (origin, session, validation, rate limit, misconfiguration).
 *           A used-up budget is not an error: it is answered with a replay or one plain message.
 *
 * The browser never chooses the model, token limits or provider parameters: the server fixes them.
 * Both sides import this file; change it only together with both implementations.
 */
import type { AgAiEvent, AgLlmRequest, AgLlmResponse } from "ag-studio";

export const TURN_ENDPOINT = "/api/ai/turn";
export const SESSION_ENDPOINT = "/api/ai/session";
export const NDJSON_CONTENT_TYPE = "application/x-ndjson";

/**
 * Shown in the AI panel ahead of a replayed answer's text. The adapter adds it to the streamed
 * text only, and the server strips it from assistant history, so it never reaches the model or the
 * replay key. Markdown bold: Studio's chat renders `**...**` as strong text.
 */
export const REPLAY_LABEL = "**Replay of a recorded answer.**\n\n";

/** What the browser may send. `model` is deliberately excluded: the server uses a fixed model. */
export type TurnRequest = Pick<AgLlmRequest, "input" | "instructions" | "tools" | "toolChoice" | "responseFormat">;

export type WireErrorCode =
  | "bad_request" // body failed validation (shape, size, counts)
  | "forbidden" // the request did not come from this site (Origin / Sec-Fetch-Site)
  | "no_session" // no valid judge-session cookie: POST the session endpoint, then retry
  | "rate_limited" // too many turns from this session, or too many new sessions from this IP
  | "refusal" // the model declined (stop_reason "refusal")
  | "upstream_error" // Anthropic API error
  | "misconfigured" // e.g. missing TWOKEY_SESSION_SECRET or the DB binding
  | "aborted" // the client disconnected or cancelled
  | "internal";

export interface WireError {
  code: WireErrorCode;
  message: string;
}

/** Marks a stream as a recording of an earlier live answer, not a live model call. */
export interface ReplayInfo {
  /** When the recorded answer was produced (milliseconds since epoch). */
  recordedAt: number;
}

export type WireLine =
  | { type: "replay"; replay: ReplayInfo }
  | { type: "event"; event: AgAiEvent }
  | { type: "complete"; response: AgLlmResponse }
  | { type: "error"; error: WireError };

const LINE_TYPES: ReadonlySet<unknown> = new Set(["replay", "event", "complete", "error"]);

export function encodeLine(line: WireLine): string {
  return `${JSON.stringify(line)}\n`;
}

function parseLine(raw: string): WireLine {
  const value: unknown = JSON.parse(raw);
  if (typeof value !== "object" || value === null || !("type" in value)) {
    throw new Error("Malformed wire line: missing type");
  }
  const type = (value as { type: unknown }).type;
  if (!LINE_TYPES.has(type)) {
    throw new Error(`Malformed wire line: unknown type ${String(type)}`);
  }
  return value as WireLine;
}

/** Incremental NDJSON decoder: push text chunks as they arrive, get back every complete line. */
export function createLineDecoder(): { push(chunk: string): WireLine[]; flush(): WireLine[] } {
  let buffer = "";
  const drain = (final: boolean): WireLine[] => {
    const lines: WireLine[] = [];
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const raw = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (raw) lines.push(parseLine(raw));
      newline = buffer.indexOf("\n");
    }
    if (final && buffer.trim()) {
      lines.push(parseLine(buffer.trim()));
      buffer = "";
    }
    return lines;
  };
  return { push: (chunk) => ((buffer += chunk), drain(false)), flush: () => drain(true) };
}
