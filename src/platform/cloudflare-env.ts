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

export interface D1AllResult<Row> {
  results: Row[];
}

export interface D1PreparedStatementLike {
  bind(...values: D1Value[]): D1PreparedStatementLike;
  run(): Promise<D1RunResult>;
  /**
   * The rows of a query. On the real binding `run()` may not return rows, so reads use `all()`.
   * Optional here only so that fakes for write-only stores need not implement it; a reader must
   * fail (throw) when it is missing, never treat that as "no rows".
   */
  all?<Row = Record<string, D1Value>>(): Promise<D1AllResult<Row>>;
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
    /** Worker secret; absent means the live AI is off and /api/ai/turn serves replays only. */
    ANTHROPIC_API_KEY?: string;
    /** Worker secret (>= 32 chars) that signs the judge-session cookie. */
    TWOKEY_SESSION_SECRET?: string;
    /** wrangler.jsonc vars for the AI routes; see src/agents/llm/turn-config.ts. */
    TWOKEY_SITE_ORIGIN?: string;
    TWOKEY_AI_BUDGET_USD?: string;
    TWOKEY_AI_SESSION_BUDGET_USD?: string;
    TWOKEY_AI_SESSION_TURNS_PER_MINUTE?: string;
    TWOKEY_AI_SESSIONS_PER_IP_PER_HOUR?: string;
    TWOKEY_AI_MODEL?: string;
    /**
     * Worker secrets: the officers' demo signing keys (Ed25519, PKCS8 DER, base64), written by
     * scripts/gen-demo-keys.sh and never printed. Their public keys are committed in
     * src/disbursements/demo-public-keys.json; a missing or mismatched key fails closed (503).
     */
    TWOKEY_DEMO_KEY_PRESIDENT?: string;
    TWOKEY_DEMO_KEY_TREASURER?: string;
    TWOKEY_DEMO_KEY_SECRETARY?: string;
  }
}
