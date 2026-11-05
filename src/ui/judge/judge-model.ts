/**
 * What the judge UI says, computed from the board view and kept free of React so every label,
 * figure and hint is tested as plain data: money, the club's times, the review button, risk-card
 * labels, signature lines, the session's limits, sign hints and the payout timeline.
 *
 * Hints are hints. The server decides every signature (spec §6: the Sign button always works, the
 * server refuses), so nothing here disables an action.
 */
import { formatAsOf } from "@/demo/board-figures";
import { CLUB_TIME_ZONE, type ClubDemoData } from "@/demo/riverbend";
import type { BudgetLine } from "@/demo/riverbend-policy";
import {
  PAYOUT_CAP_CENTS,
  SESSION_PAYOUT_LIMIT,
  type ActingRole,
  type BoardView,
  type OfficerRole,
  type PayoutRequestView,
  type RiskCard,
  type RiskFinding,
  type RiskVerdict,
  type SignatureView,
} from "@/ledger/contracts";
import { reviewLabel } from "@/ui/studio/board-header-model";

export const ACTING_ROLES: readonly ActingRole[] = ["president", "treasurer", "secretary", "reviewer", "parent"];
export const DEFAULT_ROLE: ActingRole = "treasurer";

const ROLE_TITLES: Record<ActingRole, string> = {
  president: "President",
  treasurer: "Treasurer",
  secretary: "Secretary",
  reviewer: "Reviewer",
  parent: "Parent",
};

export const roleTitle = (role: ActingRole) => ROLE_TITLES[role];
export const isOfficer = (role: ActingRole): role is OfficerRole => role !== "parent" && role !== "reviewer";
export const isActingRole = (value: unknown): value is ActingRole => ACTING_ROLES.includes(value as ActingRole);

/** "the President or the Secretary". */
export function theRoles(roles: readonly OfficerRole[]): string {
  const named = roles.map((role) => `the ${roleTitle(role)}`);
  if (named.length <= 1) return named[0] ?? "";
  return `${named.slice(0, -1).join(", ")} or ${named.at(-1)}`;
}

// --- Money ---------------------------------------------------------------------------------------

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** "$42.00" from 4200. Money crosses the API in integer cents. */
export const formatCents = (cents: number) => usd.format(cents / 100);

export type AmountParse = { ok: true; cents: number } | { ok: false; message: string };

/** Reads "42", "$36.5" or "0.99" into whole cents, within judge mode's cap. */
export function parseAmountToCents(input: string, capCents: number = PAYOUT_CAP_CENTS): AmountParse {
  const text = input.trim().replace(/^\$/, "").replace(/,/g, "");
  if (text === "") return { ok: false, message: "Enter an amount." };
  const match = /^(\d+)(?:\.(\d*))?$/.exec(text);
  if (!match) return { ok: false, message: "Enter an amount in dollars, like 42.00." };
  const decimals = match[2] ?? "";
  if (decimals.length > 2) return { ok: false, message: "Use at most two decimal places." };
  const cents = Number(match[1]) * 100 + Number(decimals.padEnd(2, "0"));
  if (cents <= 0) return { ok: false, message: "The amount must be more than $0.00." };
  if (cents > capCents) return { ok: false, message: `Judge mode caps a payout at ${formatCents(capCents)}.` };
  return { ok: true, cents };
}

// --- Times (the club's time zone, so every browser agrees) ---------------------------------------

const clubTime = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  timeZone: CLUB_TIME_ZONE,
  timeZoneName: "short",
});
const clubDay = new Intl.DateTimeFormat("en-CA", { timeZone: CLUB_TIME_ZONE });

const toDate = (value: string | Date) => (value instanceof Date ? value : new Date(value));

/** "10:42:05 AM CST". */
export function formatClubTime(value: string | Date): string {
  const date = toDate(value);
  return Number.isNaN(date.getTime()) ? "" : clubTime.format(date);
}

/** A step today reads "10:42:05 AM CST"; on another day, "Nov 2, 9:10 AM CST". */
export function formatStepTime(value: string | Date, now: Date = new Date()): string {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return "";
  return clubDay.format(date) === clubDay.format(now) ? formatClubTime(date) : formatAsOf(date);
}

// --- The board's queue ---------------------------------------------------------------------------

/** Waiting requests in the live view; null until the first view arrives (the seed figure stands). */
export function waitingCount(view: BoardView | null): number | null {
  return view ? view.requests.filter((r) => r.status === "waiting").length : null;
}

export function reviewButtonLabel(role: ActingRole, count: number): string {
  if (!isOfficer(role)) return "See payouts";
  return count > 0 ? reviewLabel(count) : "No payouts waiting";
}

/**
 * Waiting first; then the signed ones (both keys on them: sent, confirmed, or stopped by a limit or
 * PayPal); then the ones an officer sent back. Each in the server's order.
 */
export function requestSections(view: BoardView): { waiting: PayoutRequestView[]; signed: PayoutRequestView[]; sentBack: PayoutRequestView[] } {
  return {
    waiting: view.requests.filter((r) => r.status === "waiting"),
    signed: view.requests.filter((r) => r.status !== "waiting" && r.status !== "sent_back"),
    sentBack: view.requests.filter((r) => r.status === "sent_back"),
  };
}

// --- Sending a payout back -----------------------------------------------------------------------

/** The server's limits on a send-back's reason (src/disbursements/api/payout-handlers.ts). */
export const SEND_BACK_REASON_MIN = 3;
export const SEND_BACK_REASON_MAX = 200;

/**
 * Whether to offer "Send back": only to an officer who could add key 2, which is the server's own
 * answer in `eligibleSigners` (not the requester, not the payee, not a parent or the reviewer). The
 * server still decides, and refuses anyone else.
 */
export const canSendBack = (request: PayoutRequestView, role: ActingRole): boolean =>
  request.status === "waiting" && isOfficer(role) && request.eligibleSigners.includes(role);

/** The reason a send-back starts from: the card's top flag (stop before warn), within the limit. */
export function defaultSendBackReason(card: RiskCard | null): string {
  const top = card?.findings.find((f) => f.severity === "stop") ?? card?.findings.find((f) => f.severity === "warn");
  const text = top?.text.trim() ?? "";
  return text.length <= SEND_BACK_REASON_MAX ? text : `${text.slice(0, SEND_BACK_REASON_MAX - 1).trimEnd()}…`;
}

export type ReasonCheck = { ok: true; reason: string } | { ok: false; message: string };

export function checkSendBackReason(input: string): ReasonCheck {
  const reason = input.trim();
  if (reason.length < SEND_BACK_REASON_MIN) return { ok: false, message: `Say why in a few words: at least ${SEND_BACK_REASON_MIN} characters.` };
  if (reason.length > SEND_BACK_REASON_MAX) return { ok: false, message: `Keep the reason to ${SEND_BACK_REASON_MAX} characters.` };
  return { ok: true, reason };
}

export const reasonCount = (input: string) => `${input.length} of ${SEND_BACK_REASON_MAX} characters`;

// --- Risk cards ----------------------------------------------------------------------------------

const VERDICTS: Record<RiskVerdict, string> = { clear: "Looks right", check: "Check this", stop: "Stop" };
export const verdictLabel = (verdict: RiskVerdict) => VERDICTS[verdict];

const ORIGINS: Record<RiskCard["origin"], string> = {
  live: "Checked by the AI",
  recorded: "Recorded check",
  replay: "Replay of a recorded check",
  rules: "Rules only",
};
export const originLabel = (origin: RiskCard["origin"]) => ORIGINS[origin];

/** A check or stop card needs the second signer's "I've read the flags" (spec §3). */
export const needsAcknowledgement = (card: RiskCard | null) => card !== null && card.verdict !== "clear";

/** The flags (warn and stop) stay in view; the info notes fold away. Each keeps the card's order. */
export function splitFindings(findings: readonly RiskFinding[]): { flags: RiskFinding[]; notes: RiskFinding[] } {
  return { flags: findings.filter((f) => f.severity !== "info"), notes: findings.filter((f) => f.severity === "info") };
}

export const notesLabel = (count: number) => (count === 1 ? "1 note" : `${count} notes`);

// --- Signatures and limits -----------------------------------------------------------------------

/** "Signed by the Treasurer · demo key 7f3a1c2e". */
export const signatureLine = (signature: Pick<SignatureView, "title" | "keyId">) =>
  `Signed by the ${signature.title} · demo key ${signature.keyId}`;

export function limitsLine(limits: BoardView["limits"]): string {
  if (limits.dailyCentsLeft <= 0) return "The demo's daily limit is used up. Try again tomorrow.";
  const left = limits.sessionPayoutsLeft;
  const session = left <= 0 ? "No payouts left in this session" : `${left} of ${SESSION_PAYOUT_LIMIT} payouts left in this session`;
  // The daily figure only matters once it is smaller than what this session could still send.
  const daily =
    left > 0 && limits.dailyCentsLeft < left * limits.payoutCapCents
      ? ` · ${formatCents(limits.dailyCentsLeft)} left today across all sessions`
      : "";
  return session + daily;
}

export interface SignHint {
  text: string;
  /** The server is expected to refuse this role's key. The button still works. */
  expectRefusal: boolean;
}

export function signHint(request: PayoutRequestView, role: ActingRole): SignHint | null {
  if (request.status !== "waiting") return null;
  if (!isOfficer(role)) return { text: "Parents can see payouts. Only officers sign them.", expectRefusal: true };
  if (request.eligibleSigners.includes(role)) return { text: "Your key would be the second of two.", expectRefusal: false };
  if (request.payee.role === role) {
    return { text: "You're the payee, so your key can't approve this. Try it: the server checks, not this page.", expectRefusal: true };
  }
  const others = theRoles(request.eligibleSigners);
  if (request.signatures.some((s) => s.role === role)) {
    return {
      text: others ? `You signed this request. The second key must come from ${others}.` : "You signed this request.",
      expectRefusal: true,
    };
  }
  return { text: others ? `Only ${others} can add the second key.` : "No officer can add the second key.", expectRefusal: true };
}

// --- The timeline --------------------------------------------------------------------------------

export interface TimelineRow {
  key: "requested" | "signed" | "sent" | "confirmed" | "not-sent" | "sent-back";
  label: string;
  state: "done" | "pending" | "stopped";
  /** Null while the step is still to come. */
  time: string | null;
  detail?: string;
  /** On "PayPal confirmed" while it waits: when the payout went to PayPal, to count the wait from. */
  waitingSince?: string;
}

/**
 * Requested → Signed → Sent to PayPal → PayPal confirmed, or Requested → Signed → Not sent (blocked
 * or failed, with the reason), or Requested → Sent back by an officer (with their reason). Steps
 * still to come are listed, waiting, so the judge sees what is next.
 */
export function timelineRows(request: PayoutRequestView, now: Date = new Date()): TimelineRow[] {
  const last = (step: PayoutRequestView["timeline"][number]["step"]) => request.timeline.findLast((t) => t.step === step);
  const row = (key: TimelineRow["key"], label: string, step: ReturnType<typeof last>, pending = "pending" as const): TimelineRow => ({
    key,
    label,
    state: step ? "done" : pending,
    time: step ? formatStepTime(step.at, now) : null,
    ...(step?.detail ? { detail: step.detail } : {}),
  });

  const requested = row("requested", "Requested", last("requested") ?? { step: "requested", label: "Requested", at: request.createdAt });
  const sentBack = last("sent_back");
  if (sentBack) {
    return [requested, { key: "sent-back", label: sentBack.label, state: "stopped", time: formatStepTime(sentBack.at, now), ...(sentBack.detail ? { detail: sentBack.detail } : {}) }];
  }
  const rows = [requested, row("signed", "Signed", last("signed"))];
  const stopped = last("failed") ?? last("blocked");
  if (stopped) {
    return [...rows, { key: "not-sent", label: "Not sent", state: "stopped", time: formatStepTime(stopped.at, now), detail: stopped.detail ?? stopped.label }];
  }
  const sent = last("sent");
  const confirmed = row("confirmed", "PayPal confirmed", last("confirmed"));
  if (sent && confirmed.state === "pending") confirmed.waitingSince = sent.at;
  return [...rows, row("sent", "Sent to PayPal", sent), confirmed];
}

// --- Budget lines --------------------------------------------------------------------------------

/** What is left on a budget line: approved for the season minus money out on its category. */
export function budgetLeftCents(data: ClubDemoData, line: BudgetLine): number {
  const spent = data.ledger
    .filter((row) => row.direction === "out" && row.category === line.category)
    .reduce((total, row) => total - Math.round(row.amount * 100), 0);
  return line.approvedCents - spent;
}
