import { describe, expect, it } from "vitest";
import { findRequest, projectRequests } from "@/ledger/request-projection";
import { createPayoutRequest, createPayoutRequestSchema, MAX_SESSION_REQUESTS, type CreateRequestInput } from "@/disbursements/requests";
import { deps, harness, SESSION } from "./harness";

const cones: CreateRequestInput = {
  actingAs: "president",
  payeeId: "team-supply",
  amountCents: 4800,
  description: "Practice cones",
  budgetLine: "equipment",
  receiptId: "cones-team-supply",
};

describe("createPayoutRequestSchema", () => {
  const parse = (over: Record<string, unknown>) => createPayoutRequestSchema.safeParse({ ...cones, ...over });

  it("accepts a request under the cap, trimming the description", () => {
    expect(parse({ description: "  Practice cones  " })).toMatchObject({ success: true, data: { description: "Practice cones" } });
    expect(parse({ amountCents: 1 }).success).toBe(true);
    expect(parse({ amountCents: 5000 }).success).toBe(true);
  });

  it("refuses amounts outside 1..5000 cents or not whole cents", () => {
    for (const amountCents of [0, -1, 5001, 1.5, "42"]) expect(parse({ amountCents }).success, String(amountCents)).toBe(false);
  });

  it("refuses a description that is empty, over 80 characters or has control characters", () => {
    expect(parse({ description: "   " }).success).toBe(false);
    expect(parse({ description: "x".repeat(81) }).success).toBe(false);
    expect(parse({ description: "x".repeat(80) }).success).toBe(true);
    expect(parse({ description: "cones\u0000" }).success).toBe(false);
  });

  it("refuses unknown payees, budget lines, receipts, roles and extra fields (no free-text emails)", () => {
    expect(parse({ payeeId: "someone@example.com" }).success).toBe(false);
    expect(parse({ budgetLine: "travel" }).success).toBe(false);
    expect(parse({ receiptId: "receipt-404" }).success).toBe(false);
    expect(parse({ actingAs: "coach" }).success).toBe(false);
    expect(parse({ payeeEmail: "someone@example.com" }).success).toBe(false);
  });
});

describe("createPayoutRequest", () => {
  it("records the request, key 1 by the requester, and the rules card", async () => {
    const h = await harness();
    const result = await createPayoutRequest(deps(h), SESSION, cones);
    expect(result).toEqual({ ok: true, requestId: "R-1" });
    const events = await h.ledger.read(SESSION);
    expect(events.slice(7).map((e) => e.type)).toEqual(["payout.requested", "approval.signed", "risk.assessed"]);
    const state = findRequest(events, "R-1")!;
    expect(state.request).toMatchObject({ source: "session", requestedBy: "president", amountCents: 4800, createdAt: expect.any(String) });
    const key1 = state.signatures[0]!;
    expect(key1).toMatchObject({ role: "president", isRequest: true });
    expect(await h.verifier.verify("president", key1.signed, key1.signature, key1.keyId)).toBe(true);
    expect(state.risks[0]?.card.origin).toBe("rules");
  });

  it("hands the rules check every request in the session (for the split check)", async () => {
    const h = await harness();
    await createPayoutRequest(deps(h), SESSION, cones);
    const [input] = h.risk.rulesCard.mock.calls.at(-1)!;
    expect(input.sessionRequests.map((r) => r.requestId)).toEqual(["L14", "L15", "R-1"]);
  });

  it("refuses the payee as requester, records the refusal and creates nothing", async () => {
    const h = await harness();
    const result = await createPayoutRequest(deps(h), SESSION, { ...cones, actingAs: "treasurer", payeeId: "treasurer-reimbursement" });
    expect(result).toEqual({
      ok: false,
      refusal: { code: "payee_cannot_sign", message: "The Treasurer is the payee, so the Treasurer can't request (and sign) this payout." },
    });
    const events = await h.ledger.read(SESSION);
    expect(events.at(-1)).toMatchObject({ type: "approval.refused", payload: { role: "treasurer", code: "payee_cannot_sign" } });
    expect(projectRequests(events)).toHaveLength(2);
  });

  it("refuses a parent", async () => {
    const h = await harness();
    const result = await createPayoutRequest(deps(h), SESSION, { ...cones, actingAs: "parent" });
    expect(result).toMatchObject({ ok: false, refusal: { code: "not_an_officer" } });
  });

  it(`stops at ${MAX_SESSION_REQUESTS} requests of a session's own`, async () => {
    const h = await harness();
    for (let i = 0; i < MAX_SESSION_REQUESTS; i++) expect((await createPayoutRequest(deps(h), SESSION, cones)).ok).toBe(true);
    expect(await createPayoutRequest(deps(h), SESSION, cones)).toEqual({ ok: false, tooMany: true });
  });
});
