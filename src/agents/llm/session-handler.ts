/**
 * `POST /api/ai/session`'s core: hands the demo's browser its judge-session cookie
 * (./judge-session.ts). The AI adapter calls it before its first turn, and again after a 401.
 *
 *   TWOKEY_SESSION_SECRET or TWOKEY_SITE_ORIGIN missing  -> 503 misconfigured
 *   Origin / Sec-Fetch-Site not this site                -> 403 forbidden (no cookie)
 *   a still-valid session cookie came with the request   -> 200 { session: "existing" } (kept)
 *   otherwise                                            -> 200 { session: "issued" } + Set-Cookie
 * Keeping a valid session means a page reload keeps its per-session limits.
 */
import { issueSession, verifySession, type RandomBytes } from "./judge-session";
import { checkSameOrigin } from "./origin";
import { resolveSessionConfig, type AiConfigEnv } from "./turn-config";

export interface SessionHandlerDeps {
  env: Pick<AiConfigEnv, "TWOKEY_SESSION_SECRET" | "TWOKEY_SITE_ORIGIN">;
  development: boolean;
  now?(): number;
  randomBytes?: RandomBytes;
  log?(line: string): void;
}

const NO_STORE = { "cache-control": "no-store" } as const;

export async function handleSessionRequest(request: Request, deps: SessionHandlerDeps): Promise<Response> {
  const log = deps.log ?? ((line: string) => console.info(line));
  const now = deps.now ?? Date.now;
  const refuse = (status: number, code: string, message: string, detail: string) => {
    log(`[ai/session] outcome=${code} status=${status} detail=${detail}`);
    return Response.json({ error: { code, message } }, { status, headers: NO_STORE });
  };

  const config = resolveSessionConfig(deps.env, deps.development);
  if (!config.ok) return refuse(503, "misconfigured", "The AI service is not configured on this server.", config.problems.join(","));
  const origin = checkSameOrigin(request.headers, config.value.origin);
  if (!origin.ok) return refuse(403, "forbidden", "Sessions are only issued to the TwoKey demo itself.", origin.reason);

  const existing = await verifySession(request.headers.get("cookie"), config.value.sessionSecret, now());
  if (existing.ok) {
    log(`[ai/session] outcome=existing status=200 session=${existing.session.id.slice(0, 8)}`);
    return Response.json({ ok: true, session: "existing" }, { headers: NO_STORE });
  }
  const issued = await issueSession(config.value.sessionSecret, now(), deps.randomBytes);
  log(`[ai/session] outcome=issued status=200 session=${issued.session.id.slice(0, 8)}`);
  return Response.json({ ok: true, session: "issued" }, { headers: { ...NO_STORE, "set-cookie": issued.setCookie } });
}
