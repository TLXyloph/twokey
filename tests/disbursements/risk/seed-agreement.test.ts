import { describe, expect, it } from "vitest";
import { payeeById } from "@/disbursements/payees";
import { SEED_RISK_REQUESTS } from "@/disbursements/risk/seed-requests";
import { SEEDED_REQUESTS } from "@/disbursements/seed-requests";

/**
 * The recorded risk cards (recorded-cards.json) are keyed by the prompt, so the requests every
 * session opens with must carry exactly the facts the recordings were made from. If these drift,
 * every judge session pays for two live receipt checks.
 */
describe("the seeded requests and the recorded risk cards agree", () => {
  const prompted = (r: { payeeId: string; amountCents: number; description: string; budgetLine: string; receiptId: string; requestedBy: string; createdAt: string }) => ({
    payeeName: payeeById(r.payeeId)?.name,
    amountCents: r.amountCents,
    description: r.description,
    budgetLine: r.budgetLine,
    receiptId: r.receiptId,
    requestedBy: r.requestedBy,
    createdAt: r.createdAt,
  });

  it("has the same two requests on both sides, fact for fact", () => {
    expect(SEED_RISK_REQUESTS.map((s) => prompted(s.request))).toEqual(SEEDED_REQUESTS.map(prompted));
  });
});
