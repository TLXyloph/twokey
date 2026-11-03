/**
 * `POST /api/ai/session`'s core: hands the demo's browser its judge-session cookie
 * (./judge-session.ts). The AI adapter calls it after its first turn is answered 401.
 *
 *   TWOKEY_SESSION_SECRET, TWOKEY_SITE_ORIGIN or
 *   TWOKEY_AI_SESSIONS_PER_IP_PER_HOUR missing          -> 503 misconfigured
 *   Origin / Sec-Fetch-Site not this site                -> 403 forbidden (no cookie)
 *   a still-valid session cookie came with the request   -> 200 { session: "existing" } (kept, not counted)
 *   D1 binding missing                                   -> 503 misconfigured
 *   this IP already got its cap of new sessions this hour -> 429 rate_limited (no cookie)
 *   issuance log failure                                 -> 500 internal (no cookie)
 *   otherwise                                            -> 200 { session: "issued" } + Set-Cookie
 * Keeping a valid session means a page reload keeps its per-session limits.
 *
 * The cap is per client IP, from Cloudflare's `cf-connecting-ip` (set by Cloudflare's edge; a
 * client cannot override it). Only an HMAC of the IP, keyed with the session secret, is stored or
 * compared; the IP itself is never stored or logged. A request without the header (plain `next
 * dev`, or a misrouted request in production) counts against ONE shared bucket, so such requests
 * together get the same cap as one IP: that fails closed rather than uncapped.
 */
import { clientIpHmac, issueSession, verifySession, type RandomBytes } from "./judge-session";
import { checkSameOrigin } from "./origin";
import type { SessionIssuanceLog } from "./session-issuance-log";
import { resolveSessionIssueConfig, type AiConfigEnv } from "./turn-config";

/** The bucket for requests that carry no `cf-connecting-ip`. */
export const SHARED_IP_BUCKET = "no-cf-connecting-ip";
const MAX_IP_LENGTH = 100;

export interface SessionHandlerDeps {
  env: Pick<AiConfigEnv, "TWOKEY_SESSION_SECRET" | "TWOKEY_SITE_ORIGIN" | "TWOKEY_AI_SESSIONS_PER_IP_PER_HOUR">;
  development: boolean;
  /** Undefined when the D1 binding is missing. */
  issuances: SessionIssuanceLog | undefined;
  now?(): number;
  randomBytes?: RandomBytes;
  log?(line: string): void;
}

const NO_STORE = { "cache-control": "no-store" } as const;

export async function handleSessionRequest(request: Request, deps: SessionHandlerDeps): Promise<Response> {
  const log = deps.log ?? ((line: string) => console.info(line));
  const now = deps.now ?? Date.now;
  const refuse = (status: number, code: string, message: string, detail?: string) => {
    log(`[ai/session] outcome=${code} status=${status}${detail ? ` detail=${detail}` : ""}`);
    return Response.json({ error: { code, message } }, { status, headers: NO_STORE });
  };

  const config = resolveSessionIssueConfig(deps.env, deps.development);
  if (!config.ok) return refuse(503, "misconfigured", "The AI service is not configured on this server.", config.problems.join(","));
  const { sessionSecret, origin, ipLimit } = config.value;
  const sameOrigin = checkSameOrigin(request.headers, origin);
  if (!sameOrigin.ok) return refuse(403, "forbidden", "Sessions are only issued to the TwoKey demo itself.", sameOrigin.reason);

  const existing = await verifySession(request.headers.get("cookie"), sessionSecret, now());
  if (existing.ok) {
    log(`[ai/session] outcome=existing status=200 session=${existing.session.id.slice(0, 8)}`);
    return Response.json({ ok: true, session: "existing" }, { headers: NO_STORE });
  }
  if (!deps.issuances) return refuse(503, "misconfigured", "The AI service is not configured on this server.", "DB:unbound");

  const ip = request.headers.get("cf-connecting-ip")?.trim().slice(0, MAX_IP_LENGTH) || SHARED_IP_BUCKET;
  const issued = await issueSession(sessionSecret, now(), deps.randomBytes);
  let outcome: "issued" | "ip_limited";
  try {
    outcome = await deps.issuances.issue({ sessionId: issued.session.id, ipHmac: await clientIpHmac(sessionSecret, ip), at: now() }, ipLimit);
  } catch {
    return refuse(500, "internal", "The demo session could not be started.", "store_error");
  }
  if (outcome === "ip_limited") {
    return refuse(429, "rate_limited", "Too many new demo sessions from this network. Try again in an hour.", "ip_cap");
  }
  log(`[ai/session] outcome=issued status=200 session=${issued.session.id.slice(0, 8)}`);
  return Response.json({ ok: true, session: "issued" }, { headers: { ...NO_STORE, "set-cookie": issued.setCookie } });
}
