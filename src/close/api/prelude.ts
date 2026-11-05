/**
 * What both close routes check before they answer, cheapest first (the same order and codes as the
 * other judge routes, src/disbursements/api/judge-context.ts, without the officers' demo keys or
 * the ledger, which the close doesn't touch):
 *   session secret or site origin missing             -> 503 misconfigured
 *   POST: Origin / Sec-Fetch-Site not this site       -> 403 forbidden
 *   sign-off store missing (no D1 outside dev)        -> 503 misconfigured
 *   no valid judge-session cookie                     -> 401 no_session (the page fetches one from
 *                                                        /api/ai/session and retries)
 *   POST: body over 8 KB                              -> 413 too_large
 *   POST: body not JSON                               -> 400 bad_request
 * Every response is JSON with `cache-control: no-store`; errors are { error: { code, message } }.
 * Log lines carry fixed codes and the first 8 characters of the session id, never a value.
 */
import { verifySession } from "@/agents/llm/judge-session";
import { checkSameOrigin } from "@/agents/llm/origin";
import { resolveSessionConfig } from "@/agents/llm/turn-config";
import type { ReviewerPublicKey } from "../reviewer-key";
import type { CloseSignoffStore } from "../signoff-store";

export const MAX_CLOSE_BODY_BYTES = 8 * 1024;

export interface CloseApiDeps {
  env: { TWOKEY_SESSION_SECRET?: string; TWOKEY_SITE_ORIGIN?: string; TWOKEY_DEMO_KEY_REVIEWER?: string };
  /** True only under `next dev`: admits loopback origins and makes TWOKEY_SITE_ORIGIN optional. */
  development: boolean;
  /** Undefined when the D1 binding is missing (memory is used under `next dev` only). */
  store: CloseSignoffStore | undefined;
  /** recorded-draft.json's contents; defaults to the committed file. */
  recordedDraft?: unknown;
  /** Defaults to the committed src/close/reviewer-public-key.json. */
  publicKey?: ReviewerPublicKey;
  now?(): Date;
  log?(line: string): void;
}

export interface CloseRequestContext {
  sessionId: string;
  store: CloseSignoffStore;
  now: () => Date;
  /** The parsed JSON body (POST only; undefined for an empty body). */
  body: unknown;
  finish(outcome: string, status: number, detail?: string): void;
}

const MESSAGES: Record<string, string> = {
  misconfigured: "The monthly close isn't configured on this server.",
  forbidden: "This service only answers requests from the TwoKey demo itself.",
  no_session: "No demo session: get one from /api/ai/session and try again.",
  too_large: `The request body is over ${MAX_CLOSE_BODY_BYTES} bytes.`,
  bad_request: "The request body isn't valid JSON.",
  internal: "The monthly close failed on the server. Try again.",
};

const NO_STORE = { "cache-control": "no-store" } as const;

export const json = (status: number, body: unknown): Response => Response.json(body, { status, headers: NO_STORE });
export const errorJson = (status: number, code: string, message?: string): Response =>
  json(status, { error: { code, message: message ?? MESSAGES[code] ?? "The request failed." } });

type BodyRead = { ok: true; text: string } | { ok: false; code: "too_large" | "bad_request" };

async function readBody(request: Request): Promise<BodyRead> {
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_CLOSE_BODY_BYTES) return { ok: false, code: "too_large" };
  if (!request.body) return { ok: true, text: "" };
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "";
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_CLOSE_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, code: "too_large" };
      }
      text += decoder.decode(value, { stream: true });
    }
    return { ok: true, text: text + decoder.decode() };
  } catch {
    return { ok: false, code: "bad_request" };
  }
}

export type ClosePrelude = { ok: true; ctx: CloseRequestContext } | { ok: false; response: Response };

export async function openCloseRequest(request: Request, deps: CloseApiDeps, route: string): Promise<ClosePrelude> {
  const log = deps.log ?? ((line: string) => console.info(line));
  const now = deps.now ?? (() => new Date());
  let sessionId: string | undefined;
  const finish = (outcome: string, status: number, detail?: string) => {
    const parts = [`[${route}] outcome=${outcome}`, `status=${status}`];
    if (sessionId) parts.push(`session=${sessionId.slice(0, 8)}`);
    if (detail) parts.push(`detail=${detail}`);
    log(parts.join(" "));
  };
  const refuse = (status: number, code: string, detail?: string): ClosePrelude => {
    finish(code, status, detail);
    return { ok: false, response: errorJson(status, code) };
  };

  const config = resolveSessionConfig(deps.env, deps.development);
  if (!config.ok) return refuse(503, "misconfigured", config.problems.join(","));
  const isPost = request.method === "POST";
  if (isPost) {
    const origin = checkSameOrigin(request.headers, config.value.origin);
    if (!origin.ok) return refuse(403, "forbidden", origin.reason);
  }
  if (!deps.store) return refuse(503, "misconfigured", "DB:unbound");
  const session = await verifySession(request.headers.get("cookie"), config.value.sessionSecret, now().getTime());
  if (!session.ok) return refuse(401, "no_session", session.reason);
  sessionId = session.session.id;

  let body: unknown;
  if (isPost) {
    const read = await readBody(request);
    if (!read.ok) return refuse(read.code === "too_large" ? 413 : 400, read.code);
    if (read.text.trim() !== "") {
      try {
        body = JSON.parse(read.text);
      } catch {
        return refuse(400, "bad_request", "json");
      }
    }
  }
  return { ok: true, ctx: { sessionId, store: deps.store, now, body, finish } };
}

/** Logs a failure inside a handler as one line with a fixed code, and answers 500. */
export function internalError(ctx: Pick<CloseRequestContext, "finish">): Response {
  ctx.finish("internal", 500, "store_error");
  return errorJson(500, "internal");
}
