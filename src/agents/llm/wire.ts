/**
 * Wire contract between the browser-side Claude adapter (AG Studio's `AgLlmAdapter`)
 * and the server route `POST /api/ai/turn`.
 *
 * Request:  JSON body `{ "request": TurnRequest }`.
 * Response: HTTP 200, `Content-Type: application/x-ndjson`, one `WireLine` per line.
 *           Zero or more `event` lines, then exactly ONE terminal line: `complete` or `error`.
 *           A stream that ends without a terminal line is a transport failure.
 * Non-200:  JSON `{ "error": WireError }` (validation, rate limit, budget, misconfiguration).
 *
 * The browser never chooses the model, token limits or provider parameters: the server fixes them.
 * Both sides import this file; change it only together with both implementations.
 */
import type { AgAiEvent, AgLlmRequest, AgLlmResponse } from "ag-studio";

export const TURN_ENDPOINT = "/api/ai/turn";
export const NDJSON_CONTENT_TYPE = "application/x-ndjson";

/** What the browser may send. `model` is deliberately excluded: the server uses a fixed model. */
export type TurnRequest = Pick<AgLlmRequest, "input" | "instructions" | "tools" | "toolChoice" | "responseFormat">;

export type WireErrorCode =
  | "bad_request" // body failed validation (shape, size, counts)
  | "rate_limited" // too many turns from this client
  | "budget_exceeded" // the server-side spend cap is used up
  | "refusal" // the model declined (stop_reason "refusal")
  | "upstream_error" // Anthropic API error
  | "misconfigured" // e.g. missing ANTHROPIC_API_KEY
  | "aborted" // the client disconnected or cancelled
  | "internal";

export interface WireError {
  code: WireErrorCode;
  message: string;
}

export type WireLine =
  | { type: "event"; event: AgAiEvent }
  | { type: "complete"; response: AgLlmResponse }
  | { type: "error"; error: WireError };

export function encodeLine(line: WireLine): string {
  return `${JSON.stringify(line)}\n`;
}

function parseLine(raw: string): WireLine {
  const value: unknown = JSON.parse(raw);
  if (typeof value !== "object" || value === null || !("type" in value)) {
    throw new Error("Malformed wire line: missing type");
  }
  const type = (value as { type: unknown }).type;
  if (type !== "event" && type !== "complete" && type !== "error") {
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
