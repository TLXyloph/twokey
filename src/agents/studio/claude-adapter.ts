/**
 * AG Studio's `AgLlmAdapter`, speaking the wire contract in `src/agents/llm/wire.ts` to this app's
 * `POST /api/ai/turn`. The server holds the Anthropic key and fixes the model, so the browser only
 * sends the turn's conversation, instructions and tool schemas (never `model`).
 *
 * Studio reads a turn as `yield* handler.stream` followed by `await handler.complete`, and takes the
 * tool calls from `complete.output`. So:
 * - `executeTurn` returns `{ stream, complete }` synchronously and starts the request straight away;
 *   events are queued as they arrive, whether or not anyone is reading the stream yet.
 * - `complete` resolves on the `complete` line, and rejects with a {@link TurnError} on an `error`
 *   line, a non-200 response, an abort, a malformed line, or a stream with no terminal line.
 * - The stream always ends when `complete` settles. It never throws: a failed turn is reported
 *   once, through `complete`, which Studio awaits as soon as the stream ends.
 */
import type { AgAiEvent, AgLlmAdapter, AgLlmExecuteTurnOptions, AgLlmRequest, AgLlmResponse, AgLlmResponseHandler } from "ag-studio";
import {
  createLineDecoder,
  NDJSON_CONTENT_TYPE,
  TURN_ENDPOINT,
  type TurnRequest,
  type WireErrorCode,
  type WireLine,
} from "@/agents/llm/wire";

export interface ClaudeAdapterOptions {
  /** Where turns are POSTed. Defaults to {@link TURN_ENDPOINT}. */
  endpoint?: string;
  /** Injectable for tests. Defaults to the browser's `fetch`, resolved when a turn starts. */
  fetch?: typeof fetch;
}

const WIRE_ERROR_CODES: readonly WireErrorCode[] = [
  "bad_request",
  "rate_limited",
  "budget_exceeded",
  "refusal",
  "upstream_error",
  "misconfigured",
  "aborted",
  "internal",
];

/** Why a turn failed. `code` is the server's {@link WireErrorCode}, or a client-side one. */
export class TurnError extends Error {
  readonly code: WireErrorCode;
  /** The HTTP status, when the server answered with a non-200. */
  readonly status?: number;

  constructor(code: WireErrorCode, message: string, options: { status?: number; cause?: unknown } = {}) {
    // Studio shows this message in the chat as the run's error, so keep it readable.
    super(`${message} (${code})`, { cause: options.cause });
    this.name = "TurnError";
    this.code = code;
    this.status = options.status;
  }
}

export function createClaudeAdapter(options: ClaudeAdapterOptions = {}): AgLlmAdapter {
  const endpoint = options.endpoint ?? TURN_ENDPOINT;
  return {
    executeTurn: (request: AgLlmRequest, turnOptions?: AgLlmExecuteTurnOptions) =>
      runTurn(endpoint, options.fetch ?? globalThis.fetch.bind(globalThis), request, turnOptions?.signal),
  };
}

/** The fields of a Studio request the wire contract allows. `model` is dropped on purpose. */
export function toTurnRequest(request: AgLlmRequest): TurnRequest {
  const { input, instructions, tools, toolChoice, responseFormat } = request;
  return {
    input,
    ...(instructions !== undefined && { instructions }),
    ...(tools !== undefined && { tools }),
    ...(toolChoice !== undefined && { toolChoice }),
    responseFormat,
  };
}

function runTurn(endpoint: string, fetchImpl: typeof fetch, request: AgLlmRequest, signal?: AbortSignal): AgLlmResponseHandler {
  const queue = createEventQueue<AgAiEvent>();
  const complete = pumpTurn({ endpoint, fetchImpl, request, signal, onEvent: queue.push }).then(
    (response) => {
      queue.close();
      return response;
    },
    (error: unknown) => {
      queue.close();
      throw toTurnError(error, signal);
    },
  );
  // A consumer that abandons the stream may never await `complete`; anyone who does still sees the
  // failure. This only stops the rejection being reported as unhandled.
  complete.catch(() => {});
  const iterator = queue.iterate();
  return { stream: { [Symbol.asyncIterator]: () => iterator }, complete };
}

interface PumpParams {
  endpoint: string;
  fetchImpl: typeof fetch;
  request: AgLlmRequest;
  signal?: AbortSignal;
  onEvent: (event: AgAiEvent) => void;
}

async function pumpTurn({ endpoint, fetchImpl, request, signal, onEvent }: PumpParams): Promise<AgLlmResponse> {
  throwIfAborted(signal);
  const response = await raceAbort(
    fetchImpl(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: NDJSON_CONTENT_TYPE },
      body: JSON.stringify({ request: toTurnRequest(request) }),
      signal,
    }),
    signal,
  );
  if (!response.ok) {
    throw await httpError(response);
  }
  if (!response.body) {
    throw new TurnError("internal", "The turn response had no body.");
  }

  const reader = response.body.getReader();
  const cancelReader = () => void reader.cancel().catch(() => {});
  signal?.addEventListener("abort", cancelReader, { once: true });
  const lines = createLineDecoder();
  const text = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await raceAbort(reader.read(), signal);
      const decoded = done ? [...lines.push(text.decode()), ...lines.flush()] : lines.push(text.decode(value, { stream: true }));
      for (const line of decoded) {
        const terminal = handleLine(line, onEvent);
        if (terminal) {
          cancelReader();
          return terminal;
        }
      }
      if (done) {
        throw new TurnError("internal", "The turn stream ended without a terminal line.");
      }
    }
  } finally {
    signal?.removeEventListener("abort", cancelReader);
  }
}

/** Queues an event line; returns the response for a `complete` line; throws for an `error` line. */
function handleLine(line: WireLine, onEvent: (event: AgAiEvent) => void): AgLlmResponse | undefined {
  switch (line.type) {
    case "event":
      if (!isObject(line.event) || typeof line.event.type !== "string") {
        throw new TurnError("internal", "Malformed event line from the server.");
      }
      onEvent(line.event);
      return undefined;
    case "complete":
      if (!isObject(line.response) || !Array.isArray(line.response.output)) {
        throw new TurnError("internal", "Malformed complete line from the server.");
      }
      return line.response;
    case "error": {
      const { code, message } = isObject(line.error) ? line.error : { code: undefined, message: undefined };
      throw new TurnError(asWireCode(code), typeof message === "string" ? message : "The turn failed.");
    }
  }
}

async function httpError(response: Response): Promise<TurnError> {
  const fallback = `The AI service answered HTTP ${response.status}.`;
  const body: unknown = await response.json().catch(() => undefined);
  const error = isObject(body) && isObject(body.error) ? body.error : undefined;
  const message = typeof error?.message === "string" && error.message ? error.message : fallback;
  return new TurnError(asWireCode(error?.code), message, { status: response.status });
}

function toTurnError(error: unknown, signal?: AbortSignal): TurnError {
  if (signal?.aborted) {
    return error instanceof TurnError && error.code === "aborted" ? error : new TurnError("aborted", "The turn was cancelled.", { cause: error });
  }
  if (error instanceof TurnError) return error;
  const message = error instanceof Error ? error.message : String(error);
  // A JSON.parse or wire-type failure from the line decoder, or a network failure from fetch.
  return new TurnError("internal", `The turn failed: ${message}`, { cause: error });
}

function asWireCode(code: unknown): WireErrorCode {
  return WIRE_ERROR_CODES.find((known) => known === code) ?? "internal";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// --- Abort plumbing ---------------------------------------------------------------------

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new TurnError("aborted", "The turn was cancelled.");
}

/** Settles with `promise`, or rejects as soon as `signal` aborts, whichever comes first. */
function raceAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new TurnError("aborted", "The turn was cancelled."));
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

// --- Event queue ------------------------------------------------------------------------

/** An unbounded single-consumer queue: `push` never blocks, the iterator waits for the next item. */
function createEventQueue<T>() {
  const buffer: T[] = [];
  let closed = false;
  let wake: (() => void) | undefined;
  const notify = () => {
    const resolve = wake;
    wake = undefined;
    resolve?.();
  };
  return {
    push(item: T): void {
      if (closed) return;
      buffer.push(item);
      notify();
    },
    close(): void {
      closed = true;
      notify();
    },
    async *iterate(): AsyncGenerator<T, void, undefined> {
      for (;;) {
        if (buffer.length > 0) {
          yield buffer.shift() as T;
          continue;
        }
        if (closed) return;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    },
  };
}
