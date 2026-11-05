/**
 * The judge routes' glue: builds `JudgeApiDeps` from the Worker (OpenNext's Cloudflare context for
 * D1, the env for secrets and vars, falling back to `process.env`, which `next dev` fills from
 * .env). Under plain `next dev` with no D1 binding, and only there, the ledger is in memory (per
 * process, reset on restart). The PayPal client and its shared-balance cache are kept per isolate
 * while the credentials are the same.
 */
import { createD1LedgerTable } from "@/ledger/d1-ledger-table";
import { createInMemoryLedgerTable, type InMemoryLedgerTable, type LedgerTable } from "@/ledger/ledger-table";
import { createSharedBalanceReader, type SharedBalance } from "@/payments/paypal/balances";
import { createPaypalClient, resolveSandboxApiBase, type PaypalClient } from "@/payments/paypal/client";
import { workerContext } from "@/platform/worker-context";
import { riskAssessorFor } from "../risk-wiring";
import type { JudgeApiDeps } from "./judge-context";

let devTable: InMemoryLedgerTable | undefined;
let paypalCache: { key: string; client: PaypalClient; balance: () => Promise<SharedBalance | null> } | undefined;

type StringEnvName =
  | "TWOKEY_SESSION_SECRET"
  | "TWOKEY_SITE_ORIGIN"
  | "TWOKEY_DEMO_KEY_PRESIDENT"
  | "TWOKEY_DEMO_KEY_TREASURER"
  | "TWOKEY_DEMO_KEY_SECRETARY"
  | "PAYPAL_CLIENT_ID"
  | "PAYPAL_CLIENT_SECRET"
  | "PAYPAL_API_BASE";

function paypalFor(clientId: string | undefined, clientSecret: string | undefined, rawBase: string | undefined) {
  const apiBase = resolveSandboxApiBase(rawBase);
  if (!clientId?.trim() || !clientSecret?.trim() || !apiBase) return undefined;
  const key = JSON.stringify([apiBase, clientId, clientSecret]);
  if (paypalCache?.key !== key) {
    const client = createPaypalClient({ clientId: clientId.trim(), clientSecret: clientSecret.trim(), apiBase });
    paypalCache = { key, client, balance: createSharedBalanceReader(client) };
  }
  return paypalCache;
}

/** The ledger table: D1 on the Worker; under plain `next dev` (no D1), one in-memory table per process. */
export function ledgerTableFor(env: CloudflareEnv): LedgerTable | undefined {
  if (env.DB) return createD1LedgerTable(env.DB);
  return process.env.NODE_ENV === "development" ? (devTable ??= createInMemoryLedgerTable()) : undefined;
}

export function judgeDepsFromWorker(): JudgeApiDeps {
  const { env } = workerContext();
  const read = (name: StringEnvName): string | undefined => env[name] ?? process.env[name];
  const development = process.env.NODE_ENV === "development";
  const table = ledgerTableFor(env);
  const paypal = paypalFor(read("PAYPAL_CLIENT_ID"), read("PAYPAL_CLIENT_SECRET"), read("PAYPAL_API_BASE"));
  return {
    env: {
      TWOKEY_SESSION_SECRET: read("TWOKEY_SESSION_SECRET"),
      TWOKEY_SITE_ORIGIN: read("TWOKEY_SITE_ORIGIN"),
      TWOKEY_DEMO_KEY_PRESIDENT: read("TWOKEY_DEMO_KEY_PRESIDENT"),
      TWOKEY_DEMO_KEY_TREASURER: read("TWOKEY_DEMO_KEY_TREASURER"),
      TWOKEY_DEMO_KEY_SECRETARY: read("TWOKEY_DEMO_KEY_SECRETARY"),
    },
    development,
    table,
    risk: riskAssessorFor(env),
    paypal: paypal?.client,
    ...(paypal && { sharedBalance: paypal.balance }),
  };
}
