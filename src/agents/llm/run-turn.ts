/**
 * Orchestrates one Claude turn: request params -> streamed Anthropic events -> `WireLine`s.
 *
 * `runTurn` always ends with exactly one terminal line (`complete` or `error`) and never throws.
 * It charges the spend ledger once per turn (including aborted and failed turns, from the usage
 * the stream had reported) and logs one line per turn: model, tokens and cost. It never logs
 * prompts, keys or headers.
 */
import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaFallbackMessageIterationUsage,
  BetaMessage,
  BetaMessageIterationUsage,
  BetaMessageStreamParams,
  BetaRawMessageStreamEvent,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { SpendLedger, TokenUsage } from "./guardrails";
import { buildMessageParams } from "./translate-request";
import { StreamTranslator, toAgLlmResponse } from "./translate-response";
import { encodeLine, type TurnRequest, type WireError, type WireLine } from "./wire";

/** The slice of a `BetaMessageStream` this module uses. */
export interface TurnStream extends AsyncIterable<BetaRawMessageStreamEvent> {
  finalMessage(): Promise<BetaMessage>;
}

/** The slice of the Anthropic client this module uses; a real `Anthropic` instance satisfies it. */
export interface AnthropicLike {
  beta: {
    messages: {
      stream(body: BetaMessageStreamParams, options?: { signal?: AbortSignal }): TurnStream;
    };
  };
}

export interface RunTurnDeps {
  client: AnthropicLike;
  ledger: SpendLedger;
  model: string;
  log?: (line: string) => void;
  now?: () => number;
}

export function createAnthropicClient(apiKey: string): AnthropicLike {
  return new Anthropic({ apiKey });
}

type Outcome = { label: string; detail?: string };

export async function* runTurn(deps: RunTurnDeps, request: TurnRequest, signal: AbortSignal): AsyncGenerator<WireLine, void, undefined> {
  if (signal.aborted) {
    yield { type: "error", error: toWireError(undefined, signal) };
    return;
  }
  const translator = new StreamTranslator();
  let final: BetaMessage | undefined;
  let outcome: Outcome = { label: "cancelled" };
  let terminal: WireLine;
  try {
    const stream = deps.client.beta.messages.stream(buildMessageParams(request, deps.model), { signal });
    for await (const event of stream) {
      for (const agEvent of translator.translate(event)) yield { type: "event", event: agEvent };
    }
    final = await stream.finalMessage();
    if (final.stop_reason === "refusal") {
      outcome = { label: "refusal", detail: final.stop_details?.category ?? undefined };
      terminal = { type: "error", error: refusalError(final) };
    } else {
      outcome = { label: "complete" };
      terminal = { type: "complete", response: toAgLlmResponse(final, deps.now) };
    }
  } catch (error) {
    const wireError = toWireError(error, signal);
    outcome = { label: wireError.code, detail: errorDetail(error) };
    terminal = { type: "error", error: wireError };
  } finally {
    // Also runs when the consumer stops reading mid-stream (the generator is returned early).
    chargeAndLog(deps, final, translator.usageSoFar(), outcome);
  }
  yield terminal;
}

function refusalError(message: BetaMessage): WireError {
  const category = message.stop_details?.category;
  return {
    code: "refusal",
    message: category ? `Claude declined this request (category: ${category}).` : "Claude declined this request.",
  };
}

/** Typed SDK classes only, most specific first; an abort wins over whatever error it caused. */
export function toWireError(error: unknown, signal: AbortSignal): WireError {
  if (signal.aborted || error instanceof Anthropic.APIUserAbortError) {
    return { code: "aborted", message: "The turn was cancelled." };
  }
  if (error instanceof Anthropic.RateLimitError) {
    return { code: "upstream_error", message: "Anthropic is rate limiting this server; try again shortly." };
  }
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return { code: "upstream_error", message: "Anthropic rejected this server's credentials." };
  }
  if (error instanceof Anthropic.BadRequestError) {
    return { code: "upstream_error", message: `Anthropic rejected the request: ${error.message.slice(0, 500)}` };
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return { code: "upstream_error", message: "Could not reach the Anthropic API." };
  }
  if (error instanceof Anthropic.APIError) {
    const status = error.status === undefined ? "" : ` (HTTP ${error.status})`;
    return { code: "upstream_error", message: `The Anthropic API returned an error${status}.` };
  }
  if (error instanceof Anthropic.AnthropicError) {
    return { code: "upstream_error", message: "The Anthropic response stream failed." };
  }
  return { code: "internal", message: "The AI turn failed on the server." };
}

/** Status and request id only: safe to log, and enough to look the failure up. */
function errorDetail(error: unknown): string | undefined {
  if (error instanceof Anthropic.APIError && error.status !== undefined) {
    return `status=${error.status} request_id=${error.requestID ?? "none"}`;
  }
  return error instanceof Error ? `error=${error.name}` : undefined;
}

type Attempt = BetaMessageIterationUsage | BetaFallbackMessageIterationUsage;

/**
 * With a server-side fallback, top-level usage covers only the attempt that answered;
 * `usage.iterations` lists every attempt with its own model, so each is charged at its own prices.
 */
function chargeAndLog(deps: RunTurnDeps, final: BetaMessage | undefined, partial: TokenUsage | undefined, outcome: Outcome): void {
  const usage: TokenUsage | undefined = final?.usage ?? partial;
  const model = final?.model ?? deps.model;
  let cost = 0;
  let ledgerFailed = false;
  try {
    const attempts = (final?.usage.iterations ?? []).filter(
      (entry): entry is Attempt => entry.type === "message" || entry.type === "fallback_message",
    );
    if (attempts.length > 0) {
      for (const attempt of attempts) cost += deps.ledger.record(attempt, attempt.model ?? deps.model);
    } else if (usage) {
      cost = deps.ledger.record(usage, model);
    }
  } catch {
    // A failing ledger must not break the turn's single terminal line; the log line flags it.
    ledgerFailed = true;
  } finally {
    const log = deps.log ?? ((line: string) => console.info(line));
    const fields = [
      `[ai/turn] outcome=${outcome.label}`,
      outcome.detail,
      ledgerFailed ? "ledger=failed" : undefined,
      `model=${model}`,
      `stop=${final?.stop_reason ?? "none"}`,
      `input=${usage?.input_tokens ?? 0}`,
      `output=${usage?.output_tokens ?? 0}`,
      `cache_read=${usage?.cache_read_input_tokens ?? 0}`,
      `cache_write=${usage?.cache_creation_input_tokens ?? 0}`,
      `cost_usd=${cost.toFixed(4)}`,
      `total_usd=${deps.ledger.getSpentUsd().toFixed(4)}`,
    ];
    log(fields.filter(Boolean).join(" "));
  }
}

const INTERNAL_LINE: WireLine = { type: "error", error: { code: "internal", message: "The AI turn failed on the server." } };

/**
 * NDJSON body for the route: one encoded line per pull. Cancelling the body (client disconnect)
 * calls `onCancel` (the route aborts the upstream request) and closes the line source.
 */
export function toNdjsonStream(lines: AsyncGenerator<WireLine, void, undefined>, onCancel: () => void = () => undefined): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await lines.next();
        if (next.done) controller.close();
        else controller.enqueue(encoder.encode(encodeLine(next.value)));
      } catch {
        // runTurn never throws, so this only guards a source that does, or a controller closed by cancel.
        try {
          controller.enqueue(encoder.encode(encodeLine(INTERNAL_LINE)));
          controller.close();
        } catch {
          // already cancelled: nobody is reading
        }
      }
    },
    cancel() {
      onCancel();
      void lines.return(undefined);
    },
  });
}
