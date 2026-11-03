import type { BetaMessageStreamParams } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { describe, expect, it } from "vitest";
import { buildMessageParams, MAX_TOKENS } from "@/agents/llm/translate-request";
import {
  costMicroUsd,
  createTurnMeter,
  IMAGE_TOKEN_ALLOWANCE,
  inputTokenBound,
  REQUEST_OVERHEAD_TOKENS,
  worstCaseMicroUsd,
} from "@/agents/llm/turn-cost";
import { turnRequest } from "./fixtures";

const byteLength = (text: string) => new TextEncoder().encode(text).byteLength;
const promptBytes = (params: BetaMessageStreamParams) =>
  byteLength(JSON.stringify({ system: params.system, messages: params.messages, tools: params.tools, tool_choice: params.tool_choice }));
const withoutFallback = (params: BetaMessageStreamParams): BetaMessageStreamParams => {
  const { fallbacks: _fallbacks, betas: _betas, ...rest } = params;
  return rest;
};

describe("costMicroUsd", () => {
  it("prices tokens in exact integer micro-dollars", () => {
    expect(costMicroUsd({ input_tokens: 1000, output_tokens: 1000 }, "claude-opus-5-5")).toBe(24_000);
    expect(costMicroUsd({ input_tokens: 1e6, output_tokens: 0, cache_read_input_tokens: 1e6, cache_creation_input_tokens: 1e6 }, "claude-opus-5-5")).toBe(
      4_000_000 + 200_000 + 5_000_000,
    );
    expect(costMicroUsd({ input_tokens: 1000, output_tokens: 1000 }, "claude-opus-4-8")).toBe(30_000);
  });

  it("rounds a fraction of a micro-dollar up, never down", () => {
    expect(costMicroUsd({ input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1 }, "claude-opus-5-5")).toBe(1);
    expect(costMicroUsd({ input_tokens: 0, output_tokens: 0 }, "claude-opus-5-5")).toBe(0);
  });
});

describe("inputTokenBound", () => {
  it("counts one token per prompt byte, plus a fixed allowance for framing and tool prompts", () => {
    const params = buildMessageParams(turnRequest("hello", { instructions: "Be brief." }), "claude-opus-5-5");
    expect(inputTokenBound(params)).toBe(promptBytes(params) + REQUEST_OVERHEAD_TOKENS);
  });

  it("counts bytes, not characters, so multi-byte text cannot slip under the bound", () => {
    const ascii = buildMessageParams(turnRequest("aaaa"), "claude-opus-5-5");
    const emoji = buildMessageParams(turnRequest("😀😀😀😀"), "claude-opus-5-5");
    expect(inputTokenBound(emoji) - inputTokenBound(ascii)).toBe(16 - 4);
  });

  it("adds an allowance per image, because a tiny image file can still cost thousands of tokens", () => {
    const request = turnRequest("look");
    request.input = [
      {
        id: "u1",
        kind: "input",
        type: "message",
        role: "user",
        status: "completed",
        content: [
          { type: "image", detail: "auto", imageUrl: "https://example.com/a.png" },
          { type: "image", detail: "auto", imageUrl: "data:image/png;base64,iVBORw0KGgo=" },
        ],
      },
    ];
    const params = buildMessageParams(request, "claude-opus-5-5");
    expect(inputTokenBound(params)).toBe(promptBytes(params) + REQUEST_OVERHEAD_TOKENS + 2 * IMAGE_TOKEN_ALLOWANCE);
  });
});

describe("worstCaseMicroUsd", () => {
  it("without a fallback: every input token at the cache-write rate, plus max_tokens of output", () => {
    const params = withoutFallback(buildMessageParams(turnRequest("hello"), "claude-opus-5-5"));
    const bound = inputTokenBound(params);
    expect(worstCaseMicroUsd(params)).toBe(Math.ceil((bound * 5_000 + MAX_TOKENS * 20_000) / 1000));
  });

  it("with fallbacks: adds one full attempt on the costliest fallback target, which also reads the partial output", () => {
    const params = buildMessageParams(turnRequest("hello"), "claude-opus-5-5");
    expect(params.fallbacks).toBe("default");
    const bound = inputTokenBound(params);
    const primary = bound * 5_000 + MAX_TOKENS * 20_000;
    const fallback = (bound + MAX_TOKENS) * 6_250 + MAX_TOKENS * 25_000;
    expect(worstCaseMicroUsd(params)).toBe(Math.ceil((primary + fallback) / 1000));
  });

  it("is about $0.87 for the smallest possible turn on the current model and limits (documents the magnitude)", () => {
    const usd = worstCaseMicroUsd(buildMessageParams(turnRequest("hello"), "claude-opus-5-5")) / 1e6;
    expect(usd).toBeGreaterThan(0.85);
    expect(usd).toBeLessThan(1.0);
  });

  it("grows with the request, so a 1 MB body reserves dollars, not cents", () => {
    const big = buildMessageParams(turnRequest("x".repeat(900_000)), "claude-opus-5-5");
    expect(worstCaseMicroUsd(big)).toBeGreaterThan(10_000_000);
  });
});

describe("createTurnMeter", () => {
  it("prices every attempt it is given and totals the tokens", () => {
    const meter = createTurnMeter();
    expect(meter.record({ input_tokens: 1000, output_tokens: 1000 }, "claude-opus-5-5")).toBeCloseTo(0.024);
    meter.record({ input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: null }, "claude-opus-4-8");
    expect(meter.costMicroUsd()).toBe(24_000 + Math.ceil((10 * 5_000 + 5 * 25_000 + 100 * 500) / 1000));
    expect(meter.getSpentUsd()).toBeCloseTo(meter.costMicroUsd() / 1e6);
    expect(meter.usage()).toEqual({ inputTokens: 1010, outputTokens: 1005, cacheReadTokens: 100, cacheWriteTokens: 0 });
  });
});
