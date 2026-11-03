import { describe, expect, it, vi } from "vitest";
import { clientIpHmac, SESSION_COOKIE, verifySession } from "@/agents/llm/judge-session";
import { handleSessionRequest, SHARED_IP_BUCKET, type SessionHandlerDeps } from "@/agents/llm/session-handler";
import { createInMemorySessionIssuanceLog, type SessionIssuanceLog } from "@/agents/llm/session-issuance-log";

const SITE = "https://twokey.afterscroll.workers.dev";
const SECRET = "test-session-secret-not-real-0123456789abcdef";
const T0 = 1_790_000_000_000;
const IP = "203.0.113.9";

const deps = (over: Partial<SessionHandlerDeps> = {}) => {
  const log = vi.fn<(line: string) => void>();
  const issuances = createInMemorySessionIssuanceLog();
  const value: SessionHandlerDeps = {
    env: { TWOKEY_SESSION_SECRET: SECRET, TWOKEY_SITE_ORIGIN: SITE, TWOKEY_AI_SESSIONS_PER_IP_PER_HOUR: "5" },
    development: false,
    issuances,
    now: () => T0,
    log,
    ...over,
  };
  return { deps: value, log, issuances };
};
const post = (headers: Record<string, string> = {}) =>
  new Request(`${SITE}/api/ai/session`, {
    method: "POST",
    headers: { origin: SITE, "sec-fetch-site": "same-origin", "cf-connecting-ip": IP, ...headers },
  });
const cookieFrom = (response: Response) => (response.headers.get("set-cookie") ?? "").split(";")[0]!;

describe("handleSessionRequest", () => {
  it("issues a signed session cookie to a same-origin request and logs the issuance", async () => {
    const { deps: d, log, issuances } = deps();
    const response = await handleSessionRequest(post(), d);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, session: "issued" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie.startsWith(`${SESSION_COOKIE}=`)).toBe(true);
    expect(setCookie).toContain("HttpOnly");
    const verified = await verifySession(cookieFrom(response), SECRET, T0);
    expect(verified).toMatchObject({ ok: true });
    expect(issuances.issuances()).toEqual([
      { sessionId: verified.ok ? verified.session.id : "", ipHmac: await clientIpHmac(SECRET, IP), at: T0 },
    ]);
    expect(String(log.mock.calls[0]?.[0])).toMatch(/^\[ai\/session\] outcome=issued status=200 session=[A-Za-z0-9_-]{8}$/);
  });

  it("never stores or logs the raw IP", async () => {
    const { deps: d, log, issuances } = deps();
    await handleSessionRequest(post(), d);
    expect(JSON.stringify(issuances.issuances())).not.toContain(IP);
    expect(log.mock.calls.join("\n")).not.toContain(IP);
  });

  it("keeps a session that is still valid, without counting it against the IP", async () => {
    const { deps: d, issuances } = deps();
    const cookie = cookieFrom(await handleSessionRequest(post(), d));
    const again = await handleSessionRequest(post({ cookie }), d);
    expect(await again.json()).toEqual({ ok: true, session: "existing" });
    expect(again.headers.get("set-cookie")).toBeNull();
    expect(issuances.issuances()).toHaveLength(1);
  });

  it("refuses a sixth new session from one IP within the hour with 429 and no cookie", async () => {
    const { deps: d } = deps();
    for (let i = 0; i < 5; i++) expect((await handleSessionRequest(post(), d)).status).toBe(200);
    const refused = await handleSessionRequest(post(), d);
    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({ error: { code: "rate_limited", message: expect.stringMatching(/too many new demo sessions/i) } });
    expect(refused.headers.get("set-cookie")).toBeNull();
    expect((await handleSessionRequest(post({ "cf-connecting-ip": "198.51.100.1" }), d)).status).toBe(200);
  });

  it("puts every request without cf-connecting-ip in one shared bucket", async () => {
    const { deps: d, issuances } = deps();
    const anonymous = () => new Request(`${SITE}/api/ai/session`, { method: "POST", headers: { origin: SITE, "sec-fetch-site": "same-origin" } });
    for (let i = 0; i < 5; i++) expect((await handleSessionRequest(anonymous(), d)).status).toBe(200);
    expect((await handleSessionRequest(anonymous(), d)).status).toBe(429);
    expect(issuances.issuances()[0]?.ipHmac).toBe(await clientIpHmac(SECRET, SHARED_IP_BUCKET));
  });

  it("refuses another site with 403 and sets no cookie", async () => {
    const { deps: d, issuances } = deps();
    const response = await handleSessionRequest(post({ origin: "https://evil.example", "sec-fetch-site": "cross-site" }), d);
    expect(response.status).toBe(403);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(issuances.issuances()).toEqual([]);
  });

  it("answers 503 when the signing secret or the cap is missing, or the D1 binding is", async () => {
    for (const env of [
      { TWOKEY_SESSION_SECRET: undefined, TWOKEY_SITE_ORIGIN: SITE, TWOKEY_AI_SESSIONS_PER_IP_PER_HOUR: "5" },
      { TWOKEY_SESSION_SECRET: "too-short", TWOKEY_SITE_ORIGIN: SITE, TWOKEY_AI_SESSIONS_PER_IP_PER_HOUR: "5" },
      { TWOKEY_SESSION_SECRET: SECRET, TWOKEY_SITE_ORIGIN: SITE, TWOKEY_AI_SESSIONS_PER_IP_PER_HOUR: undefined },
    ]) {
      const response = await handleSessionRequest(post(), deps({ env }).deps);
      expect(response.status).toBe(503);
      expect(response.headers.get("set-cookie")).toBeNull();
    }
    const unbound = deps({ issuances: undefined });
    expect((await handleSessionRequest(post(), unbound.deps)).status).toBe(503);
    expect(String(unbound.log.mock.calls[0]?.[0])).toContain("detail=DB:unbound");
  });

  it("answers 500 and sets no cookie when the issuance log fails", async () => {
    const broken: SessionIssuanceLog = { issue: async () => Promise.reject(new Error("D1 down")) };
    const response = await handleSessionRequest(post(), deps({ issuances: broken }).deps);
    expect(response.status).toBe(500);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("admits localhost in development", async () => {
    const response = await handleSessionRequest(
      post({ origin: "http://localhost:3000" }),
      deps({ development: true, env: { TWOKEY_SESSION_SECRET: SECRET, TWOKEY_AI_SESSIONS_PER_IP_PER_HOUR: "5" } }).deps,
    );
    expect(response.status).toBe(200);
  });
});
