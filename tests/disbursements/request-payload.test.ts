import { describe, expect, it } from "vitest";
import { canonicalJson, sha256Hex } from "@/ledger/canonical";
import { PAYEES } from "@/disbursements/payees";
import { receiptById, receiptSha256, RECEIPTS } from "@/disbursements/receipt-hashes";
import { RECEIPTS as SAMPLE_RECEIPTS } from "@/disbursements/risk/receipts";
import { buildRequestPayload, computeRequestHash, type RequestFacts } from "@/disbursements/request-payload";
import { SEEDED_REQUESTS } from "@/disbursements/seed-requests";

const facts: RequestFacts = {
  requestId: "req-1",
  payeeId: "team-supply",
  amountCents: 4800,
  description: "Practice cones",
  budgetLine: "equipment",
  receiptId: "cones-team-supply",
  requestedBy: "president",
  createdAt: "2026-11-05T16:00:00.000Z",
  source: "session",
};

describe("buildRequestPayload", () => {
  it("fills in the payee from the fixed list, the receipt hash and USD", async () => {
    const payload = await buildRequestPayload("session-a", facts);
    expect(payload).toMatchObject({
      requestId: "req-1",
      payeeId: "team-supply",
      payeeName: PAYEES[0]!.name,
      payeeEmail: PAYEES[0]!.email,
      amountCents: 4800,
      currency: "USD",
      receiptSha256: receiptSha256("cones-team-supply"),
      source: "session",
    });
    expect(payload.requestHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hashes exactly the spec's eleven fields, canonically", async () => {
    const payload = await buildRequestPayload("session-a", facts);
    const expected = await sha256Hex(
      canonicalJson({
        sessionId: "session-a",
        requestId: "req-1",
        payeeId: "team-supply",
        payeeEmail: PAYEES[0]!.email,
        amountCents: 4800,
        currency: "USD",
        description: "Practice cones",
        budgetLine: "equipment",
        receiptSha256: receiptSha256("cones-team-supply"),
        requestedBy: "president",
        createdAt: "2026-11-05T16:00:00.000Z",
      }),
    );
    expect(payload.requestHash).toBe(expected);
    expect(await computeRequestHash("session-a", payload)).toBe(expected);
  });

  it("gives the same request a different hash in another session, or with any field changed", async () => {
    const base = (await buildRequestPayload("session-a", facts)).requestHash;
    expect((await buildRequestPayload("session-b", facts)).requestHash).not.toBe(base);
    expect((await buildRequestPayload("session-a", { ...facts, amountCents: 4801 })).requestHash).not.toBe(base);
    expect((await buildRequestPayload("session-a", { ...facts, payeeId: "treasurer-reimbursement" })).requestHash).not.toBe(base);
  });

  it("refuses an unknown payee", async () => {
    await expect(buildRequestPayload("s", { ...facts, payeeId: "nobody" as never })).rejects.toThrow(/unknown payee/);
  });
});

describe("the sample receipts", () => {
  it("lists the four contract receipt ids, each binding the Risk context's hash of its image", () => {
    expect(RECEIPTS.map((r) => r.id)).toEqual(["gloves-team-supply", "paint-bluebird-hardware", "cones-team-supply", "bibs-team-supply"]);
    for (const receipt of RECEIPTS) {
      expect(receipt.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(receipt.sha256).toBe(SAMPLE_RECEIPTS[receipt.id].sha256);
    }
    expect(receiptById("nope")).toBeUndefined();
  });
});

describe("the seeded requests", () => {
  it("are L14 and L15, read from the seed rows", () => {
    expect(SEEDED_REQUESTS.map((r) => [r.requestId, r.payeeId, r.amountCents, r.requestedBy, r.budgetLine, r.receiptId])).toEqual([
      ["L14", "team-supply", 4200, "treasurer", "equipment", "gloves-team-supply"],
      ["L15", "treasurer-reimbursement", 3650, "secretary", "field-maintenance", "paint-bluebird-hardware"],
    ]);
    expect(SEEDED_REQUESTS.every((r) => r.source === "seed")).toBe(true);
    expect(SEEDED_REQUESTS[0]!.createdAt).toBe("2026-11-02T15:00:00.000Z");
  });
});
