/**
 * Watchtower fixtures for the judge UI's tests: the dev fixture's measured rows and states
 * (src/ui/judge/dev/watchtower-fixture.ts) and small builders for the cases a test needs.
 */
import type { WatchFinding, WatchtowerView } from "@/watchtower/contracts";
import { STRANGER_SEND, TREASURER_SEND } from "@/ui/judge/dev/watchtower-fixture";

export {
  fixtureReplay,
  fixtureWatchtower,
  LOCAL_TEST_PAYOUT,
  SETUP_PAYOUTS,
  STALLED_AS_OF,
  STRANGER_SEND,
  TREASURER_SEND,
  WATCH_FIXTURE_STATES,
} from "@/ui/judge/dev/watchtower-fixture";

/** 10:25 AM CST on Nov 5, 2026: a few minutes after the Watchtower's 10:20 check. */
export const NOW = new Date("2026-11-05T16:25:00Z");

export function finding(overrides: Partial<WatchFinding> = {}): WatchFinding {
  return { ...TREASURER_SEND, ...overrides };
}

/** PayPal's reports stalled at 2:59 AM CST; the Watchtower checked at 10:20 AM CST. */
export function watchtowerView(overrides: Partial<WatchtowerView> = {}): WatchtowerView {
  return {
    status: "stale_reports",
    checkedAt: "2026-11-05T16:20:00Z",
    paypalAsOf: "2026-11-05T08:59:59Z",
    findings: [TREASURER_SEND, STRANGER_SEND],
    explained: [],
    ...overrides,
  };
}
