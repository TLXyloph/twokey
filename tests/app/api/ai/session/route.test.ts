import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE } from "@/agents/llm/judge-session";

const SITE = "https://twokey.afterscroll.workers.dev";
const SECRET = "test-session-secret-not-real-0123456789abcdef";
const loadRoute = async () => import("@/app/api/ai/session/route");
const post = (origin = SITE) => new Request(`${SITE}/api/ai/session`, { method: "POST", headers: { origin, "sec-fetch-site": "same-origin" } });

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("TWOKEY_SESSION_SECRET", SECRET);
  vi.stubEnv("TWOKEY_SITE_ORIGIN", SITE);
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

  it("sets the judge-session cookie for the site itself", async () => {
    const response = await (await loadRoute()).POST(post());
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toMatch(new RegExp(`^${SESSION_COOKIE}=v1\\.`));
  });

  it("refuses another site, and answers 503 without the secret", async () => {
    const { POST } = await loadRoute();
    expect((await POST(post("https://evil.example"))).status).toBe(403);
    vi.stubEnv("TWOKEY_SESSION_SECRET", "");
    expect((await POST(post())).status).toBe(503);
  });
});
