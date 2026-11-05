/**
 * One receipt-check call to the model, metered. It never throws: a failure comes back as
 * `{ ok: false }` with the error, so the caller can settle the reservation and fall back.
 *
 * Metering follows src/agents/llm/run-turn.ts: with a server-side fallback, `usage.iterations`
 * lists every attempt with its own model, and each is charged at its own prices; a call that fails
 * mid-stream is charged at the usage the stream had reported (the existing StreamTranslator
 * tracks it).
 */
import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaFallbackMessageIterationUsage,
  BetaMessage,
  BetaMessageIterationUsage,
  BetaMessageStreamParams,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { SpendLedger, TokenUsage } from "@/agents/llm/guardrails";
import type { AnthropicLike } from "@/agents/llm/run-turn";
import { StreamTranslator } from "@/agents/llm/translate-response";

export type TreasurerCall = { ok: true; message: BetaMessage } | { ok: false; error: unknown };

type Attempt = BetaMessageIterationUsage | BetaFallbackMessageIterationUsage;

function charge(meter: SpendLedger, final: BetaMessage | undefined, partial: TokenUsage | undefined, model: string): void {
  const attempts = (final?.usage.iterations ?? []).filter(
    (entry): entry is Attempt => entry.type === "message" || entry.type === "fallback_message",
  );
  if (attempts.length > 0) {
    for (const attempt of attempts) meter.record(attempt, attempt.model ?? model);
    return;
  }
  const usage = final?.usage ?? partial;
  if (usage) meter.record(usage, final?.model ?? model);
}

export async function callTreasurer(
  client: AnthropicLike,
  params: BetaMessageStreamParams,
  meter: SpendLedger,
  signal?: AbortSignal,
): Promise<TreasurerCall> {
  const usage = new StreamTranslator();
  let final: BetaMessage | undefined;
  try {
    const stream = client.beta.messages.stream(params, signal ? { signal } : undefined);
    for await (const event of stream) usage.translate(event);
    final = await stream.finalMessage();
    return { ok: true, message: final };
  } catch (error) {
    return { ok: false, error };
  } finally {
    charge(meter, final, usage.usageSoFar(), params.model);
  }
}

/** A short, log-safe code for a failed call: the SDK's error class and HTTP status, never a message. */
export function callFailureCode(error: unknown): string {
  if (error instanceof Anthropic.RateLimitError) return "upstream_rate_limited";
  if (error instanceof Anthropic.APIError) return `upstream_${error.status ?? "error"}`;
  if (error instanceof Anthropic.AnthropicError) return "upstream_error";
  return error instanceof Error ? `error_${error.name}` : "error";
}
