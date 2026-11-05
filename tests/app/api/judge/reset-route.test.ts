import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE } from "@/agents/llm/judge-session";
import { sqliteD1, type SqliteD1 } from "../../../agents/llm/sqlite-d1";

// The seam replaced: OpenNext's Cloudflare context. D1 is real SQLite with the real migrations, so
// the reset and the session route are seen to share one issuance table and one per-IP cap.
const mocks = vi.hoisted(() => ({ context: undefined as { env: CloudflareEnv; ctx: { waitUntil(promise: Promise<unknown>): void } } | undefined }));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => {
    if (!mocks.context) throw new Error("getCloudflareContext called without a Cloudflare context");
    return { ...mocks.context, cf: undefined };
  },
}));

const SITE = "https://twokey.afterscroll.workers.dev";
const SECRET = "test-session-secret-not-real-0123456789abcdef";
const IP = "203.0.113.9";
const loadReset = async () => import("@/app/api/judge/reset/route");
const loadSession = async () => import("@/app/api/ai/session/route");
const post = (path: string, cookie?: string) =>
  new Request(`${SITE}${path}`, {
    method: "POST",
    headers: { origin: SITE, "sec-fetch-site": "same-origin", "cf-connecting-ip": IP, ...(cookie && { cookie }) },
    body: "{}",
  });
const cookieOf = (response: Response) => (response.headers.get("set-cookie") ?? "").split(";")[0]!;

let d1: SqliteD1;

beforeEach(() => {
  vi.resetModules();
  d1 = sqliteD1();
  mocks.context = { env: { DB: d1.db }, ctx: { waitUntil: () => undefined } };
  vi.stubEnv("TWOKEY_SESSION_SECRET", SECRET);
  vi.stubEnv("TWOKEY_SITE_ORIGIN", SITE);
  vi.stubEnv("TWOKEY_AI_SESSIONS_PER_IP_PER_HOUR", "3");
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/judge/reset", () => {
  it("exports POST only, on the Node.js runtime", async () => {
    const route = await loadReset();
    expect(Object.keys(route).sort()).toEqual(["POST", "runtime"]);
    expect(route.runtime).toBe("nodejs");
  });

  it("issues a new session into the same issuance table as /api/ai/session, and shares its per-IP cap", async () => {
    const first = await (await loadSession()).POST(post("/api/ai/session"));
    expect(first.status).toBe(200);
    const { POST } = await loadReset();

    const reset = await POST(post("/api/judge/reset", cookieOf(first)));
    expect(reset.status).toBe(200);
    expect(cookieOf(reset)).toMatch(new RegExp(`^${SESSION_COOKIE}=v1\\.`));
    expect(cookieOf(reset)).not.toBe(cookieOf(first));
    expect(d1.all("SELECT session_id FROM ai_session_issuances")).toHaveLength(2);

    expect((await POST(post("/api/judge/reset", cookieOf(reset)))).status).toBe(200);
    const capped = await POST(post("/api/judge/reset", cookieOf(reset)));
    expect(capped.status).toBe(429);
    expect(capped.headers.get("set-cookie")).toBeNull();
    expect(d1.all("SELECT session_id FROM ai_session_issuances")).toHaveLength(3);
  });

  it("answers 401 without a session, and 503 without the D1 binding outside development", async () => {
    const { POST } = await loadReset();
    expect((await POST(post("/api/judge/reset"))).status).toBe(401);
    mocks.context = undefined;
    const first = await (await loadSession()).POST(post("/api/ai/session"));
    expect(first.status).toBe(503);
    expect((await POST(post("/api/judge/reset", `${SESSION_COOKIE}=v1.x`))).status).toBe(503);
  });
});
