/**
 * PayPal's real balance for the shared sandbox account (spec §6: "Shared sandbox balance $X · as
 * of <time>"): `GET /v1/reporting/balances?currency_code=USD`, cached in memory for 10 minutes.
 * Any error reads as null, so the board shows nothing rather than a wrong number; a failure is
 * remembered for a minute so a polling board doesn't hammer PayPal.
 */
import type { PaypalClient } from "./client";

export const BALANCES_PATH = "/v1/reporting/balances?currency_code=USD";
export const BALANCE_CACHE_MS = 10 * 60_000;
export const FAILURE_CACHE_MS = 60_000;

export interface SharedBalance {
  availableCents: number;
  currency: "USD";
  /** PayPal's `as_of_time`. */
  asOf: string;
}

/** "4998.75" -> 499875. Plain decimals with at most two places; anything else is null. */
export function decimalToCents(value: string): number | null {
  const match = /^(-)?(\d{1,12})(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) return null;
  const cents = Number(match[2]) * 100 + Number((match[3] ?? "").padEnd(2, "0"));
  return match[1] ? -cents : cents;
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

export function parseBalances(body: unknown): SharedBalance | null {
  if (!isObject(body) || !Array.isArray(body.balances) || typeof body.as_of_time !== "string") return null;
  const usd = body.balances.filter(isObject).find((entry) => entry.currency === "USD");
  const available = usd && isObject(usd.available_balance) ? usd.available_balance.value : undefined;
  const availableCents = typeof available === "string" ? decimalToCents(available) : null;
  return availableCents === null ? null : { availableCents, currency: "USD", asOf: body.as_of_time };
}

/** A reader with its own cache: keep one per PayPal client (the route keeps one per isolate). */
export function createSharedBalanceReader(client: PaypalClient, now: () => number = Date.now): () => Promise<SharedBalance | null> {
  let cached: { value: SharedBalance | null; until: number } | undefined;
  let inFlight: Promise<SharedBalance | null> | undefined;

  async function fetchBalance(): Promise<SharedBalance | null> {
    let value: SharedBalance | null = null;
    try {
      const response = await client.getJson(BALANCES_PATH, "balances");
      value = response.status === 200 ? parseBalances(response.body) : null;
    } catch {
      value = null;
    }
    cached = { value, until: now() + (value ? BALANCE_CACHE_MS : FAILURE_CACHE_MS) };
    return value;
  }

  return () => {
    if (cached && now() < cached.until) return Promise.resolve(cached.value);
    inFlight ??= fetchBalance().finally(() => {
      inFlight = undefined;
    });
    return inFlight;
  };
}
