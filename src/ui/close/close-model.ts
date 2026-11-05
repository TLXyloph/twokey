/**
 * What the monthly close screen says, computed from `CloseFigures` and kept free of React so every
 * label, figure and hint is tested as plain data. Money from integer cents; dates from the close's
 * ISO dates; times in the club's time zone (America/Chicago).
 *
 * The screen names no AI vendor: the draft is "Drafted by the AI (recorded)".
 */
import type { CloseException, CloseFigures, CloseSignoffView } from "@/close/contracts";
import { formatAsOf } from "@/demo/board-figures";
import type { ActingRole } from "@/ledger/contracts";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "$4,368.75" from 436875. */
export const money = (cents: number): string => usd.format(cents / 100);
/** "+$4,175.00" / "−$2,355.25": the sign lives in the text (a true minus sign). */
export const signedMoney = (cents: number, sign: "+" | "−"): string => `${sign}${money(Math.abs(cents))}`;

/** "Oct 24" from "2026-10-24", without the locale or a time zone. */
export function shortDay(isoDate: string): string {
  const [, month, day] = isoDate.split("-").map(Number) as [number, number, number];
  return `${MONTHS[month - 1] ?? ""} ${day}`;
}

export const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

export const DRAFT_LABEL = "Drafted by the AI (recorded)";
export const DRAFT_MISSING = "The AI's draft isn't recorded yet.";

// --- The statement --------------------------------------------------------------------------------

export interface StatementCell {
  key: "opening" | "in" | "out" | "closing";
  label: string;
  value: string;
  note: string;
}

export function statementCells(figures: CloseFigures): StatementCell[] {
  const payments = figures.budgetLines.reduce((n, line) => n + line.payments.length, 0);
  return [
    { key: "opening", label: "Opening balance", value: money(figures.openingCents), note: shortDay(figures.period.from) },
    { key: "in", label: "Money in", value: signedMoney(figures.moneyInCents, "+"), note: plural(figures.moneyIn.length, "deposit", "deposits") },
    { key: "out", label: "Money out", value: signedMoney(figures.moneyOutCents, "−"), note: plural(payments, "payment", "payments") },
    { key: "closing", label: "Closing balance", value: money(figures.closingCents), note: shortDay(figures.period.to) },
  ];
}

/** The line under the statement that proves the month carries forward to the account balance. */
export function carriedForwardLine(figures: CloseFigures): { ok: boolean; text: string } {
  const { laterCents, balanceCents, balanceAsOf, reconciles } = figures.carriedForward;
  const sum = `${money(figures.closingCents)} + ${money(laterCents)} completed after ${shortDay(figures.period.to)} = ${money(figures.closingCents + laterCents)}`;
  const asOf = formatAsOf(balanceAsOf);
  return reconciles
    ? { ok: true, text: `Carries forward: ${sum}, the club account's balance as of ${asOf}.` }
    : { ok: false, text: `Doesn't carry forward: ${sum}, but the club account's balance as of ${asOf} is ${money(balanceCents)}.` };
}

export function openItemsLine(figures: CloseFigures): string {
  const end = shortDay(figures.period.to);
  if (figures.openItems.length === 0) return `Open at month end: none. No payout was waiting for a second key on ${end}.`;
  const total = figures.openItems.reduce((sum, item) => sum + item.amountCents, 0);
  return `Open at month end: ${plural(figures.openItems.length, "payout", "payouts")} (${money(total)}) waiting for a second key on ${end}.`;
}

/** The sentence under the title: does the month add up, and what is left for the Reviewer. */
export function closeFinding(figures: CloseFigures): string {
  const count = figures.exceptions.length;
  const left = count === 0 ? "Nothing needs a second look before the Reviewer signs." : `${plural(count, "exception", "exceptions")} to check before the Reviewer signs.`;
  return figures.carriedForward.reconciles
    ? `October adds up and closes at ${money(figures.closingCents)}. ${left}`
    : `October doesn't carry forward to the account balance. ${left}`;
}

// --- Exceptions -----------------------------------------------------------------------------------

export interface ExceptionView {
  key: string;
  title: string;
  /** The figure set beside the title; `shortfall` is drawn in the data maroon. */
  figure: string;
  shortfall: boolean;
  lines: string[];
}

export function exceptionView(exception: CloseException, figures: CloseFigures): ExceptionView {
  switch (exception.kind) {
    case "takings_gap":
      return {
        key: `gap-${exception.eventId}`,
        title: `${exception.name}, ${shortDay(exception.date)}`,
        figure: signedMoney(exception.missingCents, "−"),
        shortfall: true,
        lines: [
          `${exception.unitsLogged} ${exception.unitLabel} logged × ${money(exception.unitPriceCents)} = ${money(exception.expectedCents)} expected.`,
          `${money(exception.receivedCents)} received; ${money(exception.missingCents)} has no record.`,
        ],
      };
    case "no_two_key_record": {
      const dates = figures.budgetLines.flatMap((line) => line.payments).filter((p) => exception.rowIds.includes(p.rowId)).map((p) => p.date);
      const first = exception.firstSignedRequestDate;
      const allBefore = first !== null && dates.length === exception.count && dates.every((date) => date < first);
      return {
        key: "no-two-key-record",
        title: "Paid with no two-key record",
        figure: money(exception.totalCents),
        shortfall: false,
        lines: [
          `${plural(exception.count, "payment", "payments")} out have no two officers' signatures on record.`,
          allBefore && first
            ? `All predate TwoKey's first signed request (${shortDay(first)}): check them against the officers' paper approvals.`
            : "Check them against the officers' approvals.",
        ],
      };
    }
    case "over_budget":
      return {
        key: `over-${exception.budgetLine}`,
        title: `${exception.label} over budget`,
        figure: signedMoney(exception.overCents, "−"),
        shortfall: false,
        lines: [`${money(exception.spentCents)} paid against ${money(exception.approvedCents)} approved for the season.`],
      };
    case "no_budget_line":
      return {
        key: `nobudget-${exception.rowId}`,
        title: "Paid from no budget line",
        figure: money(exception.amountCents),
        shortfall: false,
        lines: [`${exception.description}: its category, ${exception.category}, is on no budget line.`],
      };
  }
}

// --- October, row by row, and the budget lines ----------------------------------------------------

export interface LedgerRow {
  key: string;
  date: string;
  description: string;
  counterparty: string;
  /** What the row is checked against: a fundraiser's expected takings or a payment's budget line; null for neither. */
  against: string | null;
  /** A fundraiser's shortfall, drawn in the data maroon; null when the takings are complete. */
  short: string | null;
  amount: string;
}

export interface LedgerSection {
  key: "in" | "out";
  title: string;
  count: string;
  total: string;
  rows: LedgerRow[];
}

/** The month's rows behind the statement: deposits, then payments, each by date. */
export function ledgerSections(figures: CloseFigures): LedgerSection[] {
  const moneyIn: LedgerRow[] = figures.moneyIn.map((row) => {
    const t = row.takings;
    const missing = t ? t.expectedCents - t.receivedCents : 0;
    return {
      key: row.rowId,
      date: shortDay(row.date),
      description: row.description,
      counterparty: row.counterparty,
      against: t ? `${money(t.expectedCents)} expected` : null,
      short: missing > 0 ? `${money(missing)} short` : null,
      amount: money(row.amountCents),
    };
  });
  const payments = figures.budgetLines
    .flatMap((line) => line.payments.map((p) => ({ p, line: line.label })))
    .sort((a, b) => a.p.date.localeCompare(b.p.date) || a.p.rowId.localeCompare(b.p.rowId));
  const moneyOut: LedgerRow[] = payments.map(({ p, line }) => ({
    key: p.rowId,
    date: shortDay(p.date),
    description: p.description,
    counterparty: p.counterparty,
    against: line,
    short: null,
    amount: money(p.amountCents),
  }));
  return [
    { key: "in", title: "Money in", count: plural(moneyIn.length, "deposit", "deposits"), total: signedMoney(figures.moneyInCents, "+"), rows: moneyIn },
    { key: "out", title: "Money out", count: plural(moneyOut.length, "payment", "payments"), total: signedMoney(figures.moneyOutCents, "−"), rows: moneyOut },
  ];
}

export interface BudgetRow {
  key: string;
  label: string;
  /** "$412.50 of $700.00". */
  figures: string;
  spentZero: boolean;
  /** Spent over approved, 0-1 (an overrun is drawn full). */
  share: number;
  meta: string;
}

export function budgetRows(figures: CloseFigures): BudgetRow[] {
  return figures.budgetLines.map((line) => ({
    key: line.id,
    label: line.label,
    figures: `${money(line.spentCents)} of ${money(line.approvedCents)}`,
    spentZero: line.spentCents === 0,
    share: line.approvedCents > 0 ? Math.min(1, line.spentCents / line.approvedCents) : 1,
    meta: `${line.payments.length === 0 ? "No payments" : plural(line.payments.length, "payment", "payments")} · ${line.leftCents < 0 ? `${money(-line.leftCents)} over` : `${money(line.leftCents)} left`}`,
  }));
}

export const approvedTotal = (figures: CloseFigures): number => figures.budgetLines.reduce((sum, line) => sum + line.approvedCents, 0);

// --- The sign-off ---------------------------------------------------------------------------------

const TITLES: Record<ActingRole, string> = { president: "President", treasurer: "Treasurer", secretary: "Secretary", reviewer: "Reviewer", parent: "Parent" };
export const roleName = (role: ActingRole): string => TITLES[role];

export const signButtonLabel = (role: ActingRole, busy: boolean): string => (busy ? "Signing…" : `Sign as ${roleName(role)}`);

/** A hint, never a lock: the button always works and the server decides (spec §6). */
export function signHint(role: ActingRole): { text: string; expectRefusal: boolean } {
  if (role === "reviewer") return { text: "Your demo key signs this close's hash. Change any figure and the signature no longer matches it.", expectRefusal: false };
  return { text: "Only the Reviewer, a non-signer, signs the close. The server refuses every other role.", expectRefusal: true };
}

/** "Signed by the Reviewer · demo key 4951e1dd". */
export const signatureLine = (signoff: Pick<CloseSignoffView, "title" | "keyId">): string => `Signed by the ${signoff.title} · demo key ${signoff.keyId}`;

/** "5bd24087…": a hash short enough for a sentence; the proof shows it whole. */
export const shortHash = (hash: string): string => (hash.length > 12 ? `${hash.slice(0, 8)}…` : hash);
