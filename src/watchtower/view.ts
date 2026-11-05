/**
 * The Watchtower as the board reads it (`WatchtowerView`, ./contracts.ts), from the store.
 *
 * Status, most severe first (spec: .plans/watchtower-spec.md "Status"):
 *   no_access      the latest run's token or search call answered 401/403
 *   silent         there are runs, but none succeeded in the last SILENT_AFTER_MINUTES
 *   stale_reports  the latest good run's PayPal "as of" time is older than STALE_REPORT_HOURS
 *                  (or PayPal gave none)
 *   not_started    no runs at all
 *   ok             otherwise
 * `checkedAt` and `paypalAsOf` come from the latest successful run. Findings are split into open
 * and explained (the committed list in ./explanations.ts applies at read time), newest first.
 */
import { SILENT_AFTER_MINUTES, STALE_REPORT_HOURS, type WatchFinding, type WatchStatus, type WatchtowerView } from "./contracts";
import { explanationFor } from "./explanations";
import type { RunRecord, StoredFinding, WatchtowerStore } from "./store";

const ageMs = (iso: string, now: Date): number => now.getTime() - Date.parse(iso);

export function watchStatus(latest: RunRecord | null, latestOk: RunRecord | null, now: Date): WatchStatus {
  if (latest?.outcome === "no_access") return "no_access";
  if (latest && (!latestOk || ageMs(latestOk.finishedAt, now) > SILENT_AFTER_MINUTES * 60_000)) return "silent";
  if (latestOk && (!latestOk.paypalAsOf || !(ageMs(latestOk.paypalAsOf, now) <= STALE_REPORT_HOURS * 3_600_000))) return "stale_reports";
  if (!latest) return "not_started";
  return "ok";
}

function toWatchFinding(stored: StoredFinding): WatchFinding {
  return {
    transactionId: stored.transactionId,
    kind: stored.kind,
    eventCode: stored.eventCode,
    label: stored.label,
    amountCents: stored.amountCents,
    counterparty: stored.counterparty,
    counterpartyIsOfficer: stored.counterpartyIsOfficer,
    at: stored.at,
    firstSeenAt: stored.firstSeenAt,
    reportedAfterMinutes: stored.reportedAfterMinutes,
    fundedByBank: stored.fundedByBank,
    explanation: explanationFor(stored.transactionId, stored.customField) ?? stored.explanation,
  };
}

const newestFirst = (a: WatchFinding, b: WatchFinding): number => b.at.localeCompare(a.at) || b.transactionId.localeCompare(a.transactionId);

export async function readWatchtowerView(store: WatchtowerStore, now: Date): Promise<WatchtowerView> {
  const [latest, latestOk, stored] = await Promise.all([store.latestRun(), store.latestSuccessfulRun(), store.findings()]);
  const all = stored.map(toWatchFinding).sort(newestFirst);
  return {
    status: watchStatus(latest, latestOk, now),
    checkedAt: latestOk?.finishedAt ?? null,
    paypalAsOf: latestOk?.paypalAsOf ?? null,
    findings: all.filter((finding) => finding.explanation === null),
    explained: all.filter((finding) => finding.explanation !== null),
  };
}
