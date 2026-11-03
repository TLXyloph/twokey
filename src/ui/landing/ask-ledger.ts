/**
 * "Ask the ledger": answers a parent's question from the Riverbend demo data, instantly and offline.
 * Pure functions only (no network, no AI): the landing page renders the default answer on the server
 * and re-runs this on every keystroke in the browser.
 *
 * Figures are computed from the ledger rows every time, so a total shown in the sentence and the rows
 * shown under it can never disagree.
 */
import { riverbend, type ClubDemoData, type FundraisingEvent, type LedgerEntry, type LedgerStatus } from "@/demo/riverbend";

export const DEFAULT_QUESTION = "Where did the car-wash money go?";
export const EXAMPLE_QUESTIONS = ["What is still pending?", "Spirit-wear sale", "Riverbend Team Supply"] as const;
export const NO_MATCH = "Nothing in the ledger matches that. Try an event or a payee.";

export type AnswerKind = "event" | "pending" | "payee" | "none";

export interface AnswerRow {
  id: string;
  /** ISO date (YYYY-MM-DD). */
  date: string;
  /** "Oct 24". */
  dateLabel: string;
  description: string;
  counterparty: string;
  /** Signed USD, as in the ledger. */
  amount: number;
  /** "+$15.00" or "−$38.75". */
  amountLabel: string;
  status: LedgerStatus;
  statusLabel: string;
}

export interface LedgerAnswer {
  kind: AnswerKind;
  sentence: string;
  rows: AnswerRow[];
}

export interface FormatOptions {
  /** "auto" drops ".00"; "always" keeps two decimals. */
  cents?: "auto" | "always";
  /** Put "+" on positive amounts (negatives always carry a true minus). */
  signed?: boolean;
}

const MINUS = "−";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const NUMBER_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const PENDING_WORDS = /\b(pending|waiting|awaiting|approval|approver|unapproved|unsigned)\b/;

const toCents = (amount: number) => Math.round(amount * 100);

export function formatUSD(amount: number, { cents = "auto", signed = false }: FormatOptions = {}): string {
  const total = toCents(amount);
  const abs = Math.abs(total);
  const dollars = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const rest = abs % 100;
  const body = cents === "auto" && rest === 0 ? `$${dollars}` : `$${dollars}.${String(100 + rest).slice(1)}`;
  if (total < 0) return MINUS + body;
  return signed && total > 0 ? `+${body}` : body;
}

const countWord = (n: number) => NUMBER_WORDS[n] ?? String(n);
const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Lower case, hyphens and dashes as spaces, other punctuation dropped, "&" as "and". */
const normalise = (text: string) =>
  text
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[-‐-―_/]/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const contains = (question: string, phrase: string) => phrase.length > 0 && ` ${question} `.includes(` ${phrase} `);
const withoutParenthetical = (name: string) => name.replace(/\s*\([^)]*\)\s*/g, " ").trim();

function dateParts(iso: string) {
  const [, month = "1", day = "1"] = iso.split("-");
  return { month: MONTHS[Number(month) - 1] ?? "", day: Number(day) };
}
const longDate = (iso: string) => `${dateParts(iso).month} ${dateParts(iso).day}`;
const shortDate = (iso: string) => `${dateParts(iso).month.slice(0, 3)} ${dateParts(iso).day}`;

function statusLabel(row: LedgerEntry): string {
  if (row.status === "pending") return "Waiting for the second key";
  return row.direction === "in" ? "Received" : "Paid";
}

function toRow(row: LedgerEntry): AnswerRow {
  return {
    id: row.id,
    date: row.date,
    dateLabel: shortDate(row.date),
    description: row.description.replace(/\s*\(awaiting second approver\)\s*$/i, ""),
    counterparty: row.counterparty,
    amount: row.amount,
    amountLabel: formatUSD(row.amount, { cents: "always", signed: true }),
    status: row.status,
    statusLabel: statusLabel(row),
  };
}

const chronological = (a: LedgerEntry, b: LedgerEntry) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id);
const rowsOf = (entries: LedgerEntry[]) => entries.slice().sort(chronological).map(toRow);
const sumCents = (entries: LedgerEntry[]) => entries.reduce((total, row) => total + toCents(row.amount), 0);

// --- events -------------------------------------------------------------------------------------

function eventPhrases(event: FundraisingEvent): string[] {
  const name = normalise(event.name);
  const short = name.replace(/ sale$/, "");
  return [name, short, short.replace(/ /g, "")];
}

function answerEvent(event: FundraisingEvent, data: ClubDemoData): LedgerAnswer {
  const entries = data.ledger.filter((row) => row.eventId === event.id);
  const receivedCents = sumCents(entries.filter((row) => row.direction === "in" && row.status === "completed"));
  const expectedCents = toCents(event.unitsLogged * event.unitPrice);
  const gapCents = expectedCents - receivedCents;
  const gap =
    gapCents > 0
      ? `${formatUSD(gapCents / 100)} has no record.`
      : gapCents < 0
        ? `That is ${formatUSD(-gapCents / 100)} more than expected.`
        : "Nothing is missing.";
  const sentence =
    `${event.name}, ${longDate(event.date)}: ${event.unitsLogged} ${event.unitLabel} logged at ${formatUSD(event.unitPrice)}, ` +
    `so ${formatUSD(expectedCents / 100)} expected. ${formatUSD(receivedCents / 100)} reached the club's PayPal account. ${gap}`;
  return { kind: "event", sentence, rows: rowsOf(entries) };
}

// --- payees -------------------------------------------------------------------------------------

/** The full name, the name without a leading "Riverbend", and its first two words. */
function payeePhrases(name: string): string[] {
  const core = normalise(withoutParenthetical(name));
  const local = core.replace(/^riverbend /, "");
  const firstTwo = local.split(" ").slice(0, 2).join(" ");
  return [...new Set([core, local, local.includes(" ") ? firstTwo : ""])].filter(Boolean);
}

function answerPayee(name: string, data: ClubDemoData): LedgerAnswer {
  const entries = data.ledger.filter((row) => row.direction === "out" && row.counterparty === name);
  const paid = entries.filter((row) => row.status === "completed");
  const waiting = entries.filter((row) => row.status === "pending");
  const parts = [
    paid.length ? `${formatUSD(-sumCents(paid) / 100)} paid` : "",
    waiting.length ? `${formatUSD(-sumCents(waiting) / 100)} waiting for a second approver` : "",
  ].filter(Boolean);
  const count = `${countWord(entries.length)} payout${entries.length === 1 ? "" : "s"}`;
  const sentence = `${withoutParenthetical(name)}: ${count}, ${parts.join(" and ")}.`;
  return { kind: "payee", sentence, rows: rowsOf(entries) };
}

// --- pending ------------------------------------------------------------------------------------

function answerPending(data: ClubDemoData): LedgerAnswer {
  const entries = data.ledger.filter((row) => row.direction === "out" && row.status === "pending");
  if (!entries.length) return { kind: "pending", sentence: "No payouts are waiting for a second approver.", rows: [] };
  const many = entries.length > 1;
  const sentence =
    `${capitalise(countWord(entries.length))} payout${many ? "s are" : " is"} waiting for a second approver, ` +
    `${formatUSD(-sumCents(entries) / 100)}${many ? " in all" : ""}. Nothing leaves the account until a second officer signs.`;
  return { kind: "pending", sentence, rows: rowsOf(entries) };
}

// --- the question -------------------------------------------------------------------------------

/** Events first, then a named payee, then the pending list; anything else matches nothing. */
export function askLedger(question: string, data: ClubDemoData = riverbend): LedgerAnswer {
  const q = normalise(question);
  if (!q) return { kind: "none", sentence: NO_MATCH, rows: [] };

  const event = data.events.find((e) => eventPhrases(e).some((p) => contains(q, p)));
  if (event) return answerEvent(event, data);

  const payees = [...new Set(data.ledger.filter((row) => row.direction === "out").map((row) => row.counterparty))];
  const payee = payees.find((name) => payeePhrases(name).some((p) => contains(q, p)));
  if (payee) return answerPayee(payee, data);

  if (PENDING_WORDS.test(q)) return answerPending(data);
  return { kind: "none", sentence: NO_MATCH, rows: [] };
}
