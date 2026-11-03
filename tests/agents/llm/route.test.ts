import Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { issueSession } from "@/agents/llm/judge-session";
import { UNAVAILABLE_MESSAGES } from "@/agents/llm/replay";
import { createLineDecoder, NDJSON_CONTENT_TYPE, type WireLine } from "@/agents/llm/wire";
import { fakeClient, fakeStream, hangingStream, message, textBlock, turnRequest, type FakeClient } from "./fixtures";
import { sqliteD1, type SqliteD1 } from "./sqlite-d1";

// The seams replaced: the factory that would build a real Anthropic client, and OpenNext's
// Cloudflare context (env + D1 + waitUntil). D1 is real SQLite with the real migrations. No network.
const mocks = vi.hoisted(() => ({
  client: undefined as FakeClient | undefined,
  created: 0,
  context: undefined as { env: CloudflareEnv; ctx: { waitUntil(promise: Promise<unknown>): void } } | undefined,
}));
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
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => {
    if (!mocks.context) throw new Error("getCloudflareContext called without a Cloudflare context");
    return { ...mocks.context, cf: undefined };
  },
}));

const SITE = "https://twokey.afterscroll.workers.dev";
const SECRET = "test-session-secret-not-real-0123456789abcdef";
const COOKIE = (await issueSession(SECRET, Date.now())).setCookie.split(";")[0]!;

const loadRoute = async () => import("@/app/api/ai/turn/route");
const loadPost = async () => (await loadRoute()).POST;
const post = (body: unknown, init: { signal?: AbortSignal; raw?: string; origin?: string; cookie?: string | null } = {}) => {
  const headers = new Headers({ "content-type": "application/json", origin: init.origin ?? SITE, "sec-fetch-site": "same-origin" });
  if (init.cookie !== null) headers.set("cookie", init.cookie ?? COOKIE);
  return new Request(`${SITE}/api/ai/turn`, { method: "POST", headers, body: init.raw ?? JSON.stringify(body), signal: init.signal });
};
const validBody = () => ({ request: turnRequest("hello") });
const readLines = async (response: Response): Promise<WireLine[]> => {
  const decoder = createLineDecoder();
  return [...decoder.push(await response.text()), ...decoder.flush()];
};
const terminals = (lines: WireLine[]) => lines.filter((line) => line.type === "complete" || line.type === "error");
const textOf = (lines: WireLine[]) =>
  lines.flatMap((line) => (line.type === "event" && line.event.type === "TEXT_MESSAGE_CONTENT" ? [line.event.delta] : [])).join("");

let d1: SqliteD1;
let background: Promise<unknown>[];

beforeEach(() => {
  vi.resetModules();
  mocks.client = undefined;
  mocks.created = 0;
  d1 = sqliteD1();
  background = [];
  mocks.context = { env: { DB: d1.db }, ctx: { waitUntil: (promise) => void background.push(promise) } };
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key-not-real");
  vi.stubEnv("TWOKEY_SESSION_SECRET", SECRET);
  vi.stubEnv("TWOKEY_SITE_ORIGIN", SITE);
  vi.stubEnv("TWOKEY_AI_BUDGET_USD", "10");
  vi.stubEnv("TWOKEY_AI_SESSION_BUDGET_USD", "5");
  vi.stubEnv("TWOKEY_AI_SESSION_TURNS_PER_MINUTE", "3");
  vi.stubEnv("TWOKEY_AI_MODEL", "");
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/ai/turn", () => {
  it("exports POST only, on the Node.js runtime", async () => {
    const route = await loadRoute();
    expect(Object.keys(route).sort()).toEqual(["POST", "runtime"]);
    expect(route.runtime).toBe("nodejs");
  });

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
    expect(d1.all("SELECT kind FROM ai_turn_events ORDER BY seq")).toEqual([{ kind: "reserved" }, { kind: "settled" }]);
  });

  it("ends a stream that fails upstream with exactly one error line", async () => {
    const error = new Anthropic.RateLimitError(429, { type: "error" }, "slow down", new Headers());
    mocks.client = fakeClient(fakeStream(message([textBlock("Hello")]), { failAfter: { count: 3, error } }));
    const POST = await loadPost();
    const lines = await readLines(await POST(post(validBody())));
    expect(terminals(lines)).toEqual([{ type: "error", error: { code: "upstream_error", message: expect.any(String) } }]);
    expect(lines.at(-1)?.type).toBe("error");
  });

  it("answers from replays, without building a client, when ANTHROPIC_API_KEY is missing", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const POST = await loadPost();
    const response = await POST(post(validBody()));
    expect(response.status).toBe(200);
    expect(textOf(await readLines(response))).toBe(UNAVAILABLE_MESSAGES.off);
    expect(mocks.created).toBe(0);
  });

  it("returns 503 misconfigured when TWOKEY_SESSION_SECRET is missing, or the D1 binding is", async () => {
    vi.stubEnv("TWOKEY_SESSION_SECRET", "");
    const POST = await loadPost();
    const noSecret = await POST(post(validBody()));
    expect(noSecret.status).toBe(503);
    expect(await noSecret.json()).toEqual({ error: { code: "misconfigured", message: expect.any(String) } });
    vi.stubEnv("TWOKEY_SESSION_SECRET", SECRET);
    mocks.context = undefined;
    expect((await POST(post(validBody()))).status).toBe(503);
    expect(mocks.created).toBe(0);
  });

  it("returns 403 to another site and 401 without a session", async () => {
    const POST = await loadPost();
    expect((await POST(post(validBody(), { origin: "https://evil.example" }))).status).toBe(403);
    expect((await POST(post(validBody(), { cookie: null }))).status).toBe(401);
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

  it("returns 429 rate_limited after TWOKEY_AI_SESSION_TURNS_PER_MINUTE turns a minute from one session", async () => {
    mocks.client = fakeClient(...Array.from({ length: 3 }, () => fakeStream(message([textBlock("ok")]))));
    const POST = await loadPost();
    for (let i = 0; i < 3; i++) expect((await readLines(await POST(post({ request: turnRequest(`q${i}`) })))).at(-1)?.type).toBe("complete");
    const limited = await POST(post(validBody()));
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ error: { code: "rate_limited" } });
    const other = (await issueSession(SECRET, Date.now())).setCookie.split(";")[0]!;
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect((await POST(post(validBody(), { cookie: other }))).status).toBe(200);
  });

  it("replays the recorded answer, labelled as a replay, once the spend cap is used up", async () => {
    vi.stubEnv("TWOKEY_AI_BUDGET_USD", "1.5");
    mocks.client = fakeClient(fakeStream(message([textBlock("Recorded answer")])));
    const POST = await loadPost();
    const live = await readLines(await POST(post(validBody())));
    await Promise.all(background);
    // A turn of the same size reserves about $0.87; a second session's open turn holds $0.9 of the
    // $1.50 total, so the next turn cannot fit and is answered from the recording instead.
    d1.exec("INSERT INTO ai_turn_events (turn_id, kind, session_id, occurred_at, model, request_hash, cost_micro_usd) VALUES ('open', 'reserved', 'other', 1, 'm', 'h', 900000)");
    const replayed = await readLines(await POST(post(validBody())));
    expect(replayed[0]).toMatchObject({ type: "replay" });
    expect(textOf(replayed)).toBe(textOf(live));
    expect(mocks.client.calls).toHaveLength(1);
    expect(d1.all("SELECT kind, outcome FROM ai_turn_events WHERE kind = 'replayed'")).toEqual([{ kind: "replayed", outcome: "hit" }]);
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

  it("aborts the upstream call when the response body is cancelled, and still settles the turn", async () => {
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
    await vi.waitFor(() => expect(d1.all("SELECT outcome FROM ai_turn_events WHERE kind = 'settled'")).toEqual([{ outcome: "aborted" }]));
  });
});
