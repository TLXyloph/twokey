import Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLineDecoder, NDJSON_CONTENT_TYPE, type WireLine } from "@/agents/llm/wire";
import { fakeClient, fakeStream, hangingStream, message, textBlock, turnRequest, type FakeClient } from "./fixtures";

// The only seam replaced: the factory that would build a real Anthropic client. No network.
const mocks = vi.hoisted(() => ({ client: undefined as FakeClient | undefined, created: 0 }));
vi.mock("@/agents/llm/run-turn", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/agents/llm/run-turn")>();
  return {
    ...actual,
    createAnthropicClient: () => {
      mocks.created += 1;
      if (!mocks.client) throw new Error("test did not provide a client");
      return mocks.client;
    },
  };
});

const loadPost = async () => (await import("@/app/api/ai/turn/route")).POST;
const post = (body: unknown, init: { ip?: string; signal?: AbortSignal; raw?: string } = {}) =>
  new Request("http://localhost/api/ai/turn", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": init.ip ?? "198.51.100.7" },
    body: init.raw ?? JSON.stringify(body),
    signal: init.signal,
  });
const validBody = () => ({ request: turnRequest("hello") });
const readLines = async (response: Response): Promise<WireLine[]> => {
  const decoder = createLineDecoder();
  return [...decoder.push(await response.text()), ...decoder.flush()];
};
const terminals = (lines: WireLine[]) => lines.filter((line) => line.type !== "event");

beforeEach(() => {
  vi.resetModules();
  mocks.client = undefined;
  mocks.created = 0;
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key-not-real");
  vi.stubEnv("TWOKEY_AI_BUDGET_USD", "");
  vi.stubEnv("TWOKEY_AI_MODEL", "");
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/ai/turn", () => {
  it("streams NDJSON that ends in exactly one terminal line, on the server's model", async () => {
    mocks.client = fakeClient(fakeStream(message([textBlock("Hello")])));
    const POST = await loadPost();
    const response = await POST(post({ request: { ...turnRequest(), model: { id: "claude-haiku-4-5" } } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(NDJSON_CONTENT_TYPE);
    const lines = await readLines(response);
    expect(terminals(lines)).toHaveLength(1);
    expect(lines.at(-1)).toMatchObject({ type: "complete", response: { id: "msg_1" } });
    expect(lines.slice(0, -1).every((line) => line.type === "event")).toBe(true);
    expect(mocks.client.calls[0]?.body.model).toBe("claude-opus-5-5");
  });

  it("ends a stream that fails upstream with exactly one error line", async () => {
    const error = new Anthropic.RateLimitError(429, { type: "error" }, "slow down", new Headers());
    mocks.client = fakeClient(fakeStream(message([textBlock("Hello")]), { failAfter: { count: 3, error } }));
    const POST = await loadPost();
    const lines = await readLines(await POST(post(validBody())));
    expect(terminals(lines)).toEqual([{ type: "error", error: { code: "upstream_error", message: expect.any(String) } }]);
    expect(lines.at(-1)?.type).toBe("error");
  });

  it("returns 503 misconfigured when ANTHROPIC_API_KEY is missing, without building a client", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const POST = await loadPost();
    const response = await POST(post(validBody()));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: "misconfigured", message: expect.any(String) } });
    expect(mocks.created).toBe(0);
  });

  it("returns 400 bad_request for an invalid or oversized body", async () => {
    const POST = await loadPost();
    const invalid = await POST(post(undefined, { raw: "{" }));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: { code: "bad_request" } });
    const huge = await POST(post(undefined, { raw: "x".repeat(1024 * 1024 + 1) }));
    expect(huge.status).toBe(400);
    expect(mocks.created).toBe(0);
  });

  it("returns 429 rate_limited after 20 turns a minute from one client", async () => {
    const POST = await loadPost();
    for (let i = 0; i < 20; i++) expect((await POST(post(undefined, { raw: "{" }))).status).toBe(400);
    const limited = await POST(post(undefined, { raw: "{" }));
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ error: { code: "rate_limited" } });
    expect((await POST(post(undefined, { raw: "{", ip: "203.0.113.50" }))).status).toBe(400);
  });

  it("returns 402 budget_exceeded once the spend cap is used up", async () => {
    vi.stubEnv("TWOKEY_AI_BUDGET_USD", "0.000001");
    mocks.client = fakeClient(fakeStream(message([textBlock("Hello")])));
    const POST = await loadPost();
    const first = await POST(post(validBody()));
    expect(first.status).toBe(200);
    await first.text();
    const second = await POST(post(validBody()));
    expect(second.status).toBe(402);
    expect(await second.json()).toMatchObject({ error: { code: "budget_exceeded" } });
    expect(mocks.client.calls).toHaveLength(1);
  });

  it("aborts the upstream call when the client disconnects, still ending with one terminal line", async () => {
    let hung = false;
    mocks.client = fakeClient((signal) => hangingStream(signal, new Anthropic.APIUserAbortError(), () => (hung = true)));
    const POST = await loadPost();
    const disconnect = new AbortController();
    const response = await POST(post(validBody(), { signal: disconnect.signal }));
    const pending = readLines(response);
    await vi.waitFor(() => expect(hung).toBe(true));
    disconnect.abort();
    const lines = await pending;
    expect(mocks.client.calls[0]?.signal?.aborted).toBe(true);
    expect(terminals(lines)).toEqual([{ type: "error", error: { code: "aborted", message: expect.any(String) } }]);
  });

  it("aborts the upstream call when the response body is cancelled", async () => {
    let hung = false;
    mocks.client = fakeClient((signal) => hangingStream(signal, new Anthropic.APIUserAbortError(), () => (hung = true)));
    const POST = await loadPost();
    const response = await POST(post(validBody()));
    const reader = response.body!.getReader();
    const firstRead = reader.read();
    await vi.waitFor(() => expect(hung).toBe(true));
    await reader.cancel();
    await firstRead;
    expect(mocks.client.calls[0]?.signal?.aborted).toBe(true);
  });
});
