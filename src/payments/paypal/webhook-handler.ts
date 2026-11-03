/**
 * The PayPal webhook receiver's core: request in, response out, every dependency injected.
 * `src/app/api/paypal/webhook/route.ts` is the glue that supplies the Worker's env and D1.
 *
 * Checks run cheapest first, and nothing reaches PayPal until the request is well formed:
 *   body over 64 KB                               -> 413
 *   config or DB binding missing                  -> 503
 *   transmission header missing or too long       -> 400
 *   body not UTF-8, not JSON, or no id/event_type -> 400
 *   PayPal says FAILURE                           -> 400, nothing stored
 *   PayPal (token or verify) or D1 error          -> 500
 *   stored, or already stored (duplicate)         -> 200
 * PayPal retries any non-2xx (up to 25 times over 3 days), so a duplicate must answer 200.
 *
 * One log line per request: outcome, status, the event's id, type, resource type and resource
 * id, and a fixed detail code. Never the body, the headers, emails, tokens or secrets.
 */
import type { PaypalEventStore } from "@/ledger/event-store";
import { PaypalApiError, resolveSandboxApiBase } from "./client";
import { summarizePaypalEvent, type PaypalEventSummary } from "./event-summary";
import { readTransmission, WEBHOOK_ID_MAX_LENGTH, type WebhookVerifier } from "./verify-webhook";

export const MAX_BODY_BYTES = 64 * 1024;

/** The Worker env values the receiver reads (secrets, plus the optional API base). */
export interface PaypalWebhookEnv {
  PAYPAL_CLIENT_ID?: string;
  PAYPAL_CLIENT_SECRET?: string;
  PAYPAL_WEBHOOK_ID?: string;
  PAYPAL_API_BASE?: string;
}

export interface PaypalWebhookConfig {
  clientId: string;
  clientSecret: string;
  webhookId: string;
  apiBase: string;
}

/** `problems` are `<NAME>:<reason>` codes, never values. */
export type ConfigCheck = { ok: true; value: PaypalWebhookConfig } | { ok: false; problems: string[] };

export function resolveWebhookConfig(env: PaypalWebhookEnv): ConfigCheck {
  const problems: string[] = [];
  const required = (name: keyof PaypalWebhookEnv): string => {
    const value = env[name]?.trim() ?? "";
    if (!value) problems.push(`${name}:unset`);
    return value;
  };
  const clientId = required("PAYPAL_CLIENT_ID");
  const clientSecret = required("PAYPAL_CLIENT_SECRET");
  const webhookId = required("PAYPAL_WEBHOOK_ID");
  if (webhookId.length > WEBHOOK_ID_MAX_LENGTH) problems.push("PAYPAL_WEBHOOK_ID:too_long");
  const apiBase = resolveSandboxApiBase(env.PAYPAL_API_BASE);
  if (!apiBase) problems.push("PAYPAL_API_BASE:not_sandbox");
  if (problems.length > 0 || !apiBase) return { ok: false, problems };
  return { ok: true, value: { clientId, clientSecret, webhookId, apiBase } };
}

export interface WebhookHandlerDeps {
  env: PaypalWebhookEnv;
  /** Undefined when the D1 binding is missing. */
  store: PaypalEventStore | undefined;
  /** Builds (or reuses) the verifier for this config; the route caches the PayPal client. */
  verifierFor(config: PaypalWebhookConfig): WebhookVerifier;
  now?: () => Date;
  log?: (line: string) => void;
}

export type WebhookOutcome =
  | "stored"
  | "duplicate"
  | "too_large"
  | "misconfigured"
  | "bad_request"
  | "verification_failed"
  | "paypal_error"
  | "store_error"
  | "internal_error";

const STATUS: Record<WebhookOutcome, number> = {
  stored: 200,
  duplicate: 200,
  too_large: 413,
  misconfigured: 503,
  bad_request: 400,
  verification_failed: 400,
  paypal_error: 500,
  store_error: 500,
  internal_error: 500,
};

const MESSAGE: Record<WebhookOutcome, string> = {
  stored: "",
  duplicate: "",
  too_large: `The request body exceeds ${MAX_BODY_BYTES} bytes.`,
  misconfigured: "The webhook receiver is not configured on this server.",
  bad_request: "Not a well-formed PayPal webhook delivery.",
  verification_failed: "PayPal did not verify this webhook delivery.",
  paypal_error: "PayPal could not be reached to verify this delivery.",
  store_error: "The event could not be stored.",
  internal_error: "The webhook receiver failed.",
};

// ---------------------------------------------------------------------------------------------
// Log line
// ---------------------------------------------------------------------------------------------

/** A logged event field must look like a PayPal identifier: no spaces, `@`, quotes or newlines. */
const LOGGABLE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const loggable = (value: string): string => (LOGGABLE.test(value) ? value : "(redacted)");

interface LogFields {
  summary?: PaypalEventSummary;
  /** A fixed code built from constants only. */
  detail?: string;
}

function logLine(outcome: WebhookOutcome, fields: LogFields): string {
  const parts = [`[paypal/webhook] outcome=${outcome}`, `status=${STATUS[outcome]}`];
  const { summary, detail } = fields;
  if (summary) {
    parts.push(`event_id=${loggable(summary.eventId)}`, `event_type=${loggable(summary.eventType)}`);
    if (summary.resourceType !== null) parts.push(`resource_type=${loggable(summary.resourceType)}`);
    if (summary.resourceId !== null) parts.push(`resource_id=${loggable(summary.resourceId)}`);
  }
  if (detail) parts.push(`detail=${detail}`);
  return parts.join(" ");
}

function respond(outcome: WebhookOutcome): Response {
  const status = STATUS[outcome];
  const body = status === 200 ? { ok: true, outcome } : { error: { code: outcome, message: MESSAGE[outcome] } };
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

// ---------------------------------------------------------------------------------------------
// Body
// ---------------------------------------------------------------------------------------------

type BodyRead = { ok: true; bytes: Uint8Array } | { ok: false; outcome: "too_large" | "bad_request"; detail: string };

/** Reads at most `maxBytes`, refusing a larger declared or streamed body without buffering it. */
async function readBody(request: Request, maxBytes: number): Promise<BodyRead> {
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, outcome: "too_large", detail: "declared_length" };
  if (!request.body) return { ok: true, bytes: new Uint8Array(0) };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, outcome: "too_large", detail: "streamed_length" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, outcome: "bad_request", detail: "unreadable_body" };
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}

/**
 * Fatal UTF-8 decoding: invalid bytes are refused, never replaced with U+FFFD. `ignoreBOM` keeps
 * a byte-order mark in the text instead of dropping it, so the text always re-encodes to exactly
 * the bytes received (and JSON.parse then refuses the BOM).
 */
function decodeUtf8(bytes: Uint8Array): string | undefined {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

function paypalErrorDetail(error: unknown): string {
  if (!(error instanceof PaypalApiError)) return "verify_unexpected";
  const operation = error.operation === "token" ? "token" : "verify";
  return error.status === 0 ? `${operation}_no_response` : `${operation}_http_${error.status}`;
}

function storeErrorDetail(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/no such table/i.test(message)) return "no_such_table";
  if (/append-only/.test(message)) return "append_only";
  return "d1_error";
}

// ---------------------------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------------------------

export async function handlePaypalWebhook(request: Request, deps: WebhookHandlerDeps): Promise<Response> {
  const log = deps.log ?? ((line: string) => console.info(line));
  const now = deps.now ?? (() => new Date());
  const finish = (outcome: WebhookOutcome, fields: LogFields = {}): Response => {
    log(logLine(outcome, fields));
    return respond(outcome);
  };

  let summary: PaypalEventSummary | undefined;
  try {
    const body = await readBody(request, MAX_BODY_BYTES);
    if (!body.ok) return finish(body.outcome, { detail: body.detail });

    const config = resolveWebhookConfig(deps.env);
    const problems = config.ok ? [] : [...config.problems];
    if (!deps.store) problems.push("DB:unbound");
    if (!config.ok || !deps.store) return finish("misconfigured", { detail: problems.join(",") });
    const store = deps.store;

    const transmission = readTransmission(request.headers);
    if (!transmission.ok) return finish("bad_request", { detail: transmission.reason });

    const raw = decodeUtf8(body.bytes);
    if (raw === undefined) return finish("bad_request", { detail: "invalid_utf8" });
    const summarized = summarizePaypalEvent(raw);
    if (!summarized.ok) return finish("bad_request", { detail: summarized.reason });
    summary = summarized.value;

    const verifier = deps.verifierFor(config.value);
    let verified: boolean;
    try {
      verified = await verifier.verify(transmission.value, raw);
    } catch (error) {
      return finish("paypal_error", { summary, detail: paypalErrorDetail(error) });
    }
    if (!verified) return finish("verification_failed", { summary });

    let outcome: "stored" | "duplicate";
    try {
      outcome = await store.append({ ...summary, receivedAt: now().toISOString(), payload: raw });
    } catch (error) {
      return finish("store_error", { summary, detail: storeErrorDetail(error) });
    }
    return finish(outcome, { summary });
  } catch {
    return finish("internal_error", { summary });
  }
}
