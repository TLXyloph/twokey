import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { createTurnMeter } from "@/agents/llm/turn-cost";
import { callFailureCode, callTreasurer } from "@/agents/treasurer/call";
import { buildTreasurerParams } from "@/agents/treasurer/prompt";
import { fakeClient, fakeStream, message, textBlock, usage } from "../llm/fixtures";
import { paintFacts } from "./fixtures";

const params = buildTreasurerParams(paintFacts(), { mediaType: "image/png", base64: "AAAA" }, "claude-opus-5-5");

describe("callTreasurer", () => {
  it("sends the params unchanged, returns the final message and meters it at the model's prices", async () => {
    const final = message([textBlock("{}")], "end_turn", { usage: usage({ input_tokens: 2000, output_tokens: 500 }) });
    const client = fakeClient(fakeStream(final));
    const meter = createTurnMeter();
    const signal = new AbortController().signal;
    await expect(callTreasurer(client, params, meter, signal)).resolves.toEqual({ ok: true, message: final });
    expect(client.calls).toEqual([{ body: params, signal }]);
    // 2000 x $4/M + 500 x $20/M = $0.018
    expect(meter.costMicroUsd()).toBe(18_000);
    expect(meter.usage()).toMatchObject({ inputTokens: 2000, outputTokens: 500 });
  });

  it("charges each attempt of a server-side fallback at its own model's prices", async () => {
    const final = message([textBlock("{}")], "end_turn", {
      model: "claude-opus-4-8",
      usage: usage({
        input_tokens: 1000,
        output_tokens: 100,
        iterations: [
          { type: "message", model: "claude-opus-5-5", input_tokens: 1000, output_tokens: 50, cache_creation: null, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          { type: "fallback_message", model: "claude-opus-4-8", input_tokens: 1000, output_tokens: 100, cache_creation: null, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        ] as never,
      }),
    });
    const meter = createTurnMeter();
    await callTreasurer(fakeClient(fakeStream(final)), params, meter);
    // Opus 5.5: 1000 x 4 + 50 x 20 = 5000; Opus 4.8: 1000 x 5 + 100 x 25 = 7500 (micro-dollars)
    expect(meter.costMicroUsd()).toBe(12_500);
  });

  it("returns a failure instead of throwing, charging the usage the stream had reported", async () => {
    const error = new Anthropic.APIConnectionError({ message: "socket hang up" });
    const final = message([textBlock("{}")], "end_turn", { usage: usage({ input_tokens: 1500, output_tokens: 1 }) });
    const meter = createTurnMeter();
    const result = await callTreasurer(fakeClient(fakeStream(final, { failAfter: { count: 1, error } })), params, meter);
    expect(result).toEqual({ ok: false, error });
    // Only message_start arrived; the fixtures' message_start reports 100 input and 1 output token.
    expect(meter.costMicroUsd()).toBe(100 * 4 + 1 * 20);
  });

  it("charges nothing when the request never started", async () => {
    const meter = createTurnMeter();
    const client = fakeClient();
    const result = await callTreasurer(client, params, meter);
    expect(result.ok).toBe(false);
    expect(meter.costMicroUsd()).toBe(0);
  });
});

describe("callFailureCode", () => {
  it("names the failure by SDK class and status only", () => {
    const headers = new Headers();
    expect(callFailureCode(new Anthropic.RateLimitError(429, undefined, "slow down", headers))).toBe("upstream_rate_limited");
    expect(callFailureCode(new Anthropic.InternalServerError(529, undefined, "overloaded", headers))).toBe("upstream_529");
    expect(callFailureCode(new TypeError("boom"))).toBe("error_TypeError");
    expect(callFailureCode("odd")).toBe("error");
  });
});
