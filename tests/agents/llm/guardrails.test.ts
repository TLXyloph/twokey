import { describe, expect, it } from "vitest";
import {
  budgetUsd,
  checkAdmission,
  clientKey,
  costUsd,
  createInMemorySpendLedger,
  createRateLimiter,
  LIMITS,
  parseTurnBody,
  readBodyText,
  type RateLimiter,
  type SpendLedger,
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

describe("clientKey", () => {
  it("uses the first x-forwarded-for address, else 'local'", () => {
    expect(clientKey(new Headers({ "x-forwarded-for": " 203.0.113.9 , 10.0.0.1" }))).toBe("203.0.113.9");
    expect(clientKey(new Headers())).toBe("local");
    expect(clientKey(new Headers({ "x-forwarded-for": " , " }))).toBe("local");
  });
});

describe("createRateLimiter", () => {
  it("allows 20 turns per minute per key, then refuses until the window slides", () => {
    let now = 0;
    const limiter = createRateLimiter({ now: () => now });
    for (let i = 0; i < 20; i++) expect(limiter.take("a")).toBe(true);
    expect(limiter.take("a")).toBe(false);
    expect(limiter.take("b")).toBe(true);
    now = 59_999;
    expect(limiter.take("a")).toBe(false);
    now = 60_001;
    expect(limiter.take("a")).toBe(true);
  });

  it("bounds the number of keys it remembers", () => {
    const limiter = createRateLimiter({ limit: 1, maxKeys: 2 });
    expect(limiter.take("a")).toBe(true);
    expect(limiter.take("b")).toBe(true);
    expect(limiter.take("c")).toBe(true);
    expect(limiter.take("a")).toBe(true);
  });
});

describe("spend ledger", () => {
  it("prices Opus 5.5 and Sonnet 5.5 per million tokens", () => {
    const million = { input_tokens: 1e6, output_tokens: 1e6, cache_read_input_tokens: 1e6, cache_creation_input_tokens: 1e6 };
    expect(costUsd(million, "claude-opus-5-5")).toBeCloseTo(4 + 20 + 0.2 + 5);
    expect(costUsd(million, "claude-sonnet-5-5")).toBeCloseTo(2 + 10 + 0.2 + 2.5);
    expect(costUsd({ input_tokens: 1e6, output_tokens: 0 }, "claude-unknown-9")).toBeCloseTo(4);
  });

  it("keeps a running total and returns each turn's cost", () => {
    const ledger = createInMemorySpendLedger();
    expect(ledger.getSpentUsd()).toBe(0);
    expect(ledger.record({ input_tokens: 1000, output_tokens: 1000 }, "claude-opus-5-5")).toBeCloseTo(0.024);
    ledger.record({ input_tokens: 1000, output_tokens: 0, cache_read_input_tokens: null }, "claude-opus-5-5");
    expect(ledger.getSpentUsd()).toBeCloseTo(0.028);
  });

  it("reads the cap from TWOKEY_AI_BUDGET_USD, defaulting to $5", () => {
    expect(budgetUsd({})).toBe(5);
    expect(budgetUsd({ TWOKEY_AI_BUDGET_USD: "12.5" })).toBe(12.5);
    expect(budgetUsd({ TWOKEY_AI_BUDGET_USD: "0" })).toBe(0);
    expect(budgetUsd({ TWOKEY_AI_BUDGET_USD: "lots" })).toBe(5);
    expect(budgetUsd({ TWOKEY_AI_BUDGET_USD: "-1" })).toBe(5);
  });
});

describe("checkAdmission", () => {
  const limiter = (allow: boolean): RateLimiter => ({ take: () => allow });
  const ledger = (spent: number): SpendLedger => ({ getSpentUsd: () => spent, record: () => 0 });
  const base = { apiKey: "sk-test", clientKey: "local", limiter: limiter(true), ledger: ledger(0), budgetUsd: 5 };

  const refused = (status: number, code: string) => ({ ok: false, rejection: { status, error: { code } } });

  it("admits a configured, in-limit, in-budget turn and hands back the key", () => {
    expect(checkAdmission(base)).toEqual({ ok: true, value: "sk-test" });
  });

  it("refuses with 503 when the API key is missing", () => {
    expect(checkAdmission({ ...base, apiKey: undefined })).toMatchObject(refused(503, "misconfigured"));
    expect(checkAdmission({ ...base, apiKey: "" })).toMatchObject(refused(503, "misconfigured"));
  });

  it("refuses with 429 when the client is over its rate", () => {
    expect(checkAdmission({ ...base, limiter: limiter(false) })).toMatchObject(refused(429, "rate_limited"));
  });

  it("refuses with 402 once the spend cap is reached", () => {
    expect(checkAdmission({ ...base, ledger: ledger(5) })).toMatchObject(refused(402, "budget_exceeded"));
    expect(checkAdmission({ ...base, ledger: ledger(4.99) })).toMatchObject({ ok: true });
  });
});
