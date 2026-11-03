/**
 * Types for the Worker bindings TwoKey reads through OpenNext's `getCloudflareContext().env`.
 *
 * `@cloudflare/workers-types` is deliberately not a dependency (its globals clash with the `dom`
 * lib), so D1 is described by the small structural subset TwoKey calls. The real binding
 * satisfies it. Secrets are set with `wrangler secret put`, never in wrangler.jsonc.
 */

/** A value TwoKey binds into a D1 statement: text, a number or NULL. */
export type D1Value = string | number | null;

export interface D1RunResult {
  meta: { changes: number };
}

export interface D1PreparedStatementLike {
  bind(...values: D1Value[]): D1PreparedStatementLike;
  run(): Promise<D1RunResult>;
}

export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
}

declare global {
  // Merges with the interface @opennextjs/cloudflare declares for `getCloudflareContext().env`.
  interface CloudflareEnv {
    /** D1 database `twokey` (wrangler.jsonc); schema in config/d1/migrations. */
    DB?: D1DatabaseLike;
    /** Worker secrets for the PayPal REST app (sandbox). */
    PAYPAL_CLIENT_ID?: string;
    PAYPAL_CLIENT_SECRET?: string;
    /** The id PayPal returned when the webhook was registered; needed to verify deliveries. */
    PAYPAL_WEBHOOK_ID?: string;
    /** Optional; the sandbox endpoint when unset. Any other value is refused. */
    PAYPAL_API_BASE?: string;
  }
}
