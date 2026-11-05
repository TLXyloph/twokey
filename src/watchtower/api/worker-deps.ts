/**
 * The Watchtower routes' glue: builds their deps from the Worker (OpenNext's Cloudflare context
 * for D1, the env for secrets and vars, falling back to `process.env`, which `next dev` fills from
 * .env). The PayPal client, and so its cached token, is kept per isolate while the credentials
 * are the same. Signatures are checked against the committed public keys.
 */
import { createSignatureVerifier, type SignatureVerifier } from "@/disbursements/signing";
import { createPaypalClient, resolveSandboxApiBase, type PaypalClient } from "@/payments/paypal/client";
import { searchTransactions } from "@/payments/paypal/transactions";
import { workerContext } from "@/platform/worker-context";
import { WATCH_FROM } from "../contracts";
import { createD1WatchtowerStore } from "../d1-store";
import { createD1TraceSources } from "../d1-trace-sources";
import { tracePayout } from "../trace";
import type { ReplayApiDeps, RunApiDeps } from "./handlers";

type StringEnvName = "TWOKEY_CRON_SECRET" | "TWOKEY_SESSION_SECRET" | "TWOKEY_SITE_ORIGIN" | "PAYPAL_CLIENT_ID" | "PAYPAL_CLIENT_SECRET" | "PAYPAL_API_BASE";

let paypalCache: { key: string; client: PaypalClient } | undefined;
let verifier: SignatureVerifier | undefined;

function paypalFor(clientId: string | undefined, clientSecret: string | undefined, rawBase: string | undefined): PaypalClient | undefined {
  const apiBase = resolveSandboxApiBase(rawBase);
  if (!clientId?.trim() || !clientSecret?.trim() || !apiBase) return undefined;
  const key = JSON.stringify([apiBase, clientId, clientSecret]);
  if (paypalCache?.key !== key) paypalCache = { key, client: createPaypalClient({ clientId: clientId.trim(), clientSecret: clientSecret.trim(), apiBase }) };
  return paypalCache.client;
}

function reader() {
  const { env } = workerContext();
  return { env, read: (name: StringEnvName): string | undefined => env[name] ?? process.env[name] };
}

export function watchtowerRunDepsFromWorker(): RunApiDeps {
  const { env, read } = reader();
  const db = env.DB;
  const paypal = paypalFor(read("PAYPAL_CLIENT_ID"), read("PAYPAL_CLIENT_SECRET"), read("PAYPAL_API_BASE"));
  verifier ??= createSignatureVerifier();
  const keys = verifier;
  return {
    secret: read("TWOKEY_CRON_SECRET"),
    run: db
      ? {
          search: paypal ? (now) => searchTransactions(paypal, { from: WATCH_FROM, now }) : undefined,
          store: createD1WatchtowerStore(db),
          trace: (debit) => tracePayout(debit, createD1TraceSources(db), keys),
          now: () => new Date(),
          newId: () => crypto.randomUUID(),
          log: (line) => console.info(line),
        }
      : undefined,
  };
}

export function watchtowerReplayDepsFromWorker(): ReplayApiDeps {
  const { read } = reader();
  return {
    env: { TWOKEY_SESSION_SECRET: read("TWOKEY_SESSION_SECRET"), TWOKEY_SITE_ORIGIN: read("TWOKEY_SITE_ORIGIN") },
    development: process.env.NODE_ENV === "development",
  };
}
