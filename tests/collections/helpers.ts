/** Shared setup for the Collections handler tests. Every credential and id here is fictional. */
import { vi } from "vitest";
import { issueSession, type RandomBytes } from "@/agents/llm/judge-session";
import type { CollectionsHandlerDeps } from "@/collections/http";
import type { OrdersClient } from "@/payments/paypal/orders";
import type { PaypalJsonResponse } from "@/payments/paypal/client";
import { fakeLedger, type FakeLedger } from "./fake-ledger";

export const SITE = "https://twokey.afterscroll.workers.dev";
export const SECRET = "test-session-secret-not-real-0123456789abcdef";
export const FAKE_CLIENT_ID = "test-client-id-not-real";
export const FAKE_CLIENT_SECRET = "test-client-secret-not-real";
export const NOW = Date.UTC(2026, 10, 5, 15, 0, 0);
export const ORDER_ID = "5O190127TN364715T";
export const CAPTURE_ID = "3C679366HH908993F";

const bytes = (fill: number): RandomBytes => (length) => new Uint8Array(length).fill(fill);

/** A valid judge-session cookie header, and the session id it carries. */
export async function sessionCookie(fill = 7): Promise<{ cookie: string; sessionId: string }> {
  const issued = await issueSession(SECRET, NOW, bytes(fill));
  return { cookie: issued.setCookie.split(";")[0]!, sessionId: issued.session.id };
}

export const env = (overrides: Partial<CollectionsHandlerDeps["env"]> = {}): CollectionsHandlerDeps["env"] => ({
  TWOKEY_SESSION_SECRET: SECRET,
  TWOKEY_SITE_ORIGIN: SITE,
  PAYPAL_CLIENT_ID: FAKE_CLIENT_ID,
  PAYPAL_CLIENT_SECRET: FAKE_CLIENT_SECRET,
  ...overrides,
});

export function post(path: string, body: unknown, init: { cookie?: string; origin?: string; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", "sec-fetch-site": "same-origin", ...init.headers };
  if (init.origin !== "") headers.origin = init.origin ?? SITE;
  if (init.cookie) headers.cookie = init.cookie;
  return new Request(`${SITE}${path}`, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

export interface Harness {
  deps: CollectionsHandlerDeps;
  ledger: FakeLedger;
  paypal: { postJson: ReturnType<typeof vi.fn<OrdersClient["postJson"]>> };
  logs: string[];
}

export function harness(overrides: Partial<CollectionsHandlerDeps> = {}): Harness {
  const ledger = fakeLedger();
  const paypal = { postJson: vi.fn<OrdersClient["postJson"]>() };
  const logs: string[] = [];
  let ids = 0;
  const deps: CollectionsHandlerDeps = {
    env: env(),
    development: false,
    store: ledger,
    paypalFor: () => paypal,
    now: () => NOW,
    newId: () => `test-id-${++ids}`,
    log: (line) => logs.push(line),
    ...overrides,
  };
  return { deps, ledger, paypal, logs };
}

export const paypalReply = (status: number, body: unknown): PaypalJsonResponse => ({ status, body });

export async function json(response: Response): Promise<{ status: number; body: Record<string, unknown> }> {
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}
