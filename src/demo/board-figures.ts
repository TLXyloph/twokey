/**
 * Every figure the board states outside Studio's own widgets, computed from the demo rows in
 * ./riverbend.ts and never typed in: the finding under the title, the payouts waiting for a second
 * key, money in this month and the balance's as-of time. Each one that also appears inside Studio
 * (a widget aggregates the same rows) has a test proving the copies agree.
 */
import { CLUB_TIME_ZONE, OFFICERS, riverbend, type ClubDemoData, type OfficerRole } from "./riverbend";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const cents = (amount: number) => Math.round(amount * 100);
const sum = (amounts: number[]) => amounts.reduce((total, amount) => total + cents(amount), 0) / 100;

export const formatUsd = (amount: number) => usd.format(amount);

const asOfFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: CLUB_TIME_ZONE,
  timeZoneName: "short",
});

/** "Nov 3, 10:30 AM CST": in the club's time zone, so the server and every browser agree. */
export function formatAsOf(value: string | number | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : asOfFormat.format(date);
}

const monthNameFormat = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: CLUB_TIME_ZONE });

/** "November": the month a time falls in, in the club's time zone. Empty for a missing time. */
export function monthNameOf(value: string | number | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : monthNameFormat.format(date);
}

/** "October 24" for an ISO date (YYYY-MM-DD). */
export function formatEventDate(isoDate: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(`${isoDate}T00:00:00Z`));
}

const titleOf = (role: OfficerRole) => OFFICERS.find((o) => o.role === role)?.title ?? role;

/** "President or Secretary": every officer but the one who signed first. */
export function stillToSign(requestedBy: OfficerRole): string {
  const others = OFFICERS.filter((o) => o.role !== requestedBy).map((o) => o.title);
  return others.length <= 2 ? others.join(" or ") : `${others.slice(0, -1).join(", ")} or ${others.at(-1)}`;
}

export interface WaitingPayout {
  id: string;
  date: string;
  payee: string;
  description: string;
  /** The payout as a positive amount. */
  amount: number;
  signedBy: string;
  stillToSign: string;
}

/** Payouts with one key on them: pending money out, with who signed and who still can. */
export function secondKeyQueue(data: ClubDemoData = riverbend) {
  const payouts: WaitingPayout[] = data.ledger
    .filter((row) => row.status === "pending" && row.direction === "out" && row.requestedBy !== null)
    .map((row) => ({
      id: row.id,
      date: row.date,
      payee: row.counterparty,
      description: row.description,
      amount: -row.amount,
      signedBy: titleOf(row.requestedBy as OfficerRole),
      stillToSign: stillToSign(row.requestedBy as OfficerRole),
    }));
  return { payouts, count: payouts.length, total: sum(payouts.map((p) => p.amount)) };
}

/** The month the balance was read in, in the club's time zone, as "YYYY-MM". */
export function balanceMonth(data: ClubDemoData = riverbend): string {
  const asOf = data.balances[0]?.asOf ?? "";
  const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", timeZone: CLUB_TIME_ZONE }).formatToParts(new Date(asOf));
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}`;
}

/** Completed money in dated in the balance's month. */
export function isMoneyInThisMonth(row: Pick<ClubDemoData["ledger"][number], "direction" | "status" | "date">, month: string): boolean {
  return row.direction === "in" && row.status === "completed" && row.date.startsWith(month);
}

export function moneyInThisMonth(data: ClubDemoData = riverbend) {
  const month = balanceMonth(data);
  const rows = data.ledger.filter((row) => isMoneyInThisMonth(row, month));
  const monthName = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));
  return { month, monthName, count: rows.length, total: sum(rows.map((r) => r.amount)) };
}

/** The event with the largest shortfall, as the sentence the board leads with. */
export function boardFinding(data: ClubDemoData = riverbend): string {
  const worst = data.events
    .map((e) => ({ event: e, gap: sum([e.expected, -e.received]) }))
    .filter((e) => e.gap > 0)
    .sort((a, b) => b.gap - a.gap)[0];
  if (!worst) return "Every event's takings are recorded in full.";
  const { event, gap } = worst;
  return `${event.name}, ${formatEventDate(event.date)}: ${formatUsd(gap)} of ${formatUsd(event.expected)} expected has no record.`;
}

/** The header's freshness line. */
export function balanceStamp(data: ClubDemoData = riverbend): string {
  return `PayPal sandbox · balance as of ${formatAsOf(data.balances[0]?.asOf ?? "")}`;
}
