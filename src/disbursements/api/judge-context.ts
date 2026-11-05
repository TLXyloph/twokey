/**
 * What every judge route (the ledger view and verify, the payout request, sign and risk routes)
 * checks before it touches the ledger, cheapest first, and the session's services once it passes:
 *   session secret or site origin missing             -> 503 misconfigured
 *   a TWOKEY_DEMO_KEY_* secret unset (dev included)   -> 503 demo_keys_unset
 *   POST: Origin / Sec-Fetch-Site not this site       -> 403 forbidden
 *   D1 binding missing (outside development)          -> 503 misconfigured
 *   no valid judge-session cookie                     -> 401 no_session (the browser fetches one
 *                                                        from /api/ai/session and retries)
 *   a demo key unreadable, or not the committed one   -> 503 demo_keys_invalid / demo_keys_mismatch
 *   POST: body over 8 KB                              -> 413 too_large
 *   POST: body not JSON                               -> 400 bad_request
 * Every response is JSON with `cache-control: no-store`; errors are { error: { code, message } }.
 * Log lines carry fixed codes and the first 8 characters of the session id, never a value.
 */
import { verifySession } from "@/agents/llm/judge-session";
import { checkSameOrigin } from "@/agents/llm/origin";
import { resolveSessionConfig } from "@/agents/llm/turn-config";
import type { RiskAssessor } from "@/ledger/contracts";
import { createLedgerStore, type TwoKeyLedgerStore } from "@/ledger/ledger-store";
import type { LedgerTable } from "@/ledger/ledger-table";
import type { PaypalClient } from "@/payments/paypal/client";
import type { SharedBalance } from "@/payments/paypal/balances";
import { createSessionOpener } from "../open-session";
import {
  COMMITTED_PUBLIC_KEYS,
  createSignatureVerifier,
  DEMO_KEY_ENV,
  loadDemoSigner,
  missingDemoKeys,
  OFFICER_ROLES,
  type DemoKeyEnv,
  type DemoPublicKeys,
  type DemoSigner,
  type SignatureVerifier,
  type SignerLoad,
} from "../signing";

export const MAX_JUDGE_BODY_BYTES = 8 * 1024;

export interface JudgeApiEnv extends DemoKeyEnv {
  TWOKEY_SESSION_SECRET?: string;
  TWOKEY_SITE_ORIGIN?: string;
}

export interface JudgeApiDeps {
  env: JudgeApiEnv;
  /** True only under `next dev`: admits loopback origins and makes TWOKEY_SITE_ORIGIN optional. */
  development: boolean;
  /** Undefined when the D1 binding is missing (the route uses memory under `next dev` only). */
  table: LedgerTable | undefined;
  risk: RiskAssessor;
  /** Undefined when PayPal isn't configured (sandbox credentials missing or not the sandbox). */
  paypal: PaypalClient | undefined;
  /** PayPal's shared sandbox balance (cached); absent or null shows nothing. */
  sharedBalance?(): Promise<SharedBalance | null>;
  /** Defaults to the committed src/disbursements/demo-public-keys.json. */
  publicKeys?: DemoPublicKeys;
  now?(): Date;
  newId?(): string;
  log?(line: string): void;
}

export interface JudgeContext {
  sessionId: string;
  ledger: TwoKeyLedgerStore;
  signer: DemoSigner;
  verifier: SignatureVerifier;
  risk: RiskAssessor;
  now: () => Date;
  newId: () => string;
  /** The parsed JSON body (POST only; undefined for an empty body). */
  body: unknown;
  /** Logs one line for this request: `[<route>] outcome=… status=… session=…`. */
  finish(outcome: string, status: number, detail?: string): void;
}

export type Prelude = { ok: true; ctx: JudgeContext } | { ok: false; response: Response };

const MESSAGES: Record<string, string> = {
  misconfigured: "The two-key service is not configured on this server.",
  demo_keys_unset: "The officers' demo keys aren't set on this server, so nothing can be signed.",
  demo_keys_invalid: "An officer's demo key on this server can't be read, so nothing can be signed.",
  demo_keys_mismatch: "The demo keys on this server don't match the published public keys, so nothing can be signed.",
  forbidden: "This service only answers requests from the TwoKey demo itself.",
  no_session: "No demo session: get one from /api/ai/session and try again.",
  too_large: `The request body is over ${MAX_JUDGE_BODY_BYTES} bytes.`,
  bad_request: "The request body isn't valid JSON.",
  internal: "The ledger failed on the server. Try again.",
};

const NO_STORE = { "cache-control": "no-store" } as const;

export const json = (status: number, body: unknown): Response => Response.json(body, { status, headers: NO_STORE });
export const errorJson = (status: number, code: string, message?: string): Response =>
  json(status, { error: { code, message: message ?? MESSAGES[code] ?? "The request failed." } });

// Per isolate: importing and checking the three keys is done once while the secrets are the same.
let signerCache: { key: string; publicKeys: DemoPublicKeys; load: Promise<SignerLoad> } | undefined;

function signerFor(env: DemoKeyEnv, publicKeys: DemoPublicKeys): Promise<SignerLoad> {
  const key = OFFICER_ROLES.map((role) => env[DEMO_KEY_ENV[role]] ?? "").join("\n");
  if (signerCache?.key !== key || signerCache.publicKeys !== publicKeys) {
    signerCache = { key, publicKeys, load: loadDemoSigner(env, publicKeys) };
  }
  return signerCache.load;
}

type BodyRead = { ok: true; text: string } | { ok: false; code: "too_large" | "bad_request" };

async function readBody(request: Request): Promise<BodyRead> {
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_JUDGE_BODY_BYTES) return { ok: false, code: "too_large" };
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
      if (total > MAX_JUDGE_BODY_BYTES) {
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

export async function openJudgeRequest(request: Request, deps: JudgeApiDeps, route: string): Promise<Prelude> {
  const log = deps.log ?? ((line: string) => console.info(line));
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? (() => crypto.randomUUID());
  let sessionId: string | undefined;
  const finish = (outcome: string, status: number, detail?: string) => {
    const parts = [`[${route}] outcome=${outcome}`, `status=${status}`];
    if (sessionId) parts.push(`session=${sessionId.slice(0, 8)}`);
    if (detail) parts.push(`detail=${detail}`);
    log(parts.join(" "));
  };
  const refuse = (status: number, code: string, detail?: string): Prelude => {
    finish(code, status, detail);
    return { ok: false, response: errorJson(status, code) };
  };

  const config = resolveSessionConfig(deps.env, deps.development);
  if (!config.ok) return refuse(503, "misconfigured", config.problems.join(","));
  const unsetKeys = missingDemoKeys(deps.env);
  if (unsetKeys.length > 0) return refuse(503, "demo_keys_unset", unsetKeys.join(","));
  const isPost = request.method === "POST";
  if (isPost) {
    const origin = checkSameOrigin(request.headers, config.value.origin);
    if (!origin.ok) return refuse(403, "forbidden", origin.reason);
  }
  if (!deps.table) return refuse(503, "misconfigured", "DB:unbound");
  const session = await verifySession(request.headers.get("cookie"), config.value.sessionSecret, now().getTime());
  if (!session.ok) return refuse(401, "no_session", session.reason);
  sessionId = session.session.id;

  const publicKeys = deps.publicKeys ?? COMMITTED_PUBLIC_KEYS;
  const loaded = await signerFor(deps.env, publicKeys);
  if (!loaded.ok) return refuse(503, loaded.code, loaded.problems.join(","));

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

  const ledger = createLedgerStore(deps.table, {
    opener: createSessionOpener({ signer: loaded.signer, risk: deps.risk }),
    now,
  });
  return {
    ok: true,
    ctx: {
      sessionId,
      ledger,
      signer: loaded.signer,
      verifier: createSignatureVerifier(publicKeys),
      risk: deps.risk,
      now,
      newId,
      body,
      finish,
    },
  };
}

/** Logs a failure inside a handler as one line with a fixed code, and answers 500. */
export function internalError(ctx: Pick<JudgeContext, "finish">, error: unknown): Response {
  ctx.finish("internal", 500, error instanceof Error && error.name === "LedgerConflictError" ? "ledger_conflict" : "ledger_error");
  return errorJson(500, "internal");
}
