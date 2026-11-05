/**
 * The Watchtower's storage port: its runs and its findings, both append-only (migration 0004).
 * Implemented on D1 in ./d1-store.ts; tests of the run and the view mock it.
 */
import type { WatchFinding } from "./contracts";

export type RunOutcome = "ok" | "no_access" | "paypal_error";

export interface RunRecord {
  runId: string;
  startedAt: string;
  finishedAt: string;
  outcome: RunOutcome;
  /** PayPal's `last_refreshed_datetime`; null when PayPal wasn't read. */
  paypalAsOf: string | null;
  rowsSeen: number;
  newFindings: number;
  /** A fixed code ("search_http_500", "unreadable_rows"), never a response body. */
  detail: string | null;
}

export interface StoredFinding extends WatchFinding {
  /** The payout's `custom_field` (our sender_item_id), which explanations may key on. */
  customField: string | null;
  /** Found by the first successful run: the reporting delay isn't known. */
  backfill: boolean;
  runId: string;
}

export interface WatchtowerStore {
  /** True once any run has reached PayPal and judged its rows. */
  hasSuccessfulRun(): Promise<boolean>;
  /** The transaction ids already flagged. */
  findingIds(): Promise<Set<string>>;
  /** Inserts unless the transaction id is already flagged; true when it stored a new row. */
  insertFinding(finding: StoredFinding): Promise<boolean>;
  appendRun(run: RunRecord): Promise<void>;
  latestRun(): Promise<RunRecord | null>;
  latestSuccessfulRun(): Promise<RunRecord | null>;
  /** Newest first (by when the money moved), at most a few hundred. */
  findings(): Promise<StoredFinding[]>;
}
