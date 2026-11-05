/**
 * A minimal PayPal REST client for the Worker: an OAuth client-credentials token, cached until
 * 60 s before it expires, and JSON POSTs with that token.
 *
 * Sandbox only: any base URL other than https://api-m.sandbox.paypal.com is refused.
 * Workers-safe: `fetch` and `btoa`, no `Buffer`. Errors carry an operation name and an HTTP
 * status, never a credential, a token or a response body.
 */
import { z } from "zod";

export const PAYPAL_SANDBOX_API_BASE = "https://api-m.sandbox.paypal.com";
export const TOKEN_REFRESH_MARGIN_MS = 60_000;
export const DEFAULT_TIMEOUT_MS = 10_000;

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

// Wrapped, never stored bare: calling a stored `fetch` as a method of another object fails in
// Workers with "Illegal invocation". Resolved at call time, so tests can stub the global.
const globalFetch: FetchLike = (input, init) => fetch(input, init);

/** A PayPal call that failed. `status` is the HTTP status, or 0 when no response arrived. */
export class PaypalApiError extends Error {
  readonly operation: string;
  readonly status: number;

  constructor(operation: string, status: number, reason: string) {
    super(`PayPal ${operation} failed: ${reason}`);
    this.name = "PaypalApiError";
    this.operation = operation;
    this.status = status;
  }
}

/** The sandbox base for an unset or blank value; undefined (refused) for anything else. */
export function resolveSandboxApiBase(raw: string | undefined): string | undefined {
  const base = (raw ?? "").trim().replace(/\/+$/, "");
  if (base === "") return PAYPAL_SANDBOX_API_BASE;
  return base === PAYPAL_SANDBOX_API_BASE ? base : undefined;
}

export interface PaypalClientOptions {
  clientId: string;
  clientSecret: string;
  /** Optional; must resolve to the sandbox (see `resolveSandboxApiBase`). */
  apiBase?: string;
  fetch?: FetchLike;
  now?: () => number;
  timeoutMs?: number;
}

export interface PaypalJsonResponse {
  status: number;
  /** The parsed JSON body, or undefined when the body is empty or not JSON. */
  body: unknown;
}

export interface PaypalClient {
  readonly apiBase: string;
  getAccessToken(): Promise<string>;
  /**
   * POSTs `jsonBody` exactly as given, with the bearer token. `headers` adds request headers (e.g.
   * `PayPal-Request-Id`); it can't replace the token or the content type. Throws only when no
   * response arrives.
   */
  postJson(path: string, jsonBody: string, operation: string, headers?: Record<string, string>): Promise<PaypalJsonResponse>;
  /** GETs `path` with the bearer token. Throws only when no response arrives. */
  getJson(path: string, operation: string): Promise<PaypalJsonResponse>;
}

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
});

interface CachedToken {
  token: string;
  refreshAt: number;
}

export function createPaypalClient(options: PaypalClientOptions): PaypalClient {
  const apiBase = resolveSandboxApiBase(options.apiBase);
  if (!apiBase) throw new Error("PayPal client: only the sandbox API base is allowed.");
  const fetchFn = options.fetch ?? globalFetch;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let cached: CachedToken | undefined;
  let inFlight: Promise<string> | undefined;

  async function send(operation: string, path: string, init: RequestInit): Promise<Response> {
    try {
      return await fetchFn(`${apiBase}${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      throw new PaypalApiError(operation, 0, "no response (network error or timeout)");
    }
  }

  async function fetchToken(): Promise<string> {
    let basic: string;
    try {
      basic = btoa(`${options.clientId}:${options.clientSecret}`);
    } catch {
      throw new PaypalApiError("token", 0, "credentials are not Latin-1 text");
    }
    const requestedAt = now();
    const response = await send("token", "/v1/oauth2/token", {
      method: "POST",
      headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: "grant_type=client_credentials",
    });
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => undefined);
      throw new PaypalApiError("token", response.status, `HTTP ${response.status}`);
    }
    const parsed = tokenResponseSchema.safeParse(await response.json().catch(() => undefined));
    if (!parsed.success) throw new PaypalApiError("token", response.status, "unexpected token response");
    cached = {
      token: parsed.data.access_token,
      refreshAt: requestedAt + parsed.data.expires_in * 1000 - TOKEN_REFRESH_MARGIN_MS,
    };
    return cached.token;
  }

  function getAccessToken(): Promise<string> {
    if (cached && now() < cached.refreshAt) return Promise.resolve(cached.token);
    inFlight ??= fetchToken().finally(() => {
      inFlight = undefined;
    });
    return inFlight;
  }

  async function callJson(
    method: "GET" | "POST",
    path: string,
    operation: string,
    jsonBody?: string,
    extraHeaders: Record<string, string> = {},
  ): Promise<PaypalJsonResponse> {
    const token = await getAccessToken();
    const headers = new Headers(extraHeaders);
    headers.set("authorization", `Bearer ${token}`);
    headers.set("accept", "application/json");
    if (jsonBody !== undefined) headers.set("content-type", "application/json");
    const response = await send(operation, path, { method, headers, ...(jsonBody !== undefined && { body: jsonBody }) });
    // A revoked or expired token: forget it, so the next request (PayPal retries) gets a new one.
    if (response.status === 401 && cached?.token === token) cached = undefined;
    const text = await response.text().catch(() => "");
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = undefined;
    }
    return { status: response.status, body };
  }

  return {
    apiBase,
    getAccessToken,
    postJson: (path, jsonBody, operation, headers) => callJson("POST", path, operation, jsonBody, headers),
    getJson: (path, operation) => callJson("GET", path, operation),
  };
}
