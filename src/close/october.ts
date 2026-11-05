/**
 * The monthly close, computed in code (spec §5.6): October 2026 from the seed (demo data). Every
 * figure comes from the ledger rows in src/demo/riverbend.ts and the season budget in
 * src/demo/riverbend-policy.ts; nothing is typed in. Deterministic and free of clocks, so the close
 * hash (SHA-256 of the figures' canonical JSON) is the same on the server, in the browser and in the
 * recording script.
 *
 * - Opening balance: completed rows before the month, plus the month's "opening balance" row (the
 *   seed carries September forward as a row dated Oct 1; it is not money in).
 * - Money in / money out: the month's completed rows. Pending payouts never left the account.
 * - Closing = opening + in - out, and it carries forward: closing + every completed row after the
 *   month = the account balance the seed records (a test holds it).
 * - Budget lines: approved for the season, against what was paid from each line this month; "left"
 *   is approved minus everything paid from the line up to the month's end.
 * - Open items: payouts requested on or before the month's last day that still wait for a key.
 * - Exceptions: a fundraiser whose takings fall short of what was logged; payments out with no
 *   two-key record; a line overspent; a payment that is on no budget line.
 *
 * A payment's two-key record: `ClubDemoData` holds no second signature, so a caller that knows
 * which rows two officers signed (from the ledger's approval events) passes their ids. The seed's
 * October payments have none: TwoKey's first signed request is dated Nov 2.
 */
import { canonicalJson, sha256Hex } from "@/ledger/canonical";
import { BUDGET_LINES, type BudgetLine } from "@/demo/riverbend-policy";
import { riverbend, type ClubDemoData, type LedgerEntry, type OfficerRole } from "@/demo/riverbend";
import {
  CLOSE_FIGURES_VERSION,
  CLOSE_MONTH,
  type CloseBudgetLine,
  type CloseException,
  type CloseFigures,
  type CloseMoneyIn,
  type CloseMonth,
  type CloseOpenItem,
  type ClosePayment,
} from "./contracts";

export const OPENING_BALANCE_CATEGORY = "opening balance";

const toCents = (amount: number): number => Math.round(amount * 100);
const total = (rows: readonly { amountCents: number }[]): number => rows.reduce((sum, row) => sum + row.amountCents, 0);
const byDate = (a: { date: string; id: string }, b: { date: string; id: string }) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id);

/** "2026-10" -> its first and last day. */
export function monthPeriod(month: string): { from: string; to: string } {
  const [year, mon] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

const payment = (row: LedgerEntry): ClosePayment => ({
  rowId: row.id,
  date: row.date,
  description: row.description,
  counterparty: row.counterparty,
  amountCents: -toCents(row.amount),
});

export interface CloseOptions {
  /** Ledger row ids of payments two officers signed for (none in the seed's October). */
  signedPayoutRowIds?: ReadonlySet<string>;
  budget?: readonly BudgetLine[];
}

export function computeMonthClose(data: ClubDemoData, month: CloseMonth, options: CloseOptions = {}): CloseFigures {
  const budget = options.budget ?? BUDGET_LINES;
  const signed = options.signedPayoutRowIds ?? new Set<string>();
  const period = monthPeriod(month);
  const rows = [...data.ledger].sort(byDate);
  const completed = rows.filter((row) => row.status === "completed");
  const inMonth = (row: LedgerEntry) => row.date >= period.from && row.date <= period.to;

  const openingRows = completed.filter((row) => row.date < period.from || (inMonth(row) && row.category === OPENING_BALANCE_CATEGORY));
  const monthRows = completed.filter((row) => inMonth(row) && row.category !== OPENING_BALANCE_CATEGORY);
  const laterRows = completed.filter((row) => row.date > period.to);

  const moneyIn: CloseMoneyIn[] = monthRows
    .filter((row) => row.direction === "in")
    .map((row) => {
      const event = row.eventId ? data.events.find((e) => e.id === row.eventId) : undefined;
      return {
        rowId: row.id,
        date: row.date,
        description: row.description,
        counterparty: row.counterparty,
        amountCents: toCents(row.amount),
        takings: event
          ? {
              eventId: event.id,
              name: event.name,
              unitLabel: event.unitLabel,
              unitsLogged: event.unitsLogged,
              unitPriceCents: toCents(event.unitPrice),
              expectedCents: toCents(event.expected),
              receivedCents: toCents(event.received),
            }
          : null,
      };
    });
  const paymentsOut = monthRows.filter((row) => row.direction === "out").map(payment);
  const outRows = monthRows.filter((row) => row.direction === "out");

  const openingCents = openingRows.reduce((sum, row) => sum + toCents(row.amount), 0);
  const moneyInCents = total(moneyIn);
  const moneyOutCents = total(paymentsOut);
  const closingCents = openingCents + moneyInCents - moneyOutCents;

  const paidToMonthEnd = (category: string) =>
    completed.filter((row) => row.direction === "out" && row.category === category && row.date <= period.to).reduce((sum, row) => sum - toCents(row.amount), 0);
  const budgetLines: CloseBudgetLine[] = budget.map((line) => {
    const payments = outRows.filter((row) => row.category === line.category).map(payment);
    return {
      id: line.id,
      label: line.label,
      approvedCents: line.approvedCents,
      spentCents: total(payments),
      leftCents: line.approvedCents - paidToMonthEnd(line.category),
      payments,
    };
  });

  const openItems: CloseOpenItem[] = rows
    .filter((row) => row.status === "pending" && row.direction === "out" && row.requestedBy !== null && row.date <= period.to)
    .map((row) => ({ ...payment(row), requestedBy: row.requestedBy as OfficerRole }));

  const exceptions: CloseException[] = [];
  const gaps = data.events
    .filter((event) => event.date >= period.from && event.date <= period.to)
    .map((event) => ({ event, missingCents: toCents(event.expected) - toCents(event.received) }))
    .filter((gap) => gap.missingCents > 0)
    .sort((a, b) => b.missingCents - a.missingCents || a.event.date.localeCompare(b.event.date));
  for (const { event, missingCents } of gaps) {
    exceptions.push({
      kind: "takings_gap",
      eventId: event.id,
      name: event.name,
      date: event.date,
      unitLabel: event.unitLabel,
      unitsLogged: event.unitsLogged,
      unitPriceCents: toCents(event.unitPrice),
      expectedCents: toCents(event.expected),
      receivedCents: toCents(event.received),
      missingCents,
    });
  }
  const unsigned = paymentsOut.filter((p) => !signed.has(p.rowId));
  if (unsigned.length > 0) {
    const signedRequests = rows.filter((row) => row.requestedBy !== null).map((row) => row.date);
    exceptions.push({
      kind: "no_two_key_record",
      count: unsigned.length,
      totalCents: total(unsigned),
      rowIds: unsigned.map((p) => p.rowId),
      firstSignedRequestDate: signedRequests.length > 0 ? signedRequests.reduce((a, b) => (a < b ? a : b)) : null,
    });
  }
  for (const line of budgetLines.filter((l) => l.leftCents < 0)) {
    exceptions.push({ kind: "over_budget", budgetLine: line.id, label: line.label, approvedCents: line.approvedCents, spentCents: line.approvedCents - line.leftCents, overCents: -line.leftCents });
  }
  for (const row of outRows.filter((r) => !budget.some((line) => line.category === r.category))) {
    exceptions.push({ kind: "no_budget_line", rowId: row.id, category: row.category, description: row.description, amountCents: -toCents(row.amount) });
  }

  const laterCents = laterRows.reduce((sum, row) => sum + toCents(row.amount), 0);
  const balance = data.balances[0];
  const balanceCents = balance ? toCents(balance.available) : 0;
  return {
    version: CLOSE_FIGURES_VERSION,
    club: data.club,
    month,
    period,
    openingCents,
    moneyInCents,
    moneyOutCents,
    closingCents,
    moneyIn,
    budgetLines,
    openItems,
    exceptions,
    carriedForward: {
      laterCents,
      balanceCents,
      balanceAsOf: balance?.asOf ?? "",
      reconciles: balance !== undefined && closingCents + laterCents === balanceCents,
    },
  };
}

/** October 2026 from the seed: the close this demo's Reviewer signs. */
export function octoberClose(): CloseFigures {
  return computeMonthClose(riverbend, CLOSE_MONTH);
}

/** The close hash: SHA-256 (hex) of the figures' canonical JSON. What the Reviewer's key signs. */
export function closeHash(figures: CloseFigures): Promise<string> {
  return sha256Hex(canonicalJson(figures));
}
