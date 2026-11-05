/**
 * Shared builders for the Watchtower tests: a stored finding and a run record, plus a mocked store.
 * Values follow the measured club account (tests/fixtures/paypal/transaction-search-2026-11-05.json).
 */
import { vi } from "vitest";
import type { RunRecord, StoredFinding, WatchtowerStore } from "@/watchtower/store";

export const storedFinding = (over: Partial<StoredFinding> = {}): StoredFinding => ({
  transactionId: "1TY14748YE721631B",
  kind: "outside_debit",
  eventCode: "T0000",
  label: "Sent from PayPal's website",
  amountCents: 321,
  counterparty: "Esther Huang (Treasurer)",
  counterpartyIsOfficer: true,
  at: "2026-11-03T20:27:29Z",
  firstSeenAt: "2026-11-05T15:00:00.000Z",
  reportedAfterMinutes: null,
  fundedByBank: true,
  explanation: null,
  customField: null,
  backfill: true,
  runId: "run-1",
  ...over,
});

export const runRecord = (over: Partial<RunRecord> = {}): RunRecord => ({
  runId: "run-1",
  startedAt: "2026-11-05T15:00:00.000Z",
  finishedAt: "2026-11-05T15:00:02.000Z",
  outcome: "ok",
  paypalAsOf: "2026-11-05T13:59:59Z",
  rowsSeen: 11,
  newFindings: 4,
  detail: null,
  ...over,
});

/** A mocked store over plain arrays; every method is a spy. */
export function mockStore(initial: { runs?: RunRecord[]; findings?: StoredFinding[] } = {}) {
  const runs = [...(initial.runs ?? [])];
  const findings = [...(initial.findings ?? [])];
  const latest = (list: RunRecord[]) => [...list].sort((a, b) => b.finishedAt.localeCompare(a.finishedAt))[0] ?? null;
  const store = {
    hasSuccessfulRun: vi.fn<WatchtowerStore["hasSuccessfulRun"]>(async () => runs.some((r) => r.outcome === "ok")),
    findingIds: vi.fn<WatchtowerStore["findingIds"]>(async () => new Set(findings.map((f) => f.transactionId))),
    insertFinding: vi.fn<WatchtowerStore["insertFinding"]>(async (finding) => {
      if (findings.some((f) => f.transactionId === finding.transactionId)) return false;
      findings.push(finding);
      return true;
    }),
    appendRun: vi.fn<WatchtowerStore["appendRun"]>(async (run) => {
      runs.push(run);
    }),
    latestRun: vi.fn<WatchtowerStore["latestRun"]>(async () => latest(runs)),
    latestSuccessfulRun: vi.fn<WatchtowerStore["latestSuccessfulRun"]>(async () => latest(runs.filter((r) => r.outcome === "ok"))),
    findings: vi.fn<WatchtowerStore["findings"]>(async () => [...findings].sort((a, b) => b.at.localeCompare(a.at))),
  } satisfies WatchtowerStore;
  return { store, runs, findings };
}
