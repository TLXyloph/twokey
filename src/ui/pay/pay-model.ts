/** Small, pure helpers for the pay page: money, quantities and judge mode. */

/** 1500 -> "$15", 1550 -> "$15.50". Whole cents only. */
export function formatDollars(cents: number): string {
  const dollars = Math.floor(cents / 100);
  const rest = cents % 100;
  return rest === 0 ? `$${dollars}` : `$${dollars}.${String(rest).padStart(2, "0")}`;
}

export function ticketsLabel(quantity: number): string {
  return quantity === 1 ? "1 ticket" : `${quantity} tickets`;
}

export function clampQuantity(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * Judge mode shows "Back to the board" and "See it on the parent ledger". The judge panel links
 * here with `?judge=1`; a parent who
 * opens a shared link without it never sees a link into the officers' board. Not a security
 * boundary (the board is the public demo), just the parent's view kept clean.
 */
export function isJudgeMode(searchParams: Record<string, string | string[] | undefined>): boolean {
  const value = searchParams.judge;
  return value === "1" || (Array.isArray(value) && value.includes("1"));
}

export const METHOD_LABEL = { paypal: "PayPal", venmo: "Venmo" } as const;
