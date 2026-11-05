import { describe, expect, it, vi } from "vitest";
import { issueSession } from "@/agents/llm/judge-session";
import { parseSearchPage } from "@/payments/paypal/transactions";
import {
  bearerMatches,
  handleWatchtowerReplay,
  handleWatchtowerRun,
  MIN_CRON_SECRET_LENGTH,
  type ReplayApiDeps,
  type RunApiDeps,
} from "@/watchtower/api/handlers";
import type { RunDeps } from "@/watchtower/run";
import measured from "../../fixtures/paypal/transaction-search-2026-11-05.json";
import { mockStore } from "../fixtures";

const SITE = "https://twokey.afterscroll.workers.dev";
const CRON_SECRET = "test-cron-secret-not-real-0123456789abcdefghij";
const SESSION_SECRET = "test-session-secret-not-real-0123456789abcdef";
const NOW = Date.parse("2026-11-05T15:00:00.000Z");

function runDeps(over: Partial<RunDeps> = {}) {
  const state = mockStore();
  const page = parseSearchPage(measured)!;
  const deps: RunDeps = {
    search: vi.fn(async () => ({ rows: page.rows, lastRefreshed: page.lastRefreshed, unreadable: 0 })),
    store: state.store,
    trace: vi.fn(async () => ({ kind: "untraced", reason: "no_ledger_payout" }) as const),
    now: () => new Date(NOW),
    newId: () => "run-0001",
    log: () => undefined,
    ...over,
  };
  return { deps, state };
}

function runSetup(over: Partial<RunApiDeps> = {}) {
  const lines: string[] = [];
  const { deps, state } = runDeps();
  const api: RunApiDeps = { secret: CRON_SECRET, run: deps, log: (line) => lines.push(line), ...over };
  return { api, state, lines };
}

const cronPost = (authorization?: string) =>
  new Request(`${SITE}/api/watchtower/run`, { method: "POST", headers: authorization === undefined ? {} : { authorization } });

describe("POST /api/watchtower/run (cron only)", () => {
  it("runs once with the right Bearer secret and answers the outcome, never cached", async () => {
    const { api, state, lines } = runSetup();
    const response = await handleWatchtowerRun(cronPost(`Bearer ${CRON_SECRET}`), api);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ outcome: "ok", newFindings: 4 });
    expect(state.runs).toHaveLength(1);
    expect(lines).toEqual(["[watchtower/run-route] outcome=ok status=200"]);
  });

  it("answers 401 without running for a missing, wrong or non-Bearer secret", async () => {
    for (const header of [undefined, "Bearer wrong", `Basic ${CRON_SECRET}`, `Bearer ${CRON_SECRET}x`, `Bearer ${CRON_SECRET.slice(0, -1)}`, CRON_SECRET]) {
      const { api, state } = runSetup();
      const response = await handleWatchtowerRun(cronPost(header), api);
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toBe("Bearer");
      expect(await response.json()).toMatchObject({ error: { code: "unauthorized" } });
      expect(state.runs).toHaveLength(0);
    }
  });

  it("answers 503 when the secret isn't set (or is too short to trust), whatever the request sends", async () => {
    for (const secret of [undefined, "", "   ", "short-secret"]) {
      const { api, state, lines } = runSetup({ secret });
      const response = await handleWatchtowerRun(cronPost("Bearer short-secret"), api);
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ error: { code: "misconfigured" } });
      expect(state.runs).toHaveLength(0);
      expect(lines[0]).toMatch(/detail=TWOKEY_CRON_SECRET:(unset|too_short)/);
    }
    expect(MIN_CRON_SECRET_LENGTH).toBe(32);
  });

  it("answers 503 when D1 isn't bound", async () => {
    const { api } = runSetup({ run: undefined });
    const response = await handleWatchtowerRun(cronPost(`Bearer ${CRON_SECRET}`), api);
    expect(response.status).toBe(503);
  });

  it("answers 200 with the outcome when PayPal refuses access: the refusal is recorded, not an error", async () => {
    const { deps } = runDeps({ search: undefined });
    const response = await handleWatchtowerRun(cronPost(`Bearer ${CRON_SECRET}`), runSetup({ run: deps }).api);
    expect(await response.json()).toEqual({ outcome: "no_access", newFindings: 0 });
  });

  it("answers 500 internal on a storage failure, without leaking the error", async () => {
    const { deps, state } = runDeps();
    state.store.findingIds.mockRejectedValue(new Error("D1_ERROR: secret-ish detail"));
    const { api, lines } = runSetup({ run: deps });
    const response = await handleWatchtowerRun(cronPost(`Bearer ${CRON_SECRET}`), api);
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).toContain("internal");
    expect(text).not.toContain("secret-ish");
    expect(lines).toEqual(["[watchtower/run-route] outcome=internal status=500"]);
  });

  it("never logs the secret or the Authorization header", async () => {
    const { api, lines } = runSetup();
    await handleWatchtowerRun(cronPost(`Bearer ${CRON_SECRET}`), api);
    await handleWatchtowerRun(cronPost("Bearer guess-guess-guess"), api);
    expect(lines.join("\n")).not.toMatch(/test-cron-secret|guess/);
  });
});

describe("bearerMatches", () => {
  it("accepts exactly `Bearer <secret>` (scheme in any case), and nothing else", async () => {
    expect(await bearerMatches(`Bearer ${CRON_SECRET}`, CRON_SECRET)).toBe(true);
    expect(await bearerMatches(`bearer ${CRON_SECRET}`, CRON_SECRET)).toBe(true);
    expect(await bearerMatches(`Bearer  ${CRON_SECRET}`, CRON_SECRET)).toBe(false);
    expect(await bearerMatches(null, CRON_SECRET)).toBe(false);
    expect(await bearerMatches("Bearer ", CRON_SECRET)).toBe(false);
  });
});

async function replaySetup(over: Partial<ReplayApiDeps> = {}) {
  const lines: string[] = [];
  const { setCookie } = await issueSession(SESSION_SECRET, NOW - 60_000, (n) => new Uint8Array(n).fill(9));
  const api: ReplayApiDeps = {
    env: { TWOKEY_SESSION_SECRET: SESSION_SECRET, TWOKEY_SITE_ORIGIN: SITE },
    development: false,
    now: () => new Date(NOW),
    log: (line) => lines.push(line),
    ...over,
  };
  return { api, lines, cookie: setCookie.split(";")[0]! };
}

const replayPost = (headers: Record<string, string>) => new Request(`${SITE}/api/watchtower/replay`, { method: "POST", headers });

describe("POST /api/watchtower/replay (judge session + same origin)", () => {
  it("replays the recorded outside send for a judge session, storing nothing", async () => {
    const { api, cookie, lines } = await replaySetup();
    const response = await handleWatchtowerReplay(replayPost({ origin: SITE, "sec-fetch-site": "same-origin", cookie }), api);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as { label: string; finding: { transactionId: string; firstSeenAt: string } };
    expect(body.label).toBe("Replay of a real sandbox event: a $3.21 website send on Nov 3, 2026.");
    expect(body.finding).toMatchObject({ transactionId: "1TY14748YE721631B", firstSeenAt: "2026-11-05T15:00:00.000Z" });
    expect(lines[0]).toMatch(/^\[watchtower\/replay\] outcome=replayed status=200 session=\S{8}$/);
  });

  it("answers 403 to another site, before looking at the session", async () => {
    const { api, cookie } = await replaySetup();
    const attempts: Record<string, string>[] = [{ origin: "https://evil.example", cookie }, { origin: SITE, "sec-fetch-site": "cross-site", cookie }, { cookie }];
    for (const headers of attempts) {
      const response = await handleWatchtowerReplay(replayPost(headers), api);
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: "forbidden" } });
    }
  });

  it("answers 401 without a valid judge session", async () => {
    const { api } = await replaySetup();
    const response = await handleWatchtowerReplay(replayPost({ origin: SITE, "sec-fetch-site": "same-origin" }), api);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "no_session" } });
  });

  it("answers 503 when the session secret or site origin is missing", async () => {
    const { api, cookie } = await replaySetup({ env: { TWOKEY_SITE_ORIGIN: SITE } });
    const response = await handleWatchtowerReplay(replayPost({ origin: SITE, cookie }), api);
    expect(response.status).toBe(503);
  });
});
