import { describe, expect, it, vi } from "vitest";
import { createInMemoryAiTurnStore, type AiTurnStore } from "@/agents/llm/ai-turn-log";
import { handleAiTurn, type AiTurnHandlerDeps } from "@/agents/llm/ai-turn-handler";
import { issueSession } from "@/agents/llm/judge-session";
import { UNAVAILABLE_MESSAGES } from "@/agents/llm/replay";
import type { AiConfigEnv } from "@/agents/llm/turn-config";
import { createLineDecoder, NDJSON_CONTENT_TYPE, type WireLine } from "@/agents/llm/wire";
import { fakeClient, fakeStream, message, textBlock, turnRequest, usage, type FakeClient } from "./fixtures";

const SITE = "https://twokey.afterscroll.workers.dev";
const SECRET = "test-session-secret-not-real-0123456789abcdef";
const T0 = 1_790_000_000_000;

const env = (over: Partial<AiConfigEnv> = {}): AiConfigEnv => ({
  ANTHROPIC_API_KEY: "test-key-not-real",
  TWOKEY_SESSION_SECRET: SECRET,
  TWOKEY_SITE_ORIGIN: SITE,
  TWOKEY_AI_BUDGET_USD: "10",
  TWOKEY_AI_SESSION_BUDGET_USD: "5",
  TWOKEY_AI_SESSION_TURNS_PER_MINUTE: "3",
  ...over,
});

const sessionCookie = async (secret = SECRET) => (await issueSession(secret, T0)).setCookie.split(";")[0]!;
/** One judge session for every request in this file unless a test passes its own cookie. */
const COOKIE = await sessionCookie();

async function post(body: unknown, init: { origin?: string | null; cookie?: string | null; raw?: string } = {}) {
  const headers = new Headers({ "content-type": "application/json", "sec-fetch-site": "same-origin" });
  const origin = init.origin === undefined ? SITE : init.origin;
  if (origin !== null) headers.set("origin", origin);
  const cookie = init.cookie === undefined ? COOKIE : init.cookie;
  if (cookie !== null) headers.set("cookie", cookie);
  return new Request(`${SITE}/api/ai/turn`, { method: "POST", headers, body: init.raw ?? JSON.stringify(body) });
}
const body = (text = "Where did the car-wash money go?") => ({ request: turnRequest(text) });

function deps(over: Partial<AiTurnHandlerDeps> = {}, client: FakeClient = fakeClient()) {
  const store = createInMemoryAiTurnStore();
  const clientFor = vi.fn(() => client);
  const log = vi.fn<(line: string) => void>();
  let id = 0;
  const value: AiTurnHandlerDeps = {
    env: env(),
    development: false,
    store,
    clientFor,
    waitUntil: () => undefined,
    now: () => T0 + 1000,
    newId: () => `turn-${++id}`,
    log,
    ...over,
  };
  return { deps: value, store, clientFor, client, log };
}

const readLines = async (response: Response): Promise<WireLine[]> => {
  const decoder = createLineDecoder();
  return [...decoder.push(await response.text()), ...decoder.flush()];
};
const errorCode = async (response: Response) => ((await response.json()) as { error: { code: string } }).error.code;
const textOf = (lines: WireLine[]) =>
  lines.flatMap((line) => (line.type === "event" && line.event.type === "TEXT_MESSAGE_CONTENT" ? [line.event.delta] : [])).join("");
/** Another session holds a reservation for the whole $10 total (the env above), so no live turn fits. */
const exhausted = async (store: AiTurnStore) => {
  const roomy = { totalBudgetMicroUsd: 1e12, sessionBudgetMicroUsd: 1e12, sessionTurnsPerWindow: 9, windowMs: 60_000 };
  const reservation = { turnId: "earlier", sessionId: "someone-else", model: "claude-opus-5-5", requestHash: "x", costMicroUsd: 10_000_000, at: T0 };
  expect(await store.turnLog.reserve(reservation, roomy)).toBe("reserved");
};

describe("handleAiTurn: refusals before any work", () => {
  it("answers 503 when the session secret is missing, without touching the store or the model", async () => {
    const t = deps({ env: env({ TWOKEY_SESSION_SECRET: undefined }) });
    const response = await handleAiTurn(await post(body()), t.deps);
    expect(response.status).toBe(503);
    expect(await errorCode(response)).toBe("misconfigured");
    expect(t.store.events()).toEqual([]);
    expect(t.clientFor).not.toHaveBeenCalled();
    expect(String(t.log.mock.calls[0]?.[0])).toContain("detail=TWOKEY_SESSION_SECRET:unset");
  });

  it("answers 503 when a limit var is malformed, naming the var", async () => {
    const t = deps({ env: env({ TWOKEY_AI_BUDGET_USD: "one dollar" }) });
    const response = await handleAiTurn(await post(body()), t.deps);
    expect(response.status).toBe(503);
    expect(String(t.log.mock.calls[0]?.[0])).toContain("TWOKEY_AI_BUDGET_USD:invalid");
  });

  it("answers 403 to another site, and to a request with no Origin", async () => {
    const t = deps();
    const evil = await handleAiTurn(await post(body(), { origin: "https://evil.example" }), t.deps);
    expect(evil.status).toBe(403);
    expect(await errorCode(evil)).toBe("forbidden");
    expect((await handleAiTurn(await post(body(), { origin: null }), t.deps)).status).toBe(403);
    expect(t.store.events()).toEqual([]);
  });

  it("answers 503 when the D1 binding is missing", async () => {
    const t = deps({ store: undefined });
    const response = await handleAiTurn(await post(body()), t.deps);
    expect(response.status).toBe(503);
    expect(String(t.log.mock.calls[0]?.[0])).toContain("detail=DB:unbound");
  });

  it("answers 401 no_session without a valid session cookie", async () => {
    const t = deps();
    for (const cookie of [null, "other=1", await sessionCookie("another-test-secret-not-real-0123456789abc")]) {
      const response = await handleAiTurn(await post(body(), { cookie }), t.deps);
      expect(response.status).toBe(401);
      expect(await errorCode(response)).toBe("no_session");
    }
    expect(t.clientFor).not.toHaveBeenCalled();
  });

  it("answers 400 to an invalid body without reserving anything", async () => {
    const t = deps();
    const response = await handleAiTurn(await post(undefined, { raw: "{" }), t.deps);
    expect(response.status).toBe(400);
    expect(t.store.events()).toEqual([]);
  });
});

describe("handleAiTurn: live turns", () => {
  it("reserves the worst case before calling the model, streams the turn, then settles the actual cost", async () => {
    const final = message([textBlock("Hello")], "end_turn", { usage: usage({ input_tokens: 1000, output_tokens: 1000 }) });
    const t = deps({}, fakeClient(fakeStream(final)));
    const stream = vi.spyOn(t.client.beta.messages, "stream");
    stream.mockImplementation((params, options) => {
      expect(t.store.events().map((event) => event.kind)).toEqual(["reserved"]);
      t.client.calls.push({ body: params, signal: options?.signal ?? undefined });
      return fakeStream(final);
    });
    const response = await handleAiTurn(await post({ request: { ...turnRequest("hi"), model: { id: "claude-haiku-4-5" } } }), t.deps);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(NDJSON_CONTENT_TYPE);
    const lines = await readLines(response);
    expect(lines.at(-1)).toMatchObject({ type: "complete" });
    expect(t.client.calls[0]?.body.model).toBe("claude-opus-5-5");
    const [reserved, settled] = t.store.events();
    expect(reserved).toMatchObject({ kind: "reserved", turnId: "turn-1", model: "claude-opus-5-5" });
    expect(reserved?.kind === "reserved" && reserved.costMicroUsd).toBeGreaterThan(800_000);
    expect(settled).toMatchObject({ kind: "settled", turnId: "turn-1", costMicroUsd: 24_000, outcome: "complete" });
  });

  it("answers 429 once the session's turns for the minute are used, without calling the model", async () => {
    const t = deps({}, fakeClient(...Array.from({ length: 3 }, () => fakeStream(message([textBlock("ok")])))));
    for (let i = 0; i < 3; i++) expect((await readLines(await handleAiTurn(await post(body(`q${i}`)), t.deps))).at(-1)?.type).toBe("complete");
    const limited = await handleAiTurn(await post(body("q4")), t.deps);
    expect(limited.status).toBe(429);
    expect(await errorCode(limited)).toBe("rate_limited");
    expect(t.client.calls).toHaveLength(3);
  });

  it("answers 500, without calling the model, when the store fails", async () => {
    const memory = createInMemoryAiTurnStore();
    const broken: AiTurnStore = { ...memory, turnLog: { ...memory.turnLog, reserve: async () => Promise.reject(new Error("D1 down")) } };
    const t = deps({ store: broken });
    const response = await handleAiTurn(await post(body()), t.deps);
    expect(response.status).toBe(500);
    expect(await errorCode(response)).toBe("internal");
    expect(t.clientFor).not.toHaveBeenCalled();
  });
});

describe("handleAiTurn: when the live AI is unavailable", () => {
  it("replays the recorded answer to the same request, marked as a replay, once the total budget is used up", async () => {
    const t = deps({}, fakeClient(fakeStream(message([textBlock("The car wash raised $15.")]))));
    const pending: Promise<unknown>[] = [];
    t.deps.waitUntil = (promise) => void pending.push(promise);
    const live = await readLines(await handleAiTurn(await post(body()), t.deps));
    await Promise.all(pending);
    await exhausted(t.store);

    const replayed = await readLines(await handleAiTurn(await post(body()), t.deps));
    expect(replayed[0]).toEqual({ type: "replay", replay: { recordedAt: T0 + 1000 } });
    expect(textOf(replayed)).toBe(textOf(live));
    expect(replayed.at(-1)).toMatchObject({ type: "complete", response: { id: "msg_1" } });
    expect(t.client.calls).toHaveLength(1);
    expect(t.store.events().at(-1)).toMatchObject({ kind: "replayed", outcome: "hit" });
  });

  it("answers with one plain message when nothing was recorded for the request", async () => {
    const t = deps();
    await exhausted(t.store);
    const lines = await readLines(await handleAiTurn(await post(body("An unscripted question")), t.deps));
    expect(lines.some((line) => line.type === "replay")).toBe(false);
    expect(textOf(lines)).toBe(UNAVAILABLE_MESSAGES.total_budget);
    expect(lines.at(-1)).toMatchObject({ type: "complete", response: { status: "completed" } });
    expect(t.clientFor).not.toHaveBeenCalled();
    expect(t.store.events().at(-1)).toMatchObject({ kind: "replayed", outcome: "miss" });
  });

  it("says so when it is this session's share that is used up", async () => {
    const t = deps({ env: env({ TWOKEY_AI_SESSION_BUDGET_USD: "0.01" }) });
    const lines = await readLines(await handleAiTurn(await post(body()), t.deps));
    expect(textOf(lines)).toBe(UNAVAILABLE_MESSAGES.session_budget);
  });

  it("serves replays only, with no reservation, when no API key is set", async () => {
    const t = deps({ env: env({ ANTHROPIC_API_KEY: undefined }) });
    await t.store.recordings.save({
      requestHash: await (await import("@/agents/llm/replay-key")).replayKey(
        (await import("@/agents/llm/translate-request")).buildMessageParams(turnRequest("Where did the car-wash money go?"), "claude-opus-5-5"),
      ),
      turnId: "recorded",
      model: "claude-opus-5-5",
      recordedAt: T0,
      ndjson: `${JSON.stringify({ type: "complete", response: { id: "r", createdAt: 1, status: "completed", output: [] } })}\n`,
    });
    const hit = await readLines(await handleAiTurn(await post(body()), t.deps));
    expect(hit[0]).toMatchObject({ type: "replay" });
    const miss = await readLines(await handleAiTurn(await post(body("Something else")), t.deps));
    expect(textOf(miss)).toBe(UNAVAILABLE_MESSAGES.off);
    expect(t.store.events().some((event) => event.kind === "reserved")).toBe(false);
    expect(t.clientFor).not.toHaveBeenCalled();
  });

  it("rate-limits replays too", async () => {
    const t = deps({ env: env({ ANTHROPIC_API_KEY: undefined }) });
    for (let i = 0; i < 3; i++) expect((await handleAiTurn(await post(body(`q${i}`)), t.deps)).status).toBe(200);
    expect((await handleAiTurn(await post(body("q4")), t.deps)).status).toBe(429);
  });

  it("treats a corrupt recording as a miss", async () => {
    const t = deps({ env: env({ ANTHROPIC_API_KEY: undefined }) });
    const params = (await import("@/agents/llm/translate-request")).buildMessageParams(turnRequest("Where did the car-wash money go?"), "claude-opus-5-5");
    const requestHash = await (await import("@/agents/llm/replay-key")).replayKey(params);
    await t.store.recordings.save({ requestHash, turnId: "bad", model: "m", recordedAt: T0, ndjson: "garbage\n" });
    const lines = await readLines(await handleAiTurn(await post(body()), t.deps));
    expect(textOf(lines)).toBe(UNAVAILABLE_MESSAGES.off);
    expect(t.log.mock.calls.some(([line]) => String(line).includes("corrupt_recording"))).toBe(true);
  });
});

describe("handleAiTurn: logging", () => {
  it("logs one line per request with ids, never the cookie, the key or the prompt", async () => {
    const t = deps({}, fakeClient(fakeStream(message([textBlock("ok")]))));
    const cookie = COOKIE;
    await readLines(await handleAiTurn(await post(body("my secret question"), { cookie }), t.deps));
    const logged = t.log.mock.calls.map(([line]) => String(line)).join("\n");
    expect(logged).toContain("[ai/turn] outcome=live status=200");
    expect(logged).toMatch(/reserved_usd=\d+\.\d{4}/);
    expect(logged).not.toContain(cookie.split("=")[1]!);
    expect(logged).not.toContain("secret question");
    expect(logged).not.toContain("test-key-not-real");
  });
});
