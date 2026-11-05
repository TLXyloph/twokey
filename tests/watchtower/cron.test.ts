import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { FALLBACK_ORIGIN, runScheduledWatch, type CronEnv } from "@/watchtower/cron";

const SECRET = "test-cron-secret-not-real-0123456789abcdefghij";
const SITE = "https://twokey.afterscroll.workers.dev";
const ctx = { waitUntil: vi.fn() };

function handler(response: () => Response | Promise<Response>) {
  return vi.fn(async (_request: Request, _env: CronEnv, _ctx: typeof ctx) => response());
}

describe("runScheduledWatch", () => {
  it("POSTs /api/watchtower/run on the app's own fetch handler with the Bearer secret, the env and the context", async () => {
    const fetch = handler(() => Response.json({ outcome: "ok", newFindings: 2 }));
    const lines: string[] = [];
    const env = { TWOKEY_CRON_SECRET: SECRET, TWOKEY_SITE_ORIGIN: SITE };
    await runScheduledWatch(fetch, env, ctx, (line) => lines.push(line));
    expect(fetch).toHaveBeenCalledTimes(1);
    const [request, passedEnv, passedCtx] = fetch.mock.calls[0]!;
    expect(request.method).toBe("POST");
    expect(request.url).toBe(`${SITE}/api/watchtower/run`);
    expect(request.headers.get("authorization")).toBe(`Bearer ${SECRET}`);
    expect(passedEnv).toBe(env);
    expect(passedCtx).toBe(ctx);
    expect(lines).toEqual(["[watchtower/cron] status=200 outcome=ok new=2"]);
  });

  it("uses a fixed origin when the site origin isn't set", async () => {
    const fetch = handler(() => Response.json({ outcome: "ok", newFindings: 0 }));
    await runScheduledWatch(fetch, { TWOKEY_CRON_SECRET: SECRET, TWOKEY_SITE_ORIGIN: "not a url" }, ctx, () => undefined);
    expect(fetch.mock.calls[0]![0].url).toBe(`${FALLBACK_ORIGIN}/api/watchtower/run`);
  });

  it("doesn't call the route without a secret, and says so", async () => {
    const fetch = handler(() => Response.json({}));
    const lines: string[] = [];
    await runScheduledWatch(fetch, { TWOKEY_SITE_ORIGIN: SITE }, ctx, (line) => lines.push(line));
    expect(fetch).not.toHaveBeenCalled();
    expect(lines).toEqual(["[watchtower/cron] outcome=skipped detail=TWOKEY_CRON_SECRET:unset"]);
  });

  it("fails the scheduled event (so Cloudflare's cron log shows it) when the route doesn't answer 200", async () => {
    const lines: string[] = [];
    const fetch = handler(() => Response.json({ error: { code: "internal" } }, { status: 500 }));
    await expect(runScheduledWatch(fetch, { TWOKEY_CRON_SECRET: SECRET }, ctx, (line) => lines.push(line))).rejects.toThrow("watchtower run answered 500");
    expect(lines).toEqual(["[watchtower/cron] status=500"]);
  });

  it("never logs the secret", async () => {
    const lines: string[] = [];
    await runScheduledWatch(handler(() => Response.json({ outcome: "ok", newFindings: 0 })), { TWOKEY_CRON_SECRET: SECRET }, ctx, (line) => lines.push(line));
    expect(lines.join("\n")).not.toContain(SECRET);
  });
});

describe("the Worker entry (src/platform/cron-worker.ts) and wrangler.jsonc", () => {
  const root = new URL("../../", import.meta.url);
  const entry = readFileSync(new URL("src/platform/cron-worker.ts", root), "utf8");
  const template = readFileSync(new URL("node_modules/@opennextjs/cloudflare/dist/cli/templates/worker.js", root), "utf8");
  const wrangler = readFileSync(new URL("wrangler.jsonc", root), "utf8");

  it("re-exports every Durable Object class OpenNext's generated worker exports", () => {
    const named = [...template.matchAll(/^export \{ (\w+) \} from/gm)].map((match) => match[1]!);
    expect(named.length).toBeGreaterThan(0);
    const reexport = /export \{ ([\w, ]+) \} from "\.\.\/\.\.\/\.open-next\/worker\.js";/.exec(entry);
    expect(reexport?.[1]!.split(/,\s*/).sort()).toEqual([...named].sort());
  });

  it("is the Worker's main, with a Cron Trigger every 10 minutes", () => {
    expect(wrangler).toMatch(/"main": "src\/platform\/cron-worker\.ts"/);
    expect(wrangler).toMatch(/"triggers": \{ "crons": \["\*\/10 \* \* \* \*"\] \}/);
  });
});
