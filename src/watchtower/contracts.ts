/**
 * The Watchtower's fixed contract (spec: docs/twokey-concept.md §5.4 and §10; plan:
 * .plans/watchtower-spec.md). Types and constants only. Change this file only through the design
 * lead: the backend and the judge UI are built against it at the same time.
 *
 * One global Watchtower polls the one shared PayPal sandbox account every 10 minutes (a Cron
 * Trigger), reads Transaction Search, and flags every debit TwoKey's two-key flow didn't make. It
 * never detects from balance changes: a measured outside send came with a same-time bank-funding
 * row, so the balance never moved. Findings are global (real for every judge session).
 */

/** Money left through a route TwoKey doesn't control, or a payout without two valid signatures. */
export type FindingKind = "outside_debit" | "unsigned_payout";

export interface WatchFinding {
  /** PayPal's transaction id of the debit row: the dedupe key. */
  transactionId: string;
  kind: FindingKind;
  /** PayPal's event code, e.g. "T0000" (website send), "T0400" (withdrawal), "T0001" (payout). */
  eventCode: string;
  /** Plain words for the route: "Sent from PayPal's website", "Withdrawn to a bank", "Payout outside the two-key flow". */
  label: string;
  /** Positive cents that left the account (the row's amount, plus its fee if any). */
  amountCents: number;
  /** Who got it: a known name ("Esther Huang (Treasurer)") or a masked email; null if PayPal names no one. */
  counterparty: string | null;
  /** True when the counterparty is one of the club's officers. */
  counterpartyIsOfficer: boolean;
  /** When PayPal says the money moved (ISO). */
  at: string;
  /** When the Watchtower first saw the row (ISO). */
  firstSeenAt: string;
  /**
   * Minutes from `at` to `firstSeenAt`, an upper bound on PayPal's reporting delay (the poll runs
   * every 10 minutes). Null for rows found by the Watchtower's first run (backfill), whose delay
   * isn't known.
   */
  reportedAfterMinutes: number | null;
  /** True when a same-time funding row (T03xx) shows the linked bank covered it, so the balance didn't move. */
  fundedByBank: boolean;
  /** Set for a finding a person has explained (e.g. a pre-launch test); it stays on the record. */
  explanation: string | null;
}

export type WatchStatus =
  /** Checked recently; PayPal's reports are current. */
  | "ok"
  /** PayPal's newest report is older than STALE_REPORT_HOURS: data may be missing. */
  | "stale_reports"
  /** TwoKey has lost access to the PayPal account (credentials revoked or rotated). */
  | "no_access"
  /** No successful check for SILENT_AFTER_MINUTES: silence is an alert. */
  | "silent"
  /** The Watchtower has never run. */
  | "not_started";

export interface WatchtowerView {
  status: WatchStatus;
  /** The last run that reached PayPal (ISO), or null. */
  checkedAt: string | null;
  /** PayPal's `last_refreshed_datetime` from that run: the "as of" time of everything below. */
  paypalAsOf: string | null;
  /** Open findings (no explanation), newest first. */
  findings: WatchFinding[];
  /** Explained findings, newest first. Shown collapsed, never hidden. */
  explained: WatchFinding[];
}

/** A replay of a recorded real sandbox event through the same classifier (judge mode; nothing stored). */
export interface WatchReplay {
  finding: WatchFinding;
  /** "Replay of a real sandbox event: a $3.21 website send on Nov 3, 2026." */
  label: string;
}

export const WATCH_FROM = "2026-11-01T00:00:00Z";
export const STALE_REPORT_HOURS = 3;
export const SILENT_AFTER_MINUTES = 30;

export const WATCHTOWER_API = {
  /** POST, cron only (Authorization: Bearer TWOKEY_CRON_SECRET) -> 200 { outcome, newFindings } */
  run: "/api/watchtower/run",
  /** POST, judge session + same origin -> 200 WatchReplay */
  replay: "/api/watchtower/replay",
} as const;
