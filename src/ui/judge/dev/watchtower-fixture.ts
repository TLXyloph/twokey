/**
 * DEV ONLY. The Watchtower as the board view will carry it (src/watchtower/contracts.ts), built from
 * the measured Transaction Search rows in tests/fixtures/paypal/transaction-search-2026-11-05.json
 * and the explanations in .plans/watchtower-spec.md. Reached through `/demo?fixture=1&watch=…` in a
 * development build only (see ../board-view-source.ts); tests/fixtures/watchtower-view.ts re-exports it.
 *
 * Measured: both open findings (the two $3.21 website sends of Nov 3, each with a same-time T0300
 * bank-funding row) and both setup-test payouts ($1 + $0.25 fee, T0001). PayPal's reports stalled at
 * 2026-11-05T08:59:59Z, so `stale` is the realistic state today and the default.
 *
 * Assumed (marked below): the Watchtower's run times, and the local test payout's time and receiver,
 * which PayPal hadn't reported when this was written. It shows only in the `ok` state.
 */
import type { WatchFinding, WatchReplay, WatchtowerView } from "@/watchtower/contracts";

export const WATCH_FIXTURE_STATES = ["stale", "ok", "no_access", "silent", "not_started", "none"] as const;
export type WatchFixtureState = (typeof WATCH_FIXTURE_STATES)[number];
export const DEFAULT_WATCH_FIXTURE: WatchFixtureState = "stale";

export const isWatchFixtureState = (value: unknown): value is WatchFixtureState =>
  typeof value === "string" && (WATCH_FIXTURE_STATES as readonly string[]).includes(value);

/** PayPal's `last_refreshed_datetime` in the measured search: the stall. */
export const STALLED_AS_OF = "2026-11-05T08:59:59Z";

/** Assumed: the Watchtower's first run, which found every row below (so no delay is known). */
const FIRST_RUN = "2026-11-05T16:10:00Z";

/** Test B: the treasurer sent herself $3.21 from PayPal's website (T0000 + its T0300). */
export const TREASURER_SEND: WatchFinding = {
  transactionId: "1TY14748YE721631B",
  kind: "outside_debit",
  eventCode: "T0000",
  label: "Sent from PayPal's website",
  amountCents: 321,
  counterparty: "Esther Huang (Treasurer)",
  counterpartyIsOfficer: true,
  at: "2026-11-03T20:27:29Z",
  firstSeenAt: FIRST_RUN,
  reportedAfterMinutes: null,
  fundedByBank: true,
  explanation: null,
};

/** The first outside send, to a personal sandbox account outside the club (masked). */
export const STRANGER_SEND: WatchFinding = {
  transactionId: "22N17109956532336",
  kind: "outside_debit",
  eventCode: "T0000",
  label: "Sent from PayPal's website",
  amountCents: 321,
  counterparty: "sb-wdq…@personal.example.com",
  counterpartyIsOfficer: false,
  at: "2026-11-03T04:13:48Z",
  firstSeenAt: FIRST_RUN,
  reportedAfterMinutes: null,
  fundedByBank: true,
  explanation: null,
};

const SETUP_TEST =
  "TwoKey's setup test, Nov 2–3: a $1 payout sent by a developer script with the app's own credentials, before the two-key flow existed.";

const setupPayout = (transactionId: string, at: string): WatchFinding => ({
  transactionId,
  kind: "unsigned_payout",
  eventCode: "T0001",
  label: "Payout outside the two-key flow",
  amountCents: 125,
  counterparty: "PayPal's payout simulator",
  counterpartyIsOfficer: false,
  at,
  firstSeenAt: FIRST_RUN,
  reportedAfterMinutes: null,
  fundedByBank: false,
  explanation: SETUP_TEST,
});

export const SETUP_PAYOUTS: WatchFinding[] = [setupPayout("23Y96953CP0068646", "2026-11-03T19:59:18Z"), setupPayout("3XT37311AK7894010", "2026-11-02T23:32:17Z")];

/** Assumed time and receiver: the local two-key test of Nov 5, once PayPal reports it. */
export const LOCAL_TEST_PAYOUT: WatchFinding = {
  transactionId: "9K2669282J012372J",
  kind: "unsigned_payout",
  eventCode: "T0001",
  label: "Payout outside the two-key flow",
  amountCents: 125,
  counterparty: "Riverbend Team Supply",
  counterpartyIsOfficer: false,
  at: "2026-11-05T13:05:00Z",
  firstSeenAt: "2026-11-05T15:00:00Z",
  reportedAfterMinutes: 115,
  fundedByBank: false,
  explanation: "TwoKey's local test, Nov 5: signed by two demo keys on a developer's machine, so it isn't in the hosted ledger.",
};

const minutes = (n: number) => n * 60_000;
/** The last 10-minute tick at or before `now`: when the cron would have run. */
const lastTick = (now: Date) => new Date(Math.floor(now.getTime() / minutes(10)) * minutes(10));
/** PayPal's snapshots land on the half hour; a fresh one is about an hour old. */
const freshAsOf = (checkedAt: Date) => new Date(Math.floor((checkedAt.getTime() - minutes(30)) / minutes(30)) * minutes(30) - 1_000);

/** The Watchtower in each state the board draws. A new object every call. */
export function fixtureWatchtower(state: WatchFixtureState = DEFAULT_WATCH_FIXTURE, now: Date = new Date()): WatchtowerView | null {
  const tick = lastTick(now);
  const findings = [TREASURER_SEND, STRANGER_SEND];
  const base = { findings, explained: SETUP_PAYOUTS, paypalAsOf: STALLED_AS_OF };
  const iso = (date: Date) => date.toISOString().replace(/\.000Z$/, "Z");
  const view = ((): WatchtowerView | null => {
    switch (state) {
      case "none":
        return null;
      case "not_started":
        return { status: "not_started", checkedAt: null, paypalAsOf: null, findings: [], explained: [] };
      case "ok":
        return { ...base, status: "ok", checkedAt: iso(tick), paypalAsOf: iso(freshAsOf(tick)), explained: [LOCAL_TEST_PAYOUT, ...SETUP_PAYOUTS] };
      case "stale":
        return { ...base, status: "stale_reports", checkedAt: iso(tick) };
      case "no_access":
        // The last run that reached PayPal was 40 minutes ago; every run since got a 401.
        return { ...base, status: "no_access", checkedAt: iso(new Date(tick.getTime() - minutes(40))) };
      case "silent":
        // No successful run for 70 minutes (SILENT_AFTER_MINUTES is 30).
        return { ...base, status: "silent", checkedAt: iso(new Date(tick.getTime() - minutes(70))) };
    }
  })();
  return view === null ? null : structuredClone(view);
}

/** What POST /api/watchtower/replay answers: Test B through the classifier again, labelled. Nothing stored. */
export function fixtureReplay(now: Date = new Date()): WatchReplay {
  return {
    finding: { ...TREASURER_SEND, firstSeenAt: now.toISOString() },
    label: "Replay of a real sandbox event: a $3.21 website send on Nov 3, 2026.",
  };
}
