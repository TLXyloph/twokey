/**
 * Board-view fixtures for the judge UI's tests: a fresh judge session (the dev fixture the drawer is
 * built against) and small builders for the states a test needs (sent, refused, flagged, pending).
 */
import type { BoardView, PayoutRequestView, RiskCard, TimelineStep } from "@/ledger/contracts";
import { fixtureBoardView } from "@/ui/judge/dev/board-view-fixture";

export { fixtureBoardView, fixtureClubData, FIXTURE_KEY_IDS } from "@/ui/judge/dev/board-view-fixture";

/** The seeded gloves request ($42, Team Supply, requested by the Treasurer). */
export function glovesRequest(overrides: Partial<PayoutRequestView> = {}): PayoutRequestView {
  return { ...fixtureBoardView().requests[0]!, ...overrides };
}

/** The seeded paint reimbursement ($36.50 to the Treasurer, requested by the Secretary; flagged "check"). */
export function paintRequest(overrides: Partial<PayoutRequestView> = {}): PayoutRequestView {
  return { ...fixtureBoardView().requests[1]!, ...overrides };
}

export function boardView(overrides: Partial<BoardView> = {}): BoardView {
  return { ...fixtureBoardView(), ...overrides };
}

export function riskCard(overrides: Partial<RiskCard> = {}): RiskCard {
  return {
    verdict: "clear",
    summary: "Nothing to flag.",
    findings: [],
    receipt: null,
    matchesRequest: null,
    origin: "rules",
    model: null,
    checkedAt: "2026-11-05T15:00:00Z",
    ...overrides,
  };
}

/** The gloves request after the President's key: sent to PayPal, not yet confirmed. */
export function sentRequest(extra: TimelineStep[] = []): PayoutRequestView {
  const base = glovesRequest();
  return {
    ...base,
    status: "sent",
    eligibleSigners: [],
    timeline: [
      ...base.timeline,
      { step: "signed", label: "Signed", at: "2026-11-05T16:42:05Z" },
      { step: "sent", label: "Sent to PayPal", at: "2026-11-05T16:42:07Z", detail: "Batch 5UXD2E8A7" },
      ...extra,
    ],
  };
}

/** The paint reimbursement after the President sent it back, with the reason on its timeline. */
export function sentBackRequest(reason = "One line on the receipt is not a league item."): PayoutRequestView {
  const base = paintRequest();
  return {
    ...base,
    status: "sent_back",
    eligibleSigners: [],
    timeline: [...base.timeline, { step: "sent_back", label: "Sent back by the President", at: "2026-11-05T16:45:10Z", detail: reason }],
  };
}
