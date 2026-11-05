/**
 * What the Collections routes share: their configuration, the checks every POST passes before it
 * touches PayPal or the ledger, and plain-words JSON errors (`{ error: { code, message } }`).
 *
 * Checks run cheapest first:
 *   config missing or malformed (session secret, site origin, PayPal app)  -> 503 misconfigured
 *   Origin / Sec-Fetch-Site not this site                                  -> 403 forbidden
 *   ledger store not wired                                                 -> 503 misconfigured
 *   no valid judge-session cookie                                          -> 401 no_session
 *   body over 8 KB or unreadable                                           -> 400 bad_request
 *
 * Every response is `cache-control: no-store`. Log lines carry fixed codes, a short session prefix
 * and PayPal's order and capture ids (not secret); never the cookie, a token or a credential.
 */
import { verifySession } from "@/agents/llm/judge-session";
import { readBodyText } from "@/agents/llm/guardrails";
import { checkSameOrigin } from "@/agents/llm/origin";
import { resolveSessionConfig, type ConfigCheck, type SessionConfig } from "@/agents/llm/turn-config";
import type { LedgerStore } from "@/ledger/contracts";
import { resolveSandboxApiBase } from "@/payments/paypal/client";
import type { OrdersClient } from "@/payments/paypal/orders";

export const MAX_BODY_BYTES = 8 * 1024;

/** The env values the Collections routes read (secrets and vars). */
export interface CollectionsEnv {
  TWOKEY_SESSION_SECRET?: string;
  TWOKEY_SITE_ORIGIN?: string;
  PAYPAL_CLIENT_ID?: string;
  PAYPAL_CLIENT_SECRET?: string;
  PAYPAL_API_BASE?: string;
}

export interface PaypalAppConfig {
  clientId: string;
  clientSecret: string;
  apiBase: string;
}

export interface CollectionsConfig extends SessionConfig {
  paypal: PaypalAppConfig;
}

export interface CollectionsHandlerDeps {
  env: CollectionsEnv;
  /** True only under `next dev`: admits loopback origins and makes TWOKEY_SITE_ORIGIN optional. */
  development: boolean;
  /** Undefined until the D1 ledger is wired (src/collections/wiring.ts). */
  store: LedgerStore | undefined;
  /** Builds (or reuses) the PayPal REST client for this app; the route caches it per isolate. */
  paypalFor(config: PaypalAppConfig): OrdersClient;
  now?(): number;
  newId?(): string;
  log?(line: string): void;
}

export type CollectionsErrorCode =
  | "misconfigured"
  | "forbidden"
  | "no_session"
  | "bad_request"
  | "unknown_order"
  | "payment_declined"
  | "not_approved"
  | "already_captured"
  | "paypal_unavailable"
  | "paypal_error"
  | "ledger_error";

export const MESSAGES: Record<CollectionsErrorCode, string> = {
  misconfigured: "Payments aren't set up on this server yet.",
  forbidden: "Payments only take requests from the TwoKey demo itself.",
  no_session: "Your demo session has ended. Reload the page and try again.",
  bad_request: "That request wasn't understood.",
  unknown_order: "That order isn't part of this demo session.",
  payment_declined: "PayPal declined that payment, so nothing was charged. Try another way to pay.",
  not_approved: "PayPal hasn't approved this payment yet, so nothing was charged.",
  already_captured: "This order has already been paid.",
  paypal_unavailable: "PayPal didn't answer. Nothing was charged; try again in a moment.",
  paypal_error: "PayPal couldn't take this payment. Nothing was charged.",
  ledger_error: "The club's ledger couldn't record this. Try again in a moment.",
};

const NO_STORE = { "cache-control": "no-store" } as const;

export function jsonResponse(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

export function errorResponse(status: number, code: CollectionsErrorCode, message?: string): Response {
  return jsonResponse(status, { error: { code, message: message ?? MESSAGES[code] } });
}

export function resolveCollectionsConfig(env: CollectionsEnv, development: boolean): ConfigCheck<CollectionsConfig> {
  const session = resolveSessionConfig(env, development);
  const problems = session.ok ? [] : [...session.problems];
  const clientId = env.PAYPAL_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.PAYPAL_CLIENT_SECRET?.trim() ?? "";
  const apiBase = resolveSandboxApiBase(env.PAYPAL_API_BASE);
  if (!clientId) problems.push("PAYPAL_CLIENT_ID:unset");
  if (!clientSecret) problems.push("PAYPAL_CLIENT_SECRET:unset");
  if (!apiBase) problems.push("PAYPAL_API_BASE:not_sandbox");
  if (!session.ok || problems.length > 0 || !apiBase) return { ok: false, problems };
  return { ok: true, value: { ...session.value, paypal: { clientId, clientSecret, apiBase } } };
}

export interface LogFields {
  status: number;
  sessionId?: string;
  orderId?: string;
  captureId?: string;
  /** Fixed codes built from constants only. */
  detail?: string;
}

export function logLine(route: string, outcome: string, fields: LogFields): string {
  const parts = [`[collections/${route}] outcome=${outcome}`, `status=${fields.status}`];
  if (fields.sessionId) parts.push(`session=${fields.sessionId.slice(0, 8)}`);
  if (fields.orderId) parts.push(`order=${fields.orderId}`);
  if (fields.captureId) parts.push(`capture=${fields.captureId}`);
  if (fields.detail) parts.push(`detail=${fields.detail}`);
  return parts.join(" ");
}

export interface Admitted {
  ok: true;
  sessionId: string;
  store: LedgerStore;
  client: OrdersClient;
  bodyText: string;
}
export type Admission = Admitted | { ok: false; response: Response };

/** The checks every Collections POST passes, in order (see the file comment). */
export async function admit(request: Request, deps: CollectionsHandlerDeps, route: string): Promise<Admission> {
  const log = deps.log ?? ((line: string) => console.info(line));
  const now = deps.now ?? Date.now;
  const refuse = (status: number, code: CollectionsErrorCode, fields: Omit<LogFields, "status"> = {}): Admission => {
    log(logLine(route, code, { ...fields, status }));
    return { ok: false, response: errorResponse(status, code) };
  };

  const config = resolveCollectionsConfig(deps.env, deps.development);
  if (!config.ok) return refuse(503, "misconfigured", { detail: config.problems.join(",") });
  const origin = checkSameOrigin(request.headers, config.value.origin);
  if (!origin.ok) return refuse(403, "forbidden", { detail: origin.reason });
  if (!deps.store) return refuse(503, "misconfigured", { detail: "LEDGER:unwired" });
  const session = await verifySession(request.headers.get("cookie"), config.value.sessionSecret, now());
  if (!session.ok) return refuse(401, "no_session", { detail: session.reason });
  const sessionId = session.session.id;
  const text = await readBodyText(request, MAX_BODY_BYTES);
  if (!text.ok) return refuse(400, "bad_request", { sessionId, detail: "body" });
  return { ok: true, sessionId, store: deps.store, client: deps.paypalFor(config.value.paypal), bodyText: text.value };
}

/** JSON.parse that answers undefined instead of throwing. */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
