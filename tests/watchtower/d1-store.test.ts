import { describe, expect, it } from "vitest";
import { createD1WatchtowerStore, MAX_FINDINGS_READ } from "@/watchtower/d1-store";
import type { RunRecord } from "@/watchtower/store";
import { sqlite, sqliteD1 } from "../agents/llm/sqlite-d1";
import { runRecord, storedFinding } from "./fixtures";

const run = sqlite ? describe : describe.skip;

run("D1 Watchtower store (real SQLite, real migrations)", () => {
  it("stores a finding once per transaction id (insert-or-ignore) and reads it back exactly", async () => {
    const store = createD1WatchtowerStore(sqliteD1().db);
    expect(await store.insertFinding(storedFinding())).toBe(true);
    expect(await store.insertFinding(storedFinding({ amountCents: 999, runId: "run-2" }))).toBe(false);
    expect(await store.findings()).toEqual([storedFinding()]);
    expect(await store.findingIds()).toEqual(new Set(["1TY14748YE721631B"]));
  });

  it("reads findings newest first", async () => {
    const store = createD1WatchtowerStore(sqliteD1().db);
    await store.insertFinding(storedFinding({ transactionId: "OLD", at: "2026-11-02T23:32:17Z", kind: "unsigned_payout", customField: "item-1" }));
    await store.insertFinding(storedFinding({ transactionId: "NEW", at: "2026-11-04T09:00:00Z", backfill: false, reportedAfterMinutes: 95 }));
    await store.insertFinding(storedFinding({ transactionId: "MID", at: "2026-11-03T04:13:48Z" }));
    expect((await store.findings()).map((f) => [f.transactionId, f.kind, f.backfill, f.reportedAfterMinutes])).toEqual([
      ["NEW", "outside_debit", false, 95],
      ["MID", "outside_debit", true, null],
      ["OLD", "unsigned_payout", true, null],
    ]);
    expect(MAX_FINDINGS_READ).toBeGreaterThanOrEqual(100);
  });

  it("appends runs and finds the latest run and the latest successful one", async () => {
    const store = createD1WatchtowerStore(sqliteD1().db);
    expect(await store.latestRun()).toBeNull();
    expect(await store.latestSuccessfulRun()).toBeNull();
    expect(await store.hasSuccessfulRun()).toBe(false);
    await store.appendRun(runRecord({ runId: "r0", outcome: "paypal_error", paypalAsOf: null, rowsSeen: 0, newFindings: 0, detail: "search_http_500", finishedAt: "2026-11-05T14:50:01.000Z" }));
    expect(await store.hasSuccessfulRun()).toBe(false);
    await store.appendRun(runRecord({ runId: "r1" }));
    await store.appendRun(runRecord({ runId: "r2", outcome: "no_access", paypalAsOf: null, rowsSeen: 0, newFindings: 0, detail: "token_http_401", finishedAt: "2026-11-05T15:10:01.000Z" }));
    expect(await store.hasSuccessfulRun()).toBe(true);
    expect(await store.latestRun()).toMatchObject({ runId: "r2", outcome: "no_access", detail: "token_http_401", paypalAsOf: null });
    expect(await store.latestSuccessfulRun()).toEqual(runRecord({ runId: "r1" }));
  });

  it("is append-only: every UPDATE and DELETE is refused", async () => {
    const d1 = sqliteD1();
    const store = createD1WatchtowerStore(d1.db);
    await store.insertFinding(storedFinding());
    await store.appendRun(runRecord());
    expect(() => d1.exec("UPDATE watchtower_findings SET explanation = 'hidden'")).toThrow(/append-only/);
    expect(() => d1.exec("DELETE FROM watchtower_findings")).toThrow(/append-only/);
    expect(() => d1.exec("UPDATE watchtower_runs SET outcome = 'ok'")).toThrow(/append-only/);
    expect(() => d1.exec("DELETE FROM watchtower_runs")).toThrow(/append-only/);
  });

  it("refuses a backfilled finding that claims a known delay, and an unknown run outcome", async () => {
    const d1 = sqliteD1();
    const store = createD1WatchtowerStore(d1.db);
    await expect(store.insertFinding(storedFinding({ backfill: true, reportedAfterMinutes: 5 }))).rejects.toThrow(/CHECK constraint/);
    await expect(store.appendRun(runRecord({ outcome: "fine" as RunRecord["outcome"] }))).rejects.toThrow(/CHECK constraint/);
  });
});
