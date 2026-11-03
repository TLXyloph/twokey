import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE } from "@/agents/llm/judge-session";
import { sqliteD1, type SqliteD1 } from "../../../../agents/llm/sqlite-d1";

// The seam replaced: OpenNext's Cloudflare context. D1 is real SQLite with the real migrations.
const mocks = vi.hoisted(() => ({ context: undefined as { env: CloudflareEnv; ctx: { waitUntil(promise: Promise<unknown>): void } } | undefined }));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => {
    if (!mocks.context) throw new Error("getCloudflareContext called without a Cloudflare context");
    return { ...mocks.context, cf: undefined };
  },
}));

const SITE = "https://twokey.afterscroll.workers.dev";
const SECRET = "test-session-secret-not-real-0123456789abcdef";
const loadRoute = async () => import("@/app/api/ai/session/route");
const post = (origin = SITE, ip = "203.0.113.9") =>
  new Request(`${SITE}/api/ai/session`, { method: "POST", headers: { origin, "sec-fetch-site": "same-origin", "cf-connecting-ip": ip } });

let d1: SqliteD1;

beforeEach(() => {
  vi.resetModules();
  d1 = sqliteD1();
  mocks.context = { env: { DB: d1.db }, ctx: { waitUntil: () => undefined } };
  vi.stubEnv("TWOKEY_SESSION_SECRET", SECRET);
  vi.stubEnv("TWOKEY_SITE_ORIGIN", SITE);
  vi.stubEnv("TWOKEY_AI_SESSIONS_PER_IP_PER_HOUR", "5");
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/ai/session", () => {
  it("exports POST only, on the Node.js runtime", async () => {
    const route = await loadRoute();
    expect(Object.keys(route).sort()).toEqual(["POST", "runtime"]);
    expect(route.runtime).toBe("nodejs");
  });

  it("sets the judge-session cookie for the site itself, and logs the issuance in D1 by IP HMAC", async () => {
    const response = await (await loadRoute()).POST(post());
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toMatch(new RegExp(`^${SESSION_COOKIE}=v1\\.`));
    const rows = d1.all("SELECT ip_hmac FROM ai_session_issuances") as { ip_hmac: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.ip_hmac).toMatch(/^[0-9a-f]{64}$/);
  });

  it("answers 429 to a sixth new session from one IP within the hour", async () => {
    const { POST } = await loadRoute();
    for (let i = 0; i < 5; i++) expect((await POST(post())).status).toBe(200);
    expect((await POST(post())).status).toBe(429);
    expect((await POST(post(SITE, "198.51.100.1"))).status).toBe(200);
  });

  it("refuses another site, and answers 503 without the secret or the D1 binding", async () => {
    const { POST } = await loadRoute();
    expect((await POST(post("https://evil.example"))).status).toBe(403);
    mocks.context = undefined;
    expect((await POST(post())).status).toBe(503);
    vi.stubEnv("TWOKEY_SESSION_SECRET", "");
    expect((await POST(post())).status).toBe(503);
  });
});
