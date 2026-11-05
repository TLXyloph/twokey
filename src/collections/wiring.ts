/**
 * Glue between the Collections routes and the Worker: the ledger store, the PayPal client and the
 * env values. Route files stay thin; the handlers get everything injected.
 *
 * Strings (secrets and vars) are read from the Worker env when there is a Cloudflare context, and
 * otherwise from `process.env` (which OpenNext fills from the Worker env, and `next dev` from .env),
 * the same sources the AI and webhook routes use.
 */
import type { LedgerStore } from "@/ledger/contracts";
import { createPaypalClient } from "@/payments/paypal/client";
import type { OrdersClient } from "@/payments/paypal/orders";
import { workerContext } from "@/platform/worker-context";
import type { CollectionsEnv, CollectionsHandlerDeps, PaypalAppConfig } from "./http";

/**
 * The session ledger for these routes. Undefined until the D1 ledger store (src/ledger/) is wired
 * at integration; the routes answer 503 misconfigured meanwhile.
 */
export function ledgerStoreFor(env: CloudflareEnv): LedgerStore | undefined {
  void env;
  return undefined;
}

const STRING_KEYS = ["TWOKEY_SESSION_SECRET", "TWOKEY_SITE_ORIGIN", "PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "PAYPAL_API_BASE"] as const;

type StringKey = (typeof STRING_KEYS)[number] | "TWOKEY_TEST_BUYER_EMAIL" | "TWOKEY_TEST_BUYER_PASSWORD";

function readString(env: CloudflareEnv, key: StringKey): string | undefined {
  const fromWorker = env[key];
  return typeof fromWorker === "string" ? fromWorker : process.env[key];
}

// Per isolate: the PayPal client, and so its cached OAuth token, is reused while the app is the same.
let cachedClient: { key: string; client: OrdersClient } | undefined;

function paypalFor(config: PaypalAppConfig): OrdersClient {
  const key = JSON.stringify([config.apiBase, config.clientId, config.clientSecret]);
  if (cachedClient?.key !== key) cachedClient = { key, client: createPaypalClient(config) };
  return cachedClient.client;
}

/** Everything a Collections handler needs, from the current request's Worker context. */
export function collectionsDeps(): CollectionsHandlerDeps {
  const { env } = workerContext();
  const strings = Object.fromEntries(STRING_KEYS.map((key) => [key, readString(env, key)])) as CollectionsEnv;
  return {
    env: strings,
    development: process.env.NODE_ENV === "development",
    store: ledgerStoreFor(env),
    paypalFor,
  };
}

/** What the parent page may show: the PayPal app's public client id and the sandbox test buyer. */
export interface PayPagePublicConfig {
  /** PayPal's client id is public by design (the JS SDK sends it from the browser). */
  paypalClientId: string | null;
  testBuyer: { email: string; password: string } | null;
}

export function payPagePublicConfig(): PayPagePublicConfig {
  const { env } = workerContext();
  const clientId = readString(env, "PAYPAL_CLIENT_ID")?.trim() || null;
  const email = readString(env, "TWOKEY_TEST_BUYER_EMAIL")?.trim();
  const password = readString(env, "TWOKEY_TEST_BUYER_PASSWORD")?.trim();
  return { paypalClientId: clientId, testBuyer: email && password ? { email, password } : null };
}
