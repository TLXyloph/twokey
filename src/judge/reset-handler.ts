/**
 * `POST /api/judge/reset`'s core: judge mode's "Start over". It hands the browser a fresh judge
 * session, so the board opens again from the seed (each session's ledger starts from the seed;
 * docs/twokey-concept.md §10). The old session's events stay in the append-only ledger; nothing is
 * deleted. A new session costs what any new session costs: it goes through the same issuance log
 * and per-IP cap as `POST /api/ai/session` (src/agents/llm/session-handler.ts).
 *
 *   session secret, site origin or the per-IP cap unset   -> 503 misconfigured
 *   Origin / Sec-Fetch-Site not this site                 -> 403 forbidden (no cookie)
 *   D1 binding missing                                    -> 503 misconfigured
 *   no valid judge-session cookie                         -> 401 no_session (nothing to start over)
 *   body over 8 KB                                        -> 413 too_large
 *   body neither empty nor a JSON object without fields   -> 400 bad_request
 *   this IP already got its cap of new sessions this hour -> 429 rate_limited (the old session is kept)
 *   issuance log failure                                  -> 500 internal (no cookie)
 *   otherwise                                             -> 200 { ok: true, session: "issued" } + Set-Cookie
 *
 * Every response is JSON with `cache-control: no-store`; errors are { error: { code, message } }.
 * One log line per request, with fixed codes and the first 8 characters of the session ids; never
 * the IP, a header, the cookie or the secret.
 */
import { clientIpHmac, issueSession, verifySession, type RandomBytes } from "@/agents/llm/judge-session";
import { checkSameOrigin } from "@/agents/llm/origin";
import { SHARED_IP_BUCKET } from "@/agents/llm/session-handler";
import type { SessionIssuanceLog } from "@/agents/llm/session-issuance-log";
import { resolveSessionIssueConfig, type AiConfigEnv } from "@/agents/llm/turn-config";

export const MAX_RESET_BODY_BYTES = 8 * 1024;
const MAX_IP_LENGTH = 100;

export interface ResetHandlerDeps {
  env: Pick<AiConfigEnv, "TWOKEY_SESSION_SECRET" | "TWOKEY_SITE_ORIGIN" | "TWOKEY_AI_SESSIONS_PER_IP_PER_HOUR">;
  /** True only under `next dev`: admits loopback origins and makes TWOKEY_SITE_ORIGIN optional. */
  development: boolean;
  /** The judge-session issuance log; undefined when the D1 binding is missing. */
  issuances: SessionIssuanceLog | undefined;
  now?(): number;
  randomBytes?: RandomBytes;
  log?(line: string): void;
}

export const RESET_MESSAGES = {
  misconfigured: "Starting over isn't set up on this server.",
  forbidden: "Only the TwoKey demo itself can start a judge session over.",
  no_session: "There's no demo session to start over. Reload the page to begin from the seed.",
  too_large: `The request body is over ${MAX_RESET_BODY_BYTES} bytes.`,
  bad_request: "Starting over takes no options: send an empty body or {}.",
  rate_limited: "This network has started the most new demo sessions allowed in an hour, so the demo can't start over yet. Your current session is still here; try again within the hour.",
  internal: "The demo couldn't start over just now. Your current session is still here; try again in a moment.",
} as const;

export type ResetErrorCode = keyof typeof RESET_MESSAGES;

const NO_STORE = { "cache-control": "no-store" } as const;

type BodyCheck = { ok: true } | { ok: false; code: "too_large" | "bad_request" };

/** Reads at most 8 KB; accepts an empty body or `{}` (whitespace allowed), nothing else. */
async function checkBody(request: Request): Promise<BodyCheck> {
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_RESET_BODY_BYTES) return { ok: false, code: "too_large" };
  if (!request.body) return { ok: true };
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "";
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESET_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, code: "too_large" };
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch {
    return { ok: false, code: "bad_request" };
  }
  if (text.trim() === "") return { ok: true };
  try {
    const body: unknown = JSON.parse(text);
    const empty = typeof body === "object" && body !== null && !Array.isArray(body) && Object.keys(body).length === 0;
    return empty ? { ok: true } : { ok: false, code: "bad_request" };
  } catch {
    return { ok: false, code: "bad_request" };
  }
}

export async function handleJudgeReset(request: Request, deps: ResetHandlerDeps): Promise<Response> {
  const log = deps.log ?? ((line: string) => console.info(line));
  const now = deps.now ?? Date.now;
  let previous: string | undefined;
  const finish = (outcome: string, status: number, detail?: string, session?: string) => {
    const parts = [`[judge/reset] outcome=${outcome}`, `status=${status}`];
    if (previous) parts.push(`from=${previous.slice(0, 8)}`);
    if (session) parts.push(`session=${session.slice(0, 8)}`);
    if (detail) parts.push(`detail=${detail}`);
    log(parts.join(" "));
  };
  const refuse = (status: number, code: ResetErrorCode, detail?: string) => {
    finish(code, status, detail);
    return Response.json({ error: { code, message: RESET_MESSAGES[code] } }, { status, headers: NO_STORE });
  };

  const config = resolveSessionIssueConfig(deps.env, deps.development);
  if (!config.ok) return refuse(503, "misconfigured", config.problems.join(","));
  const { sessionSecret, origin, ipLimit } = config.value;
  const sameOrigin = checkSameOrigin(request.headers, origin);
  if (!sameOrigin.ok) return refuse(403, "forbidden", sameOrigin.reason);
  if (!deps.issuances) return refuse(503, "misconfigured", "DB:unbound");

  const current = await verifySession(request.headers.get("cookie"), sessionSecret, now());
  if (!current.ok) return refuse(401, "no_session", current.reason);
  previous = current.session.id;

  const body = await checkBody(request);
  if (!body.ok) return refuse(body.code === "too_large" ? 413 : 400, body.code);

  const ip = request.headers.get("cf-connecting-ip")?.trim().slice(0, MAX_IP_LENGTH) || SHARED_IP_BUCKET;
  const issued = await issueSession(sessionSecret, now(), deps.randomBytes);
  let outcome: "issued" | "ip_limited";
  try {
    outcome = await deps.issuances.issue({ sessionId: issued.session.id, ipHmac: await clientIpHmac(sessionSecret, ip), at: now() }, ipLimit);
  } catch {
    return refuse(500, "internal", "store_error");
  }
  if (outcome === "ip_limited") return refuse(429, "rate_limited", "ip_cap");

  finish("issued", 200, undefined, issued.session.id);
  return Response.json({ ok: true, session: "issued" }, { headers: { ...NO_STORE, "set-cookie": issued.setCookie } });
}
