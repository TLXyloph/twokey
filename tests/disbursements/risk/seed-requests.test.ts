import { describe, expect, it } from "vitest";
import { PAYOUT_CAP_CENTS } from "@/ledger/contracts";
import { clubDate } from "@/disbursements/risk/format";
import { RECEIPTS } from "@/disbursements/risk/receipts";
import { buildRulesCard } from "@/disbursements/risk/rules";
import { SEED_RISK_REQUESTS, SEED_SESSION_REQUESTS } from "@/disbursements/risk/seed-requests";

const NOW = new Date("2026-11-05T17:00:00.000Z");
const [gloves, paint] = SEED_RISK_REQUESTS.map((seed) => seed.request);

describe("the seeded requests", () => {
  it("are the re-seeded L14 and L15 (spec §7): under the cap, with their sample receipts", () => {
    expect(gloves).toMatchObject({ payeeName: "Riverbend Team Supply", amountCents: 4200, budgetLine: "equipment", requestedBy: "treasurer", source: "seed" });
    expect(paint).toMatchObject({ payeeId: "treasurer-reimbursement", amountCents: 3650, budgetLine: "field-maintenance", requestedBy: "secretary", source: "seed" });
    for (const seed of [gloves!, paint!]) {
      expect(seed.amountCents).toBeLessThanOrEqual(PAYOUT_CAP_CENTS);
      expect(seed.receiptSha256).toBe(RECEIPTS[seed.receiptId].sha256);
      expect(seed.amountCents).toBe(RECEIPTS[seed.receiptId].facts.totalCents);
    }
    expect(SEED_SESSION_REQUESTS).toEqual([gloves, paint]);
  });

  it("fall on the seed rows' days in club time, after their receipts' dates", () => {
    expect(clubDate(gloves!.createdAt)?.iso).toBe("2026-11-02");
    expect(clubDate(paint!.createdAt)?.iso).toBe("2026-11-03");
  });

  it("give the story's rules cards on the demo policy: gloves clear, the paint reimbursement to check", () => {
    const sessionRequests = [...SEED_SESSION_REQUESTS];
    expect(buildRulesCard({ request: gloves!, sessionRequests }, NOW)).toMatchObject({ verdict: "clear", findings: [] });
    const paintCard = buildRulesCard({ request: paint!, sessionRequests }, NOW);
    expect(paintCard.verdict).toBe("check");
    expect(paintCard.findings.map((finding) => finding.text)).toEqual(["This pays an officer, the Treasurer."]);
  });
});
