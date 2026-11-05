import { describe, expect, it, vi } from "vitest";
import { parseSearchPage, TransactionSearchError, type TransactionRow, type TransactionSearchResult } from "@/payments/paypal/transactions";
import type { JudgedDebit } from "@/watchtower/classify";
import { runWatchtower, type RunDeps } from "@/watchtower/run";
import type { TraceResult } from "@/watchtower/trace";
import measured from "../fixtures/paypal/transaction-search-2026-11-05.json";
import { mockStore, runRecord } from "./fixtures";

const fixture = parseSearchPage(measured)!;
const T_RUN = Date.parse("2026-11-05T15:00:00.000Z");
const SETUP_NOTE =
  "TwoKey's setup test, Nov 2–3: a $1 payout sent by a developer script with the app's own credentials, before the two-key flow existed.";

const fixtureResult = (extra: TransactionRow[] = [], over: Partial<TransactionSearchResult> = {}): TransactionSearchResult => ({
  rows: [...fixture.rows, ...extra],
  lastRefreshed: fixture.lastRefreshed,
  unreadable: 0,
  ...over,
});

function setup({ store: state, ...over }: Partial<Omit<RunDeps, "store">> & { store?: ReturnType<typeof mockStore> } = {}) {
  const store = state ?? mockStore();
  let tick = 0;
  let id = 0;
  const lines: string[] = [];
  const deps: RunDeps = {
    search: vi.fn(async () => fixtureResult()),
    store: store.store,
    trace: vi.fn<(debit: JudgedDebit) => Promise<TraceResult>>(async () => ({ kind: "untraced", reason: "no_ledger_payout" })),
    now: () => new Date(T_RUN + 1000 * tick++),
    newId: () => `run-${++id}-0000-0000`,
    log: (line) => lines.push(line),
    ...over,
  };
  return { deps, store, lines };
}

const outsideSend = (id: string, at: string): TransactionRow => ({
  transactionId: id,
  eventCode: "T0000",
  amountCents: -1500,
  feeCents: 0,
  currency: "USD",
  initiatedAt: at,
  status: "S",
  referenceId: null,
  customField: null,
  counterpartyEmail: "stranger-fictional@example.test",
});

describe("runWatchtower: the first run on the measured account", () => {
  it("flags the two website sends and the two untraceable setup payouts, as backfill, and records the run", async () => {
    const { deps, store, lines } = setup();
    expect(await runWatchtower(deps)).toEqual({ runId: "run-1-0000-0000", outcome: "ok", rowsSeen: 11, newFindings: 4, detail: null });
    expect(store.findings.map((f) => [f.transactionId, f.kind, f.label, f.amountCents, f.backfill, f.reportedAfterMinutes, f.explanation])).toEqual([
      ["3XT37311AK7894010", "unsigned_payout", "Payout outside the two-key flow", 125, true, null, SETUP_NOTE],
      ["22N17109956532336", "outside_debit", "Sent from PayPal's website", 321, true, null, null],
      ["23Y96953CP0068646", "unsigned_payout", "Payout outside the two-key flow", 125, true, null, SETUP_NOTE],
      ["1TY14748YE721631B", "outside_debit", "Sent from PayPal's website", 321, true, null, null],
    ]);
    expect(store.findings.find((f) => f.transactionId === "3XT37311AK7894010")).toMatchObject({ customField: "item-1", runId: "run-1-0000-0000" });
    expect(deps.trace).toHaveBeenCalledTimes(2);
    expect(store.runs).toEqual([
      runRecord({ runId: "run-1-0000-0000", startedAt: "2026-11-05T15:00:00.000Z", finishedAt: "2026-11-05T15:00:02.000Z", paypalAsOf: "2026-11-05T08:59:59Z", rowsSeen: 11, newFindings: 4 }),
    ]);
    expect(lines).toEqual(["[watchtower/run] outcome=ok run=run-1-00 rows=11 debits=4 matched=0 new=4 asof=2026-11-05T08:59:59Z"]);
  });

  it("stamps every finding with the time PayPal was read", async () => {
    const { deps, store } = setup();
    await runWatchtower(deps);
    expect(new Set(store.findings.map((f) => f.firstSeenAt))).toEqual(new Set(["2026-11-05T15:00:01.000Z"]));
  });
});

describe("runWatchtower: later runs", () => {
  it("is idempotent: the same rows again store nothing new and aren't traced again", async () => {
    const state = mockStore();
    await runWatchtower(setup({ store: state }).deps);
    const second = setup({ store: state });
    expect(await runWatchtower(second.deps)).toMatchObject({ outcome: "ok", newFindings: 0 });
    expect(second.deps.trace).not.toHaveBeenCalled();
    expect(state.findings).toHaveLength(4);
    expect(state.runs).toHaveLength(2);
  });

  it("gives a new row the reporting delay as an upper bound, not backfill", async () => {
    const state = mockStore({ runs: [runRecord()] });
    const { deps } = setup({ store: state, search: vi.fn(async () => fixtureResult([outsideSend("NEW-SEND", "2026-11-05T13:15:00Z")])) });
    await runWatchtower(deps);
    expect(state.findings.find((f) => f.transactionId === "NEW-SEND")).toMatchObject({
      backfill: false,
      reportedAfterMinutes: 105,
      counterparty: "strang…@example.test",
      amountCents: 1500,
    });
  });

  it("stores nothing for a payout that traces to two valid signatures", async () => {
    const { deps, store, lines } = setup({ trace: vi.fn(async () => ({ kind: "matched", via: "webhook", sessionId: "s", requestId: "L14" }) as const) });
    expect(await runWatchtower(deps)).toMatchObject({ newFindings: 2 });
    expect(store.findings.map((f) => f.kind)).toEqual(["outside_debit", "outside_debit"]);
    expect(lines[0]).toContain("matched=2");
  });

  it("labels a traced payout without two valid signatures as such", async () => {
    const { deps, store } = setup({ trace: vi.fn(async () => ({ kind: "unsigned", via: "webhook", reason: "signatures" }) as const) });
    await runWatchtower(deps);
    expect(store.findings.filter((f) => f.kind === "unsigned_payout").map((f) => f.label)).toEqual([
      "Payout without two valid signatures",
      "Payout without two valid signatures",
    ]);
  });

  it("is safe to run twice at once: each finding is stored once", async () => {
    const state = mockStore();
    const results = await Promise.all([runWatchtower(setup({ store: state }).deps), runWatchtower(setup({ store: state }).deps)]);
    expect(state.findings).toHaveLength(4);
    expect(results.reduce((sum, r) => sum + r.newFindings, 0)).toBe(4);
  });

  it("records rows it couldn't read with a fixed detail code", async () => {
    const { deps, store, lines } = setup({ search: vi.fn(async () => fixtureResult([], { unreadable: 2 })) });
    expect(await runWatchtower(deps)).toMatchObject({ outcome: "ok", detail: "unreadable_rows" });
    expect(store.runs[0]!.detail).toBe("unreadable_rows");
    expect(lines[0]).toContain("detail=unreadable_rows");
  });
});

describe("runWatchtower: when PayPal can't be read", () => {
  it("records lost access (401/403) as a run, with nothing judged", async () => {
    const { deps, store, lines } = setup({ search: vi.fn(async () => Promise.reject(new TransactionSearchError("no_access", 401, "token_http_401"))) });
    expect(await runWatchtower(deps)).toEqual({ runId: "run-1-0000-0000", outcome: "no_access", rowsSeen: 0, newFindings: 0, detail: "token_http_401" });
    expect(store.runs).toEqual([
      runRecord({ runId: "run-1-0000-0000", startedAt: "2026-11-05T15:00:00.000Z", finishedAt: "2026-11-05T15:00:01.000Z", outcome: "no_access", paypalAsOf: null, rowsSeen: 0, newFindings: 0, detail: "token_http_401" }),
    ]);
    expect(store.store.insertFinding).not.toHaveBeenCalled();
    expect(lines).toEqual(["[watchtower/run] outcome=no_access run=run-1-00 rows=0 debits=0 matched=0 new=0 detail=token_http_401"]);
  });

  it("records any other failure as a PayPal error", async () => {
    const { deps, store } = setup({ search: vi.fn(async () => Promise.reject(new TransactionSearchError("paypal_error", 503, "search_http_503"))) });
    expect(await runWatchtower(deps)).toMatchObject({ outcome: "paypal_error", detail: "search_http_503" });
    expect(store.runs[0]).toMatchObject({ outcome: "paypal_error", detail: "search_http_503" });
  });

  it("records PayPal credentials missing on the server as lost access", async () => {
    const { deps, store } = setup({ search: undefined });
    expect(await runWatchtower(deps)).toMatchObject({ outcome: "no_access", detail: "paypal_unconfigured" });
    expect(store.runs[0]).toMatchObject({ outcome: "no_access", detail: "paypal_unconfigured" });
  });

  it("lets a storage failure through without recording a run (the silence is the alert)", async () => {
    const state = mockStore();
    state.store.insertFinding.mockRejectedValueOnce(new Error("D1 down"));
    await expect(runWatchtower(setup({ store: state }).deps)).rejects.toThrow("D1 down");
    expect(state.runs).toEqual([]);
  });

  it("never logs an email or a response body", async () => {
    const { deps, lines } = setup({ search: vi.fn(async () => fixtureResult([outsideSend("X", "2026-11-05T13:15:00Z")])) });
    await runWatchtower(deps);
    expect(lines.join("\n")).not.toMatch(/@|example|paypal\.com/);
  });
});
