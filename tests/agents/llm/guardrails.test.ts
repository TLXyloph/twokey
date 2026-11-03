import { describe, expect, it } from "vitest";
import {
  costUsd,
  createInMemorySpendLedger,
  LIMITS,
  parseTurnBody,
  priceFor,
  PRICES_PER_MTOK,
  readBodyText,
} from "@/agents/llm/guardrails";
import { turnRequest, userMessage } from "./fixtures";

const body = (request: unknown): string => JSON.stringify({ request });
const expectBadRequest = (text: string, pattern?: RegExp) => {
  const result = parseTurnBody(text);
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.rejection.status).toBe(400);
  expect(result.rejection.error.code).toBe("bad_request");
  if (pattern) expect(result.rejection.error.message).toMatch(pattern);
};
const tool = (name: string, parameters: Record<string, unknown> = { type: "object" }) => ({
  name,
  description: `${name} tool`,
  parameters,
});

describe("parseTurnBody", () => {
  it("accepts a valid body", () => {
    const request = turnRequest("hi", { instructions: "be brief", tools: [tool("lookup")], toolChoice: { name: "lookup" } });
    const result = parseTurnBody(body(request));
    expect(result).toEqual({ ok: true, value: request });
  });

  it("drops fields the client may not set, such as a model choice or a provider tool declaration", () => {
    const result = parseTurnBody(
      body({
        ...turnRequest(),
        model: { id: "claude-haiku-4-5" },
        tools: [{ ...tool("search"), kind: "provided", provider: { type: "web_search_20260209" } }],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect("model" in result.value).toBe(false);
    expect(result.value.tools?.[0]).toEqual({ ...tool("search"), kind: "provided" });
  });

  it("normalises developer messages to system and never forwards reasoning content", () => {
    const developer = { ...userMessage("rules"), role: "developer" };
    const reasoning = { id: "r", kind: "output", type: "reasoning", summary: [], content: [{ type: "text", text: "secret" }] };
    const result = parseTurnBody(body({ ...turnRequest(), input: [developer, reasoning, userMessage("hi")] }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.input[0]).toMatchObject({ role: "system" });
    expect(JSON.stringify(result.value)).not.toContain("secret");
  });

  it("rejects malformed JSON and wrong shapes", () => {
    expectBadRequest("{not json", /JSON/);
    expectBadRequest(JSON.stringify({ input: [] }));
    expectBadRequest(body({ input: [{ type: "mystery" }], responseFormat: { type: "text" } }));
    expectBadRequest(body({ input: [userMessage("hi")] }));
    expectBadRequest(body({ ...turnRequest(), toolChoice: "always" }));
  });

  it("limits the number of input items", () => {
    const input = Array.from({ length: LIMITS.maxInputItems + 1 }, (_, i) => userMessage(`m${i}`));
    expectBadRequest(body({ ...turnRequest(), input }), /input/);
    const ok = parseTurnBody(body({ ...turnRequest(), input: input.slice(1) }));
    expect(ok.ok).toBe(true);
  });

  it("limits the number of tools and their total schema size", () => {
    const many = Array.from({ length: LIMITS.maxTools + 1 }, (_, i) => tool(`t${i}`));
    expectBadRequest(body({ ...turnRequest(), tools: many }), /tools/);
    const big = tool("big", { type: "object", description: "x".repeat(LIMITS.maxToolSchemaBytes) });
    expectBadRequest(body({ ...turnRequest(), tools: [big] }), /schema/i);
  });

  it("limits instructions to 100 KB", () => {
    expectBadRequest(body({ ...turnRequest(), instructions: "x".repeat(LIMITS.maxInstructionsBytes + 1) }), /instructions/);
  });

  it("rejects absurdly nested schemas", () => {
    let nested: Record<string, unknown> = { type: "string" };
    for (let i = 0; i < LIMITS.maxSchemaDepth + 5; i++) nested = { type: "object", properties: { a: nested } };
    expectBadRequest(body({ ...turnRequest(), tools: [tool("deep", nested)] }), /nested/);
  });
});

describe("readBodyText", () => {
  const post = (text: string, headers: Record<string, string> = {}) =>
    new Request("http://localhost/api/ai/turn", { method: "POST", body: text, headers });

  it("returns the body when it is within the limit", async () => {
    expect(await readBodyText(post("hello"), 10)).toEqual({ ok: true, value: "hello" });
  });

  it("rejects a body over the limit while streaming it", async () => {
    const result = await readBodyText(post("x".repeat(11)), 10);
    expect(result).toMatchObject({ ok: false, rejection: { status: 400, error: { code: "bad_request" } } });
  });

  it("rejects a declared Content-Length over the limit before reading", async () => {
    const result = await readBodyText(post("tiny", { "content-length": String(LIMITS.maxBodyBytes + 1) }));
    expect(result).toMatchObject({ ok: false, rejection: { status: 400 } });
  });

  it("defaults the limit to 1 MB", () => {
    expect(LIMITS.maxBodyBytes).toBe(1024 * 1024);
  });
});

describe("spend ledger", () => {
  it("prices Opus 5.5 and Sonnet 5.5 per million tokens", () => {
    const million = { input_tokens: 1e6, output_tokens: 1e6, cache_read_input_tokens: 1e6, cache_creation_input_tokens: 1e6 };
    expect(costUsd(million, "claude-opus-5-5")).toBeCloseTo(4 + 20 + 0.2 + 5);
    expect(costUsd(million, "claude-sonnet-5-5")).toBeCloseTo(2 + 10 + 0.2 + 2.5);
    expect(costUsd({ input_tokens: 1e6, output_tokens: 0 }, "claude-unknown-9")).toBeCloseTo(4);
  });

  it("prices Opus 5.5's server-side fallback targets at their own, higher rates", () => {
    const million = { input_tokens: 1e6, output_tokens: 1e6, cache_read_input_tokens: 1e6, cache_creation_input_tokens: 1e6 };
    expect(costUsd(million, "claude-opus-4-8")).toBeCloseTo(5 + 25 + 0.5 + 6.25);
    expect(costUsd(million, "claude-opus-5")).toBeCloseTo(5 + 25 + 0.5 + 6.25);
  });

  it("matches a model exactly before any prefix, so claude-opus-5 never prices claude-opus-5-5", () => {
    expect(priceFor("claude-opus-5-5")).toEqual(PRICES_PER_MTOK["claude-opus-5-5"]);
    expect(priceFor("claude-opus-5")).toEqual(PRICES_PER_MTOK["claude-opus-5"]);
    expect(priceFor("claude-opus-5-5-20261101")).toEqual(PRICES_PER_MTOK["claude-opus-5-5"]);
  });

  it("keeps a running total and returns each turn's cost", () => {
    const ledger = createInMemorySpendLedger();
    expect(ledger.getSpentUsd()).toBe(0);
    expect(ledger.record({ input_tokens: 1000, output_tokens: 1000 }, "claude-opus-5-5")).toBeCloseTo(0.024);
    ledger.record({ input_tokens: 1000, output_tokens: 0, cache_read_input_tokens: null }, "claude-opus-5-5");
    expect(ledger.getSpentUsd()).toBeCloseTo(0.028);
  });

});
