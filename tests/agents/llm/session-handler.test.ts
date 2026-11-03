import { describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE, verifySession } from "@/agents/llm/judge-session";
import { handleSessionRequest, type SessionHandlerDeps } from "@/agents/llm/session-handler";

const SITE = "https://twokey.afterscroll.workers.dev";
const SECRET = "test-session-secret-not-real-0123456789abcdef";
const T0 = 1_790_000_000_000;

const deps = (over: Partial<SessionHandlerDeps> = {}) => {
  const log = vi.fn<(line: string) => void>();
  const value: SessionHandlerDeps = {
    env: { TWOKEY_SESSION_SECRET: SECRET, TWOKEY_SITE_ORIGIN: SITE },
    development: false,
    now: () => T0,
    log,
    ...over,
  };
  return { deps: value, log };
};
const post = (headers: Record<string, string> = { origin: SITE, "sec-fetch-site": "same-origin" }) =>
  new Request(`${SITE}/api/ai/session`, { method: "POST", headers });

describe("handleSessionRequest", () => {
  it("issues a signed session cookie to a same-origin request", async () => {
    const { deps: d, log } = deps();
    const response = await handleSessionRequest(post(), d);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, session: "issued" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie.startsWith(`${SESSION_COOKIE}=`)).toBe(true);
    expect(setCookie).toContain("HttpOnly");
    expect(await verifySession(setCookie.split(";")[0]!, SECRET, T0)).toMatchObject({ ok: true });
    expect(String(log.mock.calls[0]?.[0])).toMatch(/^\[ai\/session\] outcome=issued status=200 session=[A-Za-z0-9_-]{8}$/);
  });

  it("keeps a session that is still valid instead of issuing a new one", async () => {
    const { deps: d } = deps();
    const first = await handleSessionRequest(post(), d);
    const cookie = (first.headers.get("set-cookie") ?? "").split(";")[0]!;
    const again = await handleSessionRequest(post({ origin: SITE, "sec-fetch-site": "same-origin", cookie }), d);
    expect(await again.json()).toEqual({ ok: true, session: "existing" });
    expect(again.headers.get("set-cookie")).toBeNull();
  });

  it("refuses another site with 403 and sets no cookie", async () => {
    const response = await handleSessionRequest(post({ origin: "https://evil.example", "sec-fetch-site": "cross-site" }), deps().deps);
    expect(response.status).toBe(403);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("answers 503 when the signing secret is missing or too short", async () => {
    for (const secret of [undefined, "too-short"]) {
      const response = await handleSessionRequest(post(), deps({ env: { TWOKEY_SESSION_SECRET: secret, TWOKEY_SITE_ORIGIN: SITE } }).deps);
      expect(response.status).toBe(503);
      expect(response.headers.get("set-cookie")).toBeNull();
    }
  });

  it("admits localhost in development", async () => {
    const response = await handleSessionRequest(
      post({ origin: "http://localhost:3000", "sec-fetch-site": "same-origin" }),
      deps({ development: true, env: { TWOKEY_SESSION_SECRET: SECRET } }).deps,
    );
    expect(response.status).toBe(200);
  });
});
