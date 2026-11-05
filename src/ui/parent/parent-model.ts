/**
 * What the parent ledger says outside Studio, computed from the session's club data and kept free of
 * React so every sentence is tested as plain data: the latest rows (the hero's statement), each
 * event's takings as one figure and one sentence, the balance figures for the phone, and the
 * Watchtower's view with anything a parent may not see taken out.
 *
 * Wording rules (docs/twokey-concept.md §0, §4): plain words; times in the club's time zone; never
 * say money went missing or name a cause; a payout waiting for a second key hasn't left the account;
 * no payee emails or addresses.
 */
import { formatAsOf, formatEventDate, formatUsd, moneyInThisMonth, secondKeyQueue } from "@/demo/board-figures";
import type { ClubDemoData, FundraisingEvent, LedgerEntry } from "@/demo/riverbend";
import type { WatchFinding, WatchtowerView } from "@/watchtower/contracts";
import { parentStatus, type ParentRowStatus } from "./parent-data";

const cents = (amount: number) => Math.round(amount * 100);
const minus = "−";

/** "$1,305" for whole dollars, "$22.50" otherwise: how a person says a sum. */
export function money(amount: number): string {
  const text = formatUsd(Math.abs(amount));
  const short = cents(amount) % 100 === 0 ? text.replace(/\.00$/, "") : text;
  return amount < 0 ? `${minus}${short}` : short;
}

/** "+$30.00" or "−$42.00": a ledger row's amount, always with its sign. */
export function signedMoney(amount: number): string {
  return `${amount < 0 ? minus : "+"}${formatUsd(Math.abs(amount))}`;
}

const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
/** "Nov 5" for an ISO date (YYYY-MM-DD). */
export const shortDay = (isoDate: string) => shortDate.format(new Date(`${isoDate}T00:00:00Z`));

// --- The ledger, newest first --------------------------------------------------------------------

export interface LedgerLine {
  id: string;
  date: string;
  day: string;
  description: string;
  party: string;
  amount: string;
  direction: LedgerEntry["direction"];
  status: ParentRowStatus;
  waiting: boolean;
}

/** Every row, newest day first; on one day, the row the ledger recorded last comes first. */
export function ledgerNewestFirst(data: ClubDemoData): LedgerLine[] {
  return data.ledger
    .map((row, index) => ({ row, index }))
    .sort((a, b) => b.row.date.localeCompare(a.row.date) || b.index - a.index)
    .map(({ row }) => ({
      id: row.id,
      date: row.date,
      day: shortDay(row.date),
      description: row.description,
      party: row.counterparty,
      amount: signedMoney(row.amount),
      direction: row.direction,
      status: parentStatus(row),
      waiting: row.status === "pending",
    }));
}

export const latestLines = (data: ClubDemoData, count = 5) => ledgerNewestFirst(data).slice(0, count);

// --- Takings, one event at a time ----------------------------------------------------------------

export interface EventTakings {
  id: string;
  name: string;
  day: string;
  received: string;
  expected: string;
  /** Expected minus received, in cents; positive when takings have no record. */
  gapCents: number;
  /** How the figure is worked out, and what the ledger does and doesn't hold. */
  sentence: string;
}

const counted = (event: FundraisingEvent) => {
  const unit = event.unitsLogged === 1 && event.unitLabel.endsWith("s") ? event.unitLabel.slice(0, -1) : event.unitLabel;
  return `${event.unitsLogged} ${unit} at ${money(event.unitPrice)} each make ${money(event.expected)} expected.`;
};

function paymentsSentence(count: number, received: number): string {
  if (count === 0) return "No payment is recorded against it";
  if (count === 1) return `One ${money(received)} payment is recorded`;
  return `${count} payments totalling ${money(received)} are recorded`;
}

export function eventTakings(data: ClubDemoData): EventTakings[] {
  return [...data.events]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((event) => {
      const gapCents = cents(event.expected) - cents(event.received);
      const deposits = data.ledger.filter((row) => row.eventId === event.id && row.direction === "in" && row.status === "completed");
      let recorded: string;
      if (gapCents > 0) {
        recorded = `${paymentsSentence(deposits.length, event.received)}; the ledger has no record of the other ${money(gapCents / 100)}.`;
      } else if (gapCents < 0) {
        recorded = `${money(event.received)} is recorded, ${money(-gapCents / 100)} more than expected.`;
      } else {
        recorded = `All ${money(event.received)} is recorded.`;
      }
      return {
        id: event.id,
        name: event.name,
        day: formatEventDate(event.date),
        received: money(event.received),
        expected: money(event.expected),
        gapCents,
        sentence: `${counted(event)} ${recorded}`,
      };
    });
}

/** The event the page opens on: the largest gap, or the latest event when every one reconciles. */
export function storyEventId(events: readonly EventTakings[]): string | null {
  const short = [...events].filter((e) => e.gapCents > 0).sort((a, b) => b.gapCents - a.gapCents)[0];
  return short?.id ?? events.at(-1)?.id ?? null;
}

// --- Balance, for the stacked phone version ------------------------------------------------------

export interface BalanceFigures {
  balance: string;
  asOf: string;
  waitingTotal: string;
  waitingCaption: string;
  moneyIn: string;
  moneyInLabel: string;
  /** The phone's captions, set under each figure: "In the club account, as of Nov 3, 10:30 AM CST". */
  balanceLine: string;
  waitingLine: string;
}

export function balanceFigures(data: ClubDemoData): BalanceFigures {
  const balance = data.balances[0];
  const queue = secondKeyQueue(data);
  // The month comes from the balance's as-of time; without a balance there is no month to name.
  const month = balance && !Number.isNaN(new Date(balance.asOf).getTime()) ? moneyInThisMonth(data) : null;
  return {
    balance: formatUsd(balance?.available ?? 0),
    asOf: balance ? `As of ${formatAsOf(balance.asOf)}` : "",
    waitingTotal: formatUsd(queue.total),
    waitingCaption: queue.count === 0 ? "Nothing waiting" : `${queue.count} ${queue.count === 1 ? "payout" : "payouts"}, not paid yet`,
    moneyIn: formatUsd(month?.total ?? 0),
    moneyInLabel: month ? `Money in, ${month.monthName}` : "Money in this month",
    balanceLine: balance ? `In the club account, as of ${formatAsOf(balance.asOf)}` : "In the club account",
    waitingLine:
      queue.count === 0
        ? "Nothing is waiting for a second key"
        : `Waiting for a second key: ${queue.count} ${queue.count === 1 ? "payout" : "payouts"}, not paid yet`,
  };
}

// --- The Watchtower, as a parent may see it ------------------------------------------------------

/**
 * A finding without what a parent may not see (§4: no payee personal details): a counterparty that
 * is an email address, masked or not, is dropped. Officers' names and the club's known payees stay,
 * because who holds which key is public.
 */
export function parentFinding(finding: WatchFinding): WatchFinding {
  return finding.counterparty && finding.counterparty.includes("@") ? { ...finding, counterparty: null, counterpartyIsOfficer: false } : finding;
}

export function parentWatch(view: WatchtowerView | null): WatchtowerView | null {
  if (!view) return null;
  return { ...view, findings: (view.findings ?? []).map(parentFinding), explained: (view.explained ?? []).map(parentFinding) };
}
