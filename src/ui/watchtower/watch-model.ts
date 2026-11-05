/**
 * What the Watchtower says on the board, computed from `BoardView.watchtower` and kept free of React
 * so every sentence is tested as plain data: the status line, the alert a status raises, and one
 * sentence per finding. Spec: .plans/watchtower-spec.md ("UI"); contract: src/watchtower/contracts.ts.
 *
 * Wording rules (spec §0):
 *   - times are in the club's time zone, so every browser agrees;
 *   - PayPal's "as of" time is always shown with a check;
 *   - a reporting delay is shown only when `reportedAfterMinutes` is known; otherwise the sentence
 *     says when PayPal recorded the money moving. Nothing promises minutes;
 *   - plain words, no vendor names.
 */
import { formatAsOf } from "@/demo/board-figures";
import { CLUB_TIME_ZONE } from "@/demo/riverbend";
import { formatCents } from "@/ui/judge/judge-model";
import { SILENT_AFTER_MINUTES, type FindingKind, type WatchFinding, type WatchStatus, type WatchtowerView } from "@/watchtower/contracts";

// --- Club times ----------------------------------------------------------------------------------

const clockFormat = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: CLUB_TIME_ZONE });
const dayFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: CLUB_TIME_ZONE });
const dayKeyFormat = new Intl.DateTimeFormat("en-CA", { timeZone: CLUB_TIME_ZONE });
const zoneFormat = new Intl.DateTimeFormat("en-US", { timeZone: CLUB_TIME_ZONE, timeZoneName: "short" });

const toDate = (value: string | Date) => (value instanceof Date ? value : new Date(value));
const valid = (date: Date) => !Number.isNaN(date.getTime());

/** "CST" (or "CDT" in summer) for a moment in the club's time zone. */
export function clubZone(value: string | Date): string {
  const date = toDate(value);
  return valid(date) ? (zoneFormat.formatToParts(date).find((p) => p.type === "timeZoneName")?.value ?? "") : "";
}

const sameClubDay = (a: Date, b: Date) => dayKeyFormat.format(a) === dayKeyFormat.format(b);

/** "at 10:20 AM" today; "on Nov 4 at 10:20 PM" on another day. No zone: the line adds it once. */
export function atClubTime(value: string | Date, now: Date): string {
  const date = toDate(value);
  if (!valid(date)) return "";
  return sameClubDay(date, now) ? `at ${clockFormat.format(date)}` : `on ${dayFormat.format(date)} at ${clockFormat.format(date)}`;
}

/** "2:59 AM" today; "Nov 4, 11:59 PM" on another day. No zone. */
export function clubClock(value: string | Date, now: Date): string {
  const date = toDate(value);
  if (!valid(date)) return "";
  return sameClubDay(date, now) ? clockFormat.format(date) : `${dayFormat.format(date)}, ${clockFormat.format(date)}`;
}

/** "52 min", "2 h", "1 h 52 min". */
export function formatDelay(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

// --- The status line -----------------------------------------------------------------------------

/** neutral: grey mark, muted words; notice: amber mark; alert: maroon mark, ink words. */
export type WatchTone = "neutral" | "notice" | "alert";

export interface WatchStatusLine {
  tone: WatchTone;
  /** "Watchtower checked PayPal at 10:20 AM · PayPal's records as of 2:59 AM CST"; null when there's no time to give. */
  stamp: string | null;
  /** What a non-ok status means, in one plain sentence; null when ok. */
  sentence: string | null;
  /** The whole line as read aloud. */
  text: string;
}

const line = (tone: WatchTone, stamp: string | null, sentence: string | null): WatchStatusLine => ({
  tone,
  stamp,
  sentence,
  text: [stamp ? (sentence ? `${stamp}.` : stamp) : null, sentence].filter(Boolean).join(" "),
});

export const STATUS_UNAVAILABLE = "Watchtower status unavailable";

const STATUS_TONES: Record<WatchStatus, WatchTone> = {
  ok: "neutral",
  stale_reports: "notice",
  no_access: "alert",
  silent: "alert",
  not_started: "neutral",
};

export const STALE_SENTENCE = "PayPal's reports are running late, so recent money may not show yet.";
export const NOT_STARTED_SENTENCE = "The Watchtower hasn't checked PayPal yet.";

/**
 * "Watchtower checked PayPal at 10:20 AM · PayPal's records as of 2:59 AM CST". After a failed or
 * missing check the first half says when it last got through ("last reached", "last checked").
 */
function stamp(view: WatchtowerView, now: Date): string {
  const verb = view.status === "no_access" ? "last reached PayPal" : view.status === "silent" ? "last checked PayPal" : "checked PayPal";
  const parts: string[] = [];
  if (view.checkedAt) parts.push(`Watchtower ${verb} ${atClubTime(view.checkedAt, now)}`);
  if (view.paypalAsOf) parts.push(`PayPal's records as of ${clubClock(view.paypalAsOf, now)}`);
  const zoneFrom = view.paypalAsOf ?? view.checkedAt;
  return parts.length === 0 ? "" : `${parts.join(" · ")} ${clubZone(zoneFrom!)}`.trim();
}

/** The always-visible line: when the Watchtower last checked, how fresh PayPal's records are, and what a non-ok status means. */
export function statusLine(view: WatchtowerView | null | undefined, now: Date = new Date()): WatchStatusLine {
  if (!view) return line("neutral", null, STATUS_UNAVAILABLE);
  const tone = STATUS_TONES[view.status] ?? "neutral";
  if (view.status === "not_started") return line(tone, null, NOT_STARTED_SENTENCE);
  const head = stamp(view, now) || null;
  if (view.status === "stale_reports") return line(tone, head, STALE_SENTENCE);
  if (head) return line(tone, head, null);
  // Lost access or silent with no successful check on record: the alert band says the rest.
  return line(tone, null, view.status === "no_access" ? "The Watchtower can't reach the club's PayPal account." : "The Watchtower hasn't checked in.");
}

/** A status that is an alert: its lead (set in the heavier weight) and the rest of the sentence. */
export interface StatusAlert {
  lead: string;
  rest: string;
  text: string;
}

const alertOf = (lead: string, rest: string): StatusAlert => ({ lead, rest, text: lead + rest });

/**
 * The alert a status raises on its own (silence is an alert): lost access, or no check for
 * SILENT_AFTER_MINUTES. Null for the other statuses, whose line says enough.
 */
export function statusAlert(view: WatchtowerView | null | undefined, now: Date = new Date()): StatusAlert | null {
  if (!view) return null;
  if (view.status === "no_access") return alertOf("TwoKey has lost access to the club's PayPal account", ": every officer should check the account's settings.");
  if (view.status !== "silent") return null;
  const since = view.checkedAt ? `since ${clubClock(view.checkedAt, now)} ${clubZone(view.checkedAt)}` : `for over ${SILENT_AFTER_MINUTES} minutes`;
  return alertOf(`The Watchtower hasn't checked in ${since}`, ", though it should check PayPal every 10 minutes.");
}

// --- One finding, one sentence -------------------------------------------------------------------

export interface FindingText {
  /** "$3.21". */
  amount: string;
  /** "left the club account outside TwoKey". */
  verb: string;
  /** After the colon: the route and who got it. "sent from PayPal's website to an officer, Esther Huang (Treasurer)." */
  route: string;
  /** The evidence: when PayPal recorded it (or how late it reported it), and whether the bank covered it. */
  facts: string;
  /** The whole sentence, as a screen reader and the tests read it. */
  sentence: string;
}

const VERBS: Record<FindingKind, string> = {
  outside_debit: "left the club account outside TwoKey",
  unsigned_payout: "left the club account without two valid signatures",
};

/** "Sent from PayPal's website" -> "sent from PayPal's website"; leaves "ACH …" alone. */
function midSentence(label: string): string {
  const text = label.trim().replace(/\.$/, "");
  return /^[A-Z][a-z]/.test(text) ? text[0]!.toLowerCase() + text.slice(1) : text;
}

/**
 * "$3.21 left the club account outside TwoKey: sent from PayPal's website to an officer, Esther
 * Huang (Treasurer). PayPal recorded it on Nov 3, 2:27 PM CST. The linked bank covered it, so the
 * balance didn't move."
 */
export function findingText(finding: WatchFinding): FindingText {
  const amount = formatCents(finding.amountCents);
  const verb = VERBS[finding.kind] ?? VERBS.outside_debit;
  const when = formatAsOf(finding.at);
  const known = finding.reportedAfterMinutes !== null && Number.isFinite(finding.reportedAfterMinutes);

  let route = midSentence(finding.label);
  if (finding.counterparty) route += finding.counterpartyIsOfficer ? ` to an officer, ${finding.counterparty}` : ` to ${finding.counterparty}`;

  const [first, ...facts] = known
    ? [`${route}${finding.counterpartyIsOfficer && finding.counterparty ? "," : ""} on ${when}.`, `PayPal reported it ${formatDelay(finding.reportedAfterMinutes!)} later.`]
    : [`${route}.`, `PayPal recorded it on ${when}.`];
  if (finding.fundedByBank) facts.push("The linked bank covered it, so the balance didn't move.");

  const rest = facts.join(" ");
  return { amount, verb, route: first!, facts: rest, sentence: `${amount} ${verb}: ${first} ${rest}`.trim() };
}

const TOGETHER = /(?:[A-Z][a-z]{2} \d{1,2}, )?\d{1,2}:\d{2} [AP]M(?: [A-Z]{2,4})?|\d+ h \d+ min|\d+ (?:h|min)\b/g;

/** "Nov 3, 2:27 PM CST" and "1 h 52 min" never break across lines (non-breaking spaces inside). */
export const keepTimesTogether = (text: string) => text.replace(TOGETHER, (phrase) => phrase.replace(/ /g, " "));

export const findingSentence = (finding: WatchFinding) => findingText(finding).sentence;

// --- Order ---------------------------------------------------------------------------------------

const time = (iso: string) => {
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? -Infinity : ms;
};

/** Newest first by when the money moved; the server already sends them so, this keeps it so. */
export function newestFirst(findings: readonly WatchFinding[]): WatchFinding[] {
  return findings
    .map((finding, index) => ({ finding, index }))
    .sort((a, b) => time(b.finding.at) - time(a.finding.at) || a.index - b.index)
    .map(({ finding }) => finding);
}

export interface WatchAlerts {
  /** Lost access or silence, as an alert of its own; null otherwise. */
  statusAlert: StatusAlert | null;
  /** Open findings, newest first. The board shows the first and counts the rest. */
  open: WatchFinding[];
  /** Explained findings, newest first: collapsed under "Explained (N)", never hidden. */
  explained: WatchFinding[];
}

export function watchAlerts(view: WatchtowerView | null | undefined, now: Date = new Date()): WatchAlerts {
  if (!view) return { statusAlert: null, open: [], explained: [] };
  return {
    statusAlert: statusAlert(view, now),
    open: newestFirst(view.findings ?? []),
    explained: newestFirst(view.explained ?? []),
  };
}

/** "1 more", "3 more". */
export const moreLabel = (hidden: number) => `${hidden} more`;
/** "Explained (3)". */
export const explainedLabel = (count: number) => `Explained (${count})`;
