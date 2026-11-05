/**
 * The Watchtower routes' cores (route files are glue; deps come from ./worker-deps.ts).
 *
 * POST /api/watchtower/run (the Cron Trigger only; never a browser)
 *   TWOKEY_CRON_SECRET unset, or under 32 characters -> 503 misconfigured
 *   Authorization isn't exactly `Bearer <secret>`     -> 401 unauthorized (compared in constant time)
 *   D1 binding missing                                 -> 503 misconfigured
 *   ran (PayPal's own refusal is an outcome, recorded) -> 200 { outcome, newFindings }
 *   storage failed                                     -> 500 internal (no run recorded: silence)
 *
 * POST /api/watchtower/replay (judge mode)
 *   session secret or site origin missing              -> 503 misconfigured
 *   Origin / Sec-Fetch-Site not this site              -> 403 forbidden
 *   no valid judge-session cookie                      -> 401 no_session
 *   replayed (nothing stored)                          -> 200 WatchReplay
 *
 * Every response is JSON with `cache-control: no-store`; errors are { error: { code, message } }.
 * One log line per request with fixed codes: never the secret, a header or a body.
 */
import { verifySession } from "@/agents/llm/judge-session";
import { checkSameOrigin } from "@/agents/llm/origin";
import { resolveSessionConfig } from "@/agents/llm/turn-config";
import { replayOutsideSend } from "../replay";
import { runWatchtower, type RunDeps } from "../run";

export const MIN_CRON_SECRET_LENGTH = 32;

export interface RunApiDeps {
  /** TWOKEY_CRON_SECRET. */
  secret: string | undefined;
  /** Undefined when the D1 binding is missing. */
  run: RunDeps | undefined;
  log?(line: string): void;
}

export interface ReplayApiDeps {
  env: { TWOKEY_SESSION_SECRET?: string; TWOKEY_SITE_ORIGIN?: string };
  /** True only under `next dev`: admits loopback origins and makes TWOKEY_SITE_ORIGIN optional. */
  development: boolean;
  now?(): Date;
  log?(line: string): void;
}

const MESSAGES: Record<string, string> = {
  misconfigured: "The Watchtower is not configured on this server.",
  unauthorized: "This route only answers TwoKey's own scheduled check.",
  forbidden: "This service only answers requests from the TwoKey demo itself.",
  no_session: "No demo session: get one from /api/ai/session and try again.",
  internal: "The Watchtower failed on the server. It will try again on its next check.",
};

const NO_STORE = { "cache-control": "no-store" } as const;
const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  Response.json(body, { status, headers: { ...NO_STORE, ...headers } });
const errorJson = (status: number, code: string, headers?: Record<string, string>): Response =>
  json(status, { error: { code, message: MESSAGES[code] ?? "The request failed." } }, headers);

const logger = (log: ((line: string) => void) | undefined) => log ?? ((line: string) => console.info(line));

async function digest(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

/**
 * True only for `Bearer <secret>` exactly. Both sides are hashed first, so the comparison takes the
 * same time whatever the secret's length or the first differing character.
 */
export async function bearerMatches(header: string | null, secret: string): Promise<boolean> {
  const token = /^Bearer (.+)$/i.exec(header ?? "")?.[1] ?? "";
  const [given, expected] = await Promise.all([digest(token), digest(secret)]);
  let difference = token === "" ? 1 : 0;
  for (let i = 0; i < expected.length; i++) difference |= given[i]! ^ expected[i]!;
  return difference === 0;
}

export async function handleWatchtowerRun(request: Request, deps: RunApiDeps): Promise<Response> {
  const log = logger(deps.log);
  const finish = (outcome: string, status: number, detail?: string) =>
    log(`[watchtower/run-route] outcome=${outcome} status=${status}${detail ? ` detail=${detail}` : ""}`);

  const secret = deps.secret?.trim() ?? "";
  if (secret.length < MIN_CRON_SECRET_LENGTH) {
    finish("misconfigured", 503, secret === "" ? "TWOKEY_CRON_SECRET:unset" : "TWOKEY_CRON_SECRET:too_short");
    return errorJson(503, "misconfigured");
  }
  if (!(await bearerMatches(request.headers.get("authorization"), secret))) {
    finish("unauthorized", 401);
    return errorJson(401, "unauthorized", { "www-authenticate": "Bearer" });
  }
  if (!deps.run) {
    finish("misconfigured", 503, "DB:unbound");
    return errorJson(503, "misconfigured");
  }
  try {
    const summary = await runWatchtower(deps.run);
    finish(summary.outcome, 200);
    return json(200, { outcome: summary.outcome, newFindings: summary.newFindings });
  } catch {
    finish("internal", 500);
    return errorJson(500, "internal");
  }
}

export async function handleWatchtowerReplay(request: Request, deps: ReplayApiDeps): Promise<Response> {
  const log = logger(deps.log);
  const now = deps.now?.() ?? new Date();
  const finish = (outcome: string, status: number, extra = "") => log(`[watchtower/replay] outcome=${outcome} status=${status}${extra}`);

  const config = resolveSessionConfig(deps.env, deps.development);
  if (!config.ok) {
    finish("misconfigured", 503, ` detail=${config.problems.join(",")}`);
    return errorJson(503, "misconfigured");
  }
  const origin = checkSameOrigin(request.headers, config.value.origin);
  if (!origin.ok) {
    finish("forbidden", 403, ` detail=${origin.reason}`);
    return errorJson(403, "forbidden");
  }
  const session = await verifySession(request.headers.get("cookie"), config.value.sessionSecret, now.getTime());
  if (!session.ok) {
    finish("no_session", 401, ` detail=${session.reason}`);
    return errorJson(401, "no_session");
  }
  finish("replayed", 200, ` session=${session.session.id.slice(0, 8)}`);
  return json(200, replayOutsideSend(now));
}
