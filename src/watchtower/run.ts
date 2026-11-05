/**
 * One Watchtower run (spec: .plans/watchtower-spec.md): read PayPal's Transaction Search, classify
 * every row (./classify.ts), trace each T0001 payout (./trace.ts), store each new finding
 * (insert-or-ignore on the transaction id), then append the run's record.
 *
 * Idempotent, and safe to run twice at once: a finding already stored is neither traced nor
 * stored again. A row is `backfill` when no run before this one succeeded: the Watchtower can't
 * know how late PayPal reported it.
 *
 * PayPal failing is an outcome, recorded as a run: `no_access` (401/403, or no credentials on the
 * server) or `paypal_error`. A storage failure is thrown, and no run is recorded: the board then
 * shows the Watchtower as silent, because silence is an alert.
 *
 * One log line per run, with counts and fixed codes only: never an email, a token or a body.
 */
import { TransactionSearchError, type TransactionSearchResult } from "@/payments/paypal/transactions";
import { classifyRows, findingFrom, PAYOUT_LABELS, type JudgedDebit } from "./classify";
import { explanationFor } from "./explanations";
import type { RunOutcome, StoredFinding, WatchtowerStore } from "./store";
import type { TraceResult } from "./trace";

export interface RunDeps {
  /** Transaction Search from WATCH_FROM to `now`; throws `TransactionSearchError`. Undefined when PayPal isn't configured. */
  search: ((now: Date) => Promise<TransactionSearchResult>) | undefined;
  store: WatchtowerStore;
  /** Traces a T0001 payout to the two-key flow. */
  trace(debit: JudgedDebit): Promise<TraceResult>;
  now(): Date;
  newId(): string;
  log(line: string): void;
}

export interface RunSummary {
  runId: string;
  outcome: RunOutcome;
  rowsSeen: number;
  newFindings: number;
  detail: string | null;
}

interface Counts {
  rows: number;
  debits: number;
  matched: number;
  newFindings: number;
}

/** The finding a debit makes, or null when it is a payout the two-key flow made. */
async function judge(deps: RunDeps, debit: JudgedDebit): Promise<{ kind: StoredFinding["kind"]; label: string } | null> {
  if (debit.route === "outside_debit") return { kind: "outside_debit", label: debit.label };
  const traced = await deps.trace(debit);
  if (traced.kind === "matched") return null;
  return { kind: "unsigned_payout", label: traced.kind === "unsigned" ? PAYOUT_LABELS.unsigned : PAYOUT_LABELS.untraced };
}

export async function runWatchtower(deps: RunDeps): Promise<RunSummary> {
  const started = deps.now();
  const runId = deps.newId();
  const counts: Counts = { rows: 0, debits: 0, matched: 0, newFindings: 0 };

  const finish = async (outcome: RunOutcome, paypalAsOf: string | null, detail: string | null): Promise<RunSummary> => {
    await deps.store.appendRun({
      runId,
      startedAt: started.toISOString(),
      finishedAt: deps.now().toISOString(),
      outcome,
      paypalAsOf,
      rowsSeen: counts.rows,
      newFindings: counts.newFindings,
      detail,
    });
    const parts = [
      `[watchtower/run] outcome=${outcome}`,
      `run=${runId.slice(0, 8)}`,
      `rows=${counts.rows}`,
      `debits=${counts.debits}`,
      `matched=${counts.matched}`,
      `new=${counts.newFindings}`,
    ];
    if (paypalAsOf) parts.push(`asof=${paypalAsOf}`);
    if (detail) parts.push(`detail=${detail}`);
    deps.log(parts.join(" "));
    return { runId, outcome, rowsSeen: counts.rows, newFindings: counts.newFindings, detail };
  };

  if (!deps.search) return finish("no_access", null, "paypal_unconfigured");
  let result: TransactionSearchResult;
  try {
    result = await deps.search(started);
  } catch (error) {
    if (error instanceof TransactionSearchError) return finish(error.kind, null, error.code);
    throw error;
  }
  const firstSeenAt = deps.now().toISOString();
  const { debits, lastRefreshed } = classifyRows(result.rows, result.lastRefreshed);
  counts.rows = result.rows.length;
  counts.debits = debits.length;

  const [known, hadSuccess] = await Promise.all([deps.store.findingIds(), deps.store.hasSuccessfulRun()]);
  for (const debit of debits) {
    if (known.has(debit.transactionId)) continue;
    const verdict = await judge(deps, debit);
    if (!verdict) {
      counts.matched += 1;
      continue;
    }
    const finding = findingFrom(debit, {
      ...verdict,
      firstSeenAt,
      backfill: !hadSuccess,
      explanation: explanationFor(debit.transactionId, debit.customField),
    });
    if (await deps.store.insertFinding({ ...finding, customField: debit.customField, backfill: !hadSuccess, runId })) counts.newFindings += 1;
  }
  return finish("ok", lastRefreshed, result.unreadable > 0 ? "unreadable_rows" : null);
}
