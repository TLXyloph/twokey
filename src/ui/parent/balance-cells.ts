/**
 * The parent balance widget's cells, as plain data: the board's balances strip
 * (src/ui/studio/balances-strip.ts) in a parent's words. It reads the same figures, from the same
 * queries, and leaves out what only a judge needs (the shared sandbox balance under the first cell).
 *
 *   In the club account   $4,998.75   As of Nov 3, 10:30 AM CST
 *   Waiting for a second key   $78.50   2 payouts, not paid yet
 *   Money in, November   $630.00   Received since November 1
 */
import { formatAsOf, formatUsd, monthNameOf } from "@/demo/board-figures";
import type { StripFigures, StripSlot } from "@/ui/studio/balances-strip";

export interface ParentBalanceCell {
  id: "balance" | "waiting" | "moneyIn";
  label: string;
  value: string;
  caption: string;
  /** A zero figure: set in the quieter gold. */
  zero: boolean;
}

export type FormatMoney = (amount: number, slot: StripSlot) => string;

const payouts = (count: number) => `${count} ${count === 1 ? "payout" : "payouts"}`;

export function parentBalanceCells(figures: Omit<StripFigures, "shared">, formatMoney: FormatMoney = formatUsd): ParentBalanceCell[] {
  const asOf = figures.asOf == null ? "" : formatAsOf(figures.asOf);
  const month = figures.asOf == null ? "" : monthNameOf(figures.asOf);
  const cells: ParentBalanceCell[] = [
    {
      id: "balance",
      label: "In the club account",
      value: formatMoney(figures.balance, "value"),
      caption: asOf ? `As of ${asOf}` : "The latest balance",
      zero: figures.balance === 0,
    },
  ];

  if (figures.waiting) {
    const total = figures.waiting.total ?? 0;
    const count = figures.waiting.count;
    const caption = total === 0 ? "Nothing waiting" : count == null ? "Not paid yet" : `${payouts(count)}, not paid yet`;
    cells.push({ id: "waiting", label: "Waiting for a second key", value: formatMoney(total, "waitingTotal"), caption, zero: total === 0 });
  }

  if (figures.moneyIn !== undefined) {
    const total = figures.moneyIn ?? 0;
    const since = month ? `since ${month} 1` : "this month";
    cells.push({
      id: "moneyIn",
      label: month ? `Money in, ${month}` : "Money in this month",
      value: formatMoney(total, "moneyIn"),
      caption: total === 0 ? `Nothing received ${since}` : `Received ${since}`,
      zero: total === 0,
    });
  }
  return cells;
}
