import { describe, expect, it, vi } from "vitest";
import { clientIpHmac, issueSession, SESSION_COOKIE, verifySession } from "@/agents/llm/judge-session";
import { SHARED_IP_BUCKET } from "@/agents/llm/session-handler";
import type { SessionIssuanceLog } from "@/agents/llm/session-issuance-log";
import { handleJudgeReset, MAX_RESET_BODY_BYTES, RESET_MESSAGES, type ResetHandlerDeps } from "@/judge/reset-handler";

const SITE = "https://twokey.afterscroll.workers.dev";
const SECRET = "test-session-secret-not-real-0123456789abcdef";
const T0 = 1_790_000_000_000;
const IP = "203.0.113.9";

/** The judge's current session cookie, as the browser would send it. */
const currentCookie = async (at = T0 - 60_000) => (await issueSession(SECRET, at)).setCookie.split(";")[0]!;

function mocks(over: Partial<ResetHandlerDeps> = {}) {
  const issue = vi.fn<SessionIssuanceLog["issue"]>().mockResolvedValue("issued");
  const log = vi.fn<(line: string) => void>();
  const deps: ResetHandlerDeps = {
    env: { TWOKEY_SESSION_SECRET: SECRET, TWOKEY_SITE_ORIGIN: SITE, TWOKEY_AI_SESSIONS_PER_IP_PER_HOUR: "5" },
    development: false,
    issuances: { issue },
    now: () => T0,
    log,
    ...over,
  };
  return { deps, issue, log };
}

const post = (headers: Record<string, string> = {}, body?: BodyInit) =>
  new Request(`${SITE}/api/judge/reset`, {
    method: "POST",
    headers: { origin: SITE, "sec-fetch-site": "same-origin", "cf-connecting-ip": IP, ...headers },
    ...(body !== undefined && { body }),
  });

const errorOf = async (response: Response) => ((await response.json()) as { error: { code: string; message: string } }).error;
const newCookie = (response: Response) => (response.headers.get("set-cookie") ?? "").split(";")[0]!;

describe("handleJudgeReset", () => {
  it("issues a fresh session to a judge with a session, through the issuance log, and never reuses the old id", async () => {
    const { deps, issue, log } = mocks();
    const cookie = await currentCookie();
    const old = await verifySession(cookie, SECRET, T0);
    const response = await handleJudgeReset(post({ cookie }, "{}"), deps);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, session: "issued" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie.startsWith(`${SESSION_COOKIE}=`)).toBe(true);
    for (const flag of ["HttpOnly", "Secure", "SameSite=Strict", "Path=/"]) expect(setCookie).toContain(flag);

    const fresh = await verifySession(newCookie(response), SECRET, T0);
    expect(fresh.ok && old.ok && fresh.session.id !== old.session.id).toBe(true);
    expect(issue).toHaveBeenCalledTimes(1);
    expect(issue).toHaveBeenCalledWith(
      { sessionId: fresh.ok ? fresh.session.id : "", ipHmac: await clientIpHmac(SECRET, IP), at: T0 },
      { perWindow: 5, windowMs: 60 * 60_000 },
    );
    expect(String(log.mock.calls[0]?.[0])).toMatch(/^\[judge\/reset\] outcome=issued status=200 from=[A-Za-z0-9_-]{8} session=[A-Za-z0-9_-]{8}$/);
  });

  it("accepts an empty body as well as {}", async () => {
    const { deps } = mocks();
    expect((await handleJudgeReset(post({ cookie: await currentCookie() }), deps)).status).toBe(200);
    expect((await handleJudgeReset(post({ cookie: await currentCookie() }, "  "), deps)).status).toBe(200);
  });

  it("answers 429 with a plain message and no cookie when the IP has used its cap, keeping the old session", async () => {
    const { deps, issue } = mocks();
    issue.mockResolvedValue("ip_limited");
    const response = await handleJudgeReset(post({ cookie: await currentCookie() }, "{}"), deps);
    expect(response.status).toBe(429);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
    const error = await errorOf(response);
    expect(error).toEqual({ code: "rate_limited", message: RESET_MESSAGES.rate_limited });
    expect(error.message).toMatch(/current session is still here/);
    expect(error.message).not.toMatch(/\d{2,} (sessions|minutes)/);
  });

  it("counts requests without cf-connecting-ip in the session route's one shared bucket", async () => {
    const { deps, issue } = mocks();
    const request = new Request(`${SITE}/api/judge/reset`, {
      method: "POST",
      headers: { origin: SITE, "sec-fetch-site": "same-origin", cookie: await currentCookie() },
    });
    await handleJudgeReset(request, deps);
    expect(issue.mock.calls[0]?.[0].ipHmac).toBe(await clientIpHmac(SECRET, SHARED_IP_BUCKET));
  });

  it("refuses without a valid judge session (401), touching nothing", async () => {
    const { deps, issue } = mocks();
    for (const cookie of [undefined, `${SESSION_COOKIE}=v1.nope`, await currentCookie(T0 - 13 * 60 * 60_000)]) {
      const response = await handleJudgeReset(post(cookie ? { cookie } : {}, "{}"), deps);
      expect(response.status).toBe(401);
      expect((await errorOf(response)).code).toBe("no_session");
      expect(response.headers.get("set-cookie")).toBeNull();
    }
    expect(issue).not.toHaveBeenCalled();
  });

  it("refuses another site (403) before it reads the session", async () => {
    const { deps, issue, log } = mocks();
    const response = await handleJudgeReset(post({ origin: "https://evil.example", "sec-fetch-site": "cross-site", cookie: await currentCookie() }, "{}"), deps);
    expect(response.status).toBe(403);
    expect((await errorOf(response)).code).toBe("forbidden");
    expect(issue).not.toHaveBeenCalled();
    expect(String(log.mock.calls[0]?.[0])).toBe("[judge/reset] outcome=forbidden status=403 detail=sec_fetch_site");
  });

  it("refuses a body over 8 KB (413) and a body with options (400)", async () => {
    const { deps, issue } = mocks();
    const cookie = await currentCookie();
    const big = await handleJudgeReset(post({ cookie }, JSON.stringify({ pad: "x".repeat(MAX_RESET_BODY_BYTES) })), deps);
    expect(big.status).toBe(413);
    const declared = await handleJudgeReset(post({ cookie, "content-length": String(MAX_RESET_BODY_BYTES + 1) }, "{}"), deps);
    expect(declared.status).toBe(413);
    for (const body of ['{"seed":"other"}', "[]", "not json", "null"]) {
      const response = await handleJudgeReset(post({ cookie }, body), deps);
      expect(response.status).toBe(400);
      expect((await errorOf(response)).code).toBe("bad_request");
    }
    expect(issue).not.toHaveBeenCalled();
  });

  it("answers 503 when the secret, the cap or the D1 binding is missing", async () => {
    for (const env of [
      { TWOKEY_SESSION_SECRET: undefined, TWOKEY_SITE_ORIGIN: SITE, TWOKEY_AI_SESSIONS_PER_IP_PER_HOUR: "5" },
      { TWOKEY_SESSION_SECRET: SECRET, TWOKEY_SITE_ORIGIN: undefined, TWOKEY_AI_SESSIONS_PER_IP_PER_HOUR: "5" },
      { TWOKEY_SESSION_SECRET: SECRET, TWOKEY_SITE_ORIGIN: SITE, TWOKEY_AI_SESSIONS_PER_IP_PER_HOUR: undefined },
    ]) {
      const response = await handleJudgeReset(post({ cookie: await currentCookie() }, "{}"), mocks({ env }).deps);
      expect(response.status).toBe(503);
      expect((await errorOf(response)).code).toBe("misconfigured");
    }
    const unbound = mocks({ issuances: undefined });
    expect((await handleJudgeReset(post({ cookie: await currentCookie() }, "{}"), unbound.deps)).status).toBe(503);
    expect(String(unbound.log.mock.calls[0]?.[0])).toContain("detail=DB:unbound");
  });

  it("answers 500 with no cookie when the issuance log fails", async () => {
    const { deps, issue } = mocks();
    issue.mockRejectedValue(new Error("D1 down"));
    const response = await handleJudgeReset(post({ cookie: await currentCookie() }, "{}"), deps);
    expect(response.status).toBe(500);
    expect((await errorOf(response)).code).toBe("internal");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("admits localhost in development without a site origin", async () => {
    const { deps } = mocks({ development: true, env: { TWOKEY_SESSION_SECRET: SECRET, TWOKEY_AI_SESSIONS_PER_IP_PER_HOUR: "5" } });
    const response = await handleJudgeReset(post({ origin: "http://localhost:3004", cookie: await currentCookie() }, "{}"), deps);
    expect(response.status).toBe(200);
  });

  it("never logs the IP, the cookie or the secret", async () => {
    const { deps, log, issue } = mocks();
    const cookie = await currentCookie();
    await handleJudgeReset(post({ cookie }, "{}"), deps);
    issue.mockResolvedValue("ip_limited");
    await handleJudgeReset(post({ cookie }, "{}"), deps);
    const lines = log.mock.calls.join("\n");
    for (const secret of [IP, SECRET, cookie.split("=")[1]!]) expect(lines).not.toContain(secret);
  });
});
