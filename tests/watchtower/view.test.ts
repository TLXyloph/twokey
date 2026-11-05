import { describe, expect, it } from "vitest";
import { SILENT_AFTER_MINUTES, STALE_REPORT_HOURS, type WatchFinding } from "@/watchtower/contracts";
import { readWatchtowerView, watchStatus } from "@/watchtower/view";
import { mockStore, runRecord, storedFinding } from "./fixtures";

const NOW = new Date("2026-11-05T15:20:00.000Z");
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000).toISOString();
const ok = (finishedMinutesAgo: number, asOfMinutesAgo: number | null = 60) =>
  runRecord({ runId: `ok-${finishedMinutesAgo}`, finishedAt: minutesAgo(finishedMinutesAgo), paypalAsOf: asOfMinutesAgo === null ? null : minutesAgo(asOfMinutesAgo) });
const failed = (outcome: "no_access" | "paypal_error", finishedMinutesAgo: number) =>
  runRecord({ runId: `${outcome}-${finishedMinutesAgo}`, outcome, finishedAt: minutesAgo(finishedMinutesAgo), paypalAsOf: null, detail: "x" });

describe("watchStatus (most severe first)", () => {
  it("is not_started with no runs at all", () => {
    expect(watchStatus(null, null, NOW)).toBe("not_started");
  });

  it("is ok after a recent successful run with current reports", () => {
    expect(watchStatus(ok(5), ok(5), NOW)).toBe("ok");
  });

  it("is no_access when the latest run was refused (401/403), even right after a good run", () => {
    expect(watchStatus(failed("no_access", 1), ok(11), NOW)).toBe("no_access");
    expect(watchStatus(failed("no_access", 1), null, NOW)).toBe("no_access");
  });

  it(`is silent when no run has succeeded for more than ${SILENT_AFTER_MINUTES} minutes`, () => {
    expect(watchStatus(ok(SILENT_AFTER_MINUTES), ok(SILENT_AFTER_MINUTES), NOW)).toBe("ok");
    expect(watchStatus(ok(SILENT_AFTER_MINUTES + 1), ok(SILENT_AFTER_MINUTES + 1), NOW)).toBe("silent");
    expect(watchStatus(failed("paypal_error", 2), ok(45), NOW)).toBe("silent");
    expect(watchStatus(failed("paypal_error", 2), null, NOW)).toBe("silent");
  });

  it(`is stale_reports when PayPal's records are more than ${STALE_REPORT_HOURS} hours old`, () => {
    const limit = STALE_REPORT_HOURS * 60;
    expect(watchStatus(ok(5, limit), ok(5, limit), NOW)).toBe("ok");
    expect(watchStatus(ok(5, limit + 1), ok(5, limit + 1), NOW)).toBe("stale_reports");
    expect(watchStatus(ok(5, null), ok(5, null), NOW)).toBe("stale_reports");
    expect(watchStatus(failed("paypal_error", 2), ok(12, limit + 60), NOW)).toBe("stale_reports");
  });

  it("puts silence before stale reports", () => {
    expect(watchStatus(ok(40, 400), ok(40, 400), NOW)).toBe("silent");
  });
});

describe("readWatchtowerView", () => {
  const findings = [
    storedFinding({ transactionId: "3XT37311AK7894010", kind: "unsigned_payout", eventCode: "T0001", label: "Payout outside the two-key flow", amountCents: 125, counterparty: "PayPal's payout simulator", counterpartyIsOfficer: false, at: "2026-11-02T23:32:17Z", fundedByBank: false, customField: "item-1", explanation: null }),
    storedFinding({ transactionId: "22N17109956532336", counterparty: "sb-wdq…@personal.example.com", counterpartyIsOfficer: false, at: "2026-11-03T04:13:48Z" }),
    storedFinding({ transactionId: "LOCAL-TEST", kind: "unsigned_payout", eventCode: "T0001", at: "2026-11-05T14:00:00Z", customField: "eedb2122-9cd6-4fa4-8ef0-8ca52e4eab15", backfill: false, reportedAfterMinutes: 80 }),
    storedFinding({ transactionId: "1TY14748YE721631B" }),
    storedFinding({ transactionId: "NOTED", at: "2026-11-04T00:00:00Z", explanation: "Explained when it was stored." }),
  ];

  it("splits open and explained findings, newest first, and reads the status and PayPal's as-of time from the latest good run", async () => {
    const state = mockStore({ runs: [ok(4, 90)], findings });
    const view = await readWatchtowerView(state.store, NOW);
    expect(view.status).toBe("ok");
    expect(view.checkedAt).toBe(minutesAgo(4));
    expect(view.paypalAsOf).toBe(minutesAgo(90));
    expect(view.findings.map((f) => f.transactionId)).toEqual(["1TY14748YE721631B", "22N17109956532336"]);
    expect(view.explained.map((f) => [f.transactionId, f.explanation?.slice(0, 22)])).toEqual([
      ["LOCAL-TEST", "TwoKey's local test, N"],
      ["NOTED", "Explained when it was "],
      ["3XT37311AK7894010", "TwoKey's setup test, N"],
    ]);
  });

  it("answers exactly the contract's WatchFinding fields (no storage details)", async () => {
    const view = await readWatchtowerView(mockStore({ runs: [ok(4)], findings }).store, NOW);
    const expected: WatchFinding = {
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
    };
    expect(view.findings[0]).toEqual(expected);
  });

  it("is not_started and empty before the first run", async () => {
    expect(await readWatchtowerView(mockStore().store, NOW)).toEqual({ status: "not_started", checkedAt: null, paypalAsOf: null, findings: [], explained: [] });
  });

  it("keeps showing the last good run's time when the latest run failed", async () => {
    const view = await readWatchtowerView(mockStore({ runs: [ok(14, 100), failed("no_access", 4)] }).store, NOW);
    expect(view).toMatchObject({ status: "no_access", checkedAt: minutesAgo(14), paypalAsOf: minutesAgo(100) });
  });
});
