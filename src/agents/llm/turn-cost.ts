/**
 * What one AI turn costs, in whole micro-dollars (1 USD = 1,000,000): the actual cost from the
 * usage the API reports, and the worst case reserved before the call.
 *
 * The worst case must bound anything the call can bill, or the cap is not hard:
 * - Output: `max_tokens` is a hard cap on thinking plus text (claude-api skill), priced at the
 *   model's output rate.
 * - Input: one token per UTF-8 byte of the prompt (system, messages, tools, tool choice) - a token
 *   always spans at least one byte - plus a fixed allowance for message framing and the tool-use
 *   prompt, plus an allowance per image (a tiny file can still be a large image). Every input
 *   token is priced at the costlier of the input and cache-write rates, since automatic caching
 *   may write the whole prompt.
 * - Fallback: with `fallbacks` set, a declined attempt is billed up to where it stopped and the
 *   server retries once on a fallback model, which also reads the partial text. So one more full
 *   attempt is added, priced at the costliest permitted target (Opus 5 / Opus 4.8, $5/$25).
 *
 * The bound is loose by design (real Studio turns cost cents); see the open questions in the
 * hand-over report for the levers that tighten it.
 */
import type { BetaMessageStreamParams } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { createInMemorySpendLedger, priceFor, type ModelPrice, type SpendLedger, type TokenUsage } from "./guardrails";

export const REQUEST_OVERHEAD_TOKENS = 4096;
export const IMAGE_TOKEN_ALLOWANCE = 10_000;
/** Claude Opus 5.5's permitted server-side fallback targets (claude-api skill, 2026-10-06). */
export const FALLBACK_MODELS = ["claude-opus-5", "claude-opus-4-8"] as const;

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/** USD per million tokens equals micro-dollars per token; x1000 makes it whole nano-dollars. */
const nanoPerToken = (usdPerMTok: number): number => Math.round(usdPerMTok * 1000);
const nanoToMicro = (nano: number): number => Math.ceil(nano / 1000);

export function costMicroUsd(usage: TokenUsage, model: string): number {
  const price = priceFor(model);
  const nano =
    usage.input_tokens * nanoPerToken(price.input) +
    usage.output_tokens * nanoPerToken(price.output) +
    (usage.cache_read_input_tokens ?? 0) * nanoPerToken(price.cacheRead) +
    (usage.cache_creation_input_tokens ?? 0) * nanoPerToken(price.cacheWrite);
  return nanoToMicro(nano);
}

function countImages(value: unknown): number {
  if (Array.isArray(value)) return value.reduce((sum: number, item) => sum + countImages(item), 0);
  if (typeof value !== "object" || value === null) return 0;
  const own = (value as { type?: unknown }).type === "image" ? 1 : 0;
  return own + Object.values(value).reduce((sum: number, item) => sum + countImages(item), 0);
}

/** An upper bound on the prompt's input tokens. */
export function inputTokenBound(params: BetaMessageStreamParams): number {
  const prompt = { system: params.system, messages: params.messages, tools: params.tools, tool_choice: params.tool_choice };
  const bytes = new TextEncoder().encode(JSON.stringify(prompt)).byteLength;
  return bytes + REQUEST_OVERHEAD_TOKENS + countImages(params.messages) * IMAGE_TOKEN_ALLOWANCE;
}

const maxInputNano = (price: ModelPrice): number => Math.max(nanoPerToken(price.input), nanoPerToken(price.cacheWrite));

export function worstCaseMicroUsd(params: BetaMessageStreamParams): number {
  const inputBound = inputTokenBound(params);
  const outputBound = params.max_tokens;
  const primary = priceFor(params.model);
  let nano = inputBound * maxInputNano(primary) + outputBound * nanoPerToken(primary.output);
  if (params.fallbacks !== undefined && params.fallbacks !== null) {
    const targets = FALLBACK_MODELS.map((model) => priceFor(model));
    const inputRate = Math.max(...targets.map(maxInputNano));
    const outputRate = Math.max(...targets.map((price) => nanoPerToken(price.output)));
    nano += (inputBound + outputBound) * inputRate + outputBound * outputRate;
  }
  return nanoToMicro(nano);
}

/** The spend ledger `runTurn` charges, scoped to one turn: it prices each attempt and totals it. */
export interface TurnMeter extends SpendLedger {
  costMicroUsd(): number;
  usage(): UsageTotals;
}

export function createTurnMeter(): TurnMeter {
  const usd = createInMemorySpendLedger();
  let micro = 0;
  const totals: UsageTotals = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  return {
    record(usage, model) {
      micro += costMicroUsd(usage, model);
      totals.inputTokens += usage.input_tokens;
      totals.outputTokens += usage.output_tokens;
      totals.cacheReadTokens += usage.cache_read_input_tokens ?? 0;
      totals.cacheWriteTokens += usage.cache_creation_input_tokens ?? 0;
      return usd.record(usage, model);
    },
    getSpentUsd: () => micro / 1e6,
    costMicroUsd: () => micro,
    usage: () => ({ ...totals }),
  };
}
