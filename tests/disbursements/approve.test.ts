import { describe, expect, it } from "vitest";
import type { LedgerEvent } from "@/ledger/contracts";
import { findRequest, requestStatus } from "@/ledger/request-projection";
import { signPayout } from "@/disbursements/approve";
import { LIMIT_MESSAGES, SIGNATURES_FAILED_REASON } from "@/disbursements/executor";
import { createPayoutRequest } from "@/disbursements/requests";
import { runRiskRead } from "@/disbursements/risk-read";
import { rulesCard } from "../ledger/fixtures";
import { batchCreated, deps, harness, mockPaypal, SESSION, type Harness } from "./harness";

const ready = async (h: Harness, requestId: string) => runRiskRead(deps(h), SESSION, requestId);
const sign = (h: Harness, requestId: string, actingAs: Parameters<typeof signPayout>[3]["actingAs"], acknowledgedFlags = false) =>
  signPayout(deps(h), SESSION, requestId, { actingAs, acknowledgedFlags });
const last = async (h: Harness): Promise<LedgerEvent> => (await h.ledger.read(SESSION)).at(-1)!;

describe("signPayout: key 2 sends the payout", () => {
  it("signs as the President, then posts one payout keyed by the request hash and records it", async () => {
    const h = await harness();
    await ready(h, "L14");
    expect(await sign(h, "L14", "president")).toEqual({ kind: "signed", executed: "sent" });
    const state = findRequest(await h.ledger.read(SESSION), "L14")!;
    expect(state.signatures.map((s) => s.role)).toEqual(["treasurer", "president"]);
    expect(requestStatus(state)).toBe("sent");
    expect(state.sent?.payload).toEqual({
      requestId: "L14",
      requestHash: state.request.requestHash,
      senderBatchId: state.request.requestHash,
      payoutBatchId: "BATCH-1",
      batchStatus: "PENDING",
    });
    expect(h.paypal.postJson).toHaveBeenCalledTimes(1);
    const [path, body, , headers] = h.paypal.postJson.mock.calls[0]!;
    expect(path).toBe("/v1/payments/payouts");
    expect(headers).toEqual({ "PayPal-Request-Id": state.request.requestHash });
    const parsed = JSON.parse(body);
    expect(parsed.sender_batch_header.sender_batch_id).toBe(state.request.requestHash);
    expect(parsed.items).toEqual([
      {
        recipient_type: "EMAIL",
        amount: { value: "42.00", currency: "USD" },
        note: "Goalkeeper gloves. Signed by the Treasurer and the President (TwoKey demo, sandbox).",
        sender_item_id: "L14",
        receiver: state.request.payeeEmail,
      },
    ]);
  });

  it("binds the risk card the signer saw, the flags tick and the ledger head into key 2", async () => {
    const h = await harness({ ai: rulesCard({ origin: "live", verdict: "check", model: "m" }) });
    await ready(h, "L15");
    const head = (await last(h)).hash;
    await sign(h, "L15", "president", true);
    const state = findRequest(await h.ledger.read(SESSION), "L15")!;
    const key2 = state.signatures[1]!;
    expect(key2.signed).toMatchObject({ role: "president", riskCardHash: state.risks.at(-1)!.cardHash, acknowledgedFlags: true, prevHash: head });
    expect(await h.verifier.verify("president", key2.signed, key2.signature, key2.keyId)).toBe(true);
  });
});

describe("signPayout: refusals are recorded and nothing is signed", () => {
  it("refuses the payee on L15", async () => {
    const h = await harness();
    await ready(h, "L15");
    expect(await sign(h, "L15", "treasurer")).toEqual({
      kind: "refused",
      refusal: { code: "payee_cannot_sign", message: "The Treasurer is the payee, so the Treasurer can't sign this payout." },
    });
    expect(await last(h)).toMatchObject({ type: "approval.refused", payload: { requestId: "L15", role: "treasurer", code: "payee_cannot_sign" } });
    expect(h.paypal.postJson).not.toHaveBeenCalled();
  });

  it("refuses the requester, a parent, key 2 before the receipt check, and unacknowledged flags", async () => {
    const h = await harness({ ai: rulesCard({ origin: "live", verdict: "stop", model: "m" }) });
    expect(await sign(h, "L14", "president")).toMatchObject({ kind: "refused", refusal: { code: "receipt_check_pending" } });
    await ready(h, "L14");
    expect(await sign(h, "L14", "treasurer")).toMatchObject({ refusal: { code: "already_signed" } });
    expect(await sign(h, "L14", "parent")).toMatchObject({ refusal: { code: "not_an_officer" } });
    expect(await sign(h, "L14", "secretary", false)).toMatchObject({ refusal: { code: "flags_not_acknowledged" } });
    const refusals = findRequest(await h.ledger.read(SESSION), "L14")!.refusals.map((r) => [r.role, r.code]);
    expect(refusals).toEqual([
      ["president", "receipt_check_pending"],
      ["treasurer", "already_signed"],
      ["parent", "not_an_officer"],
      ["secretary", "flags_not_acknowledged"],
    ]);
    expect(await sign(h, "L14", "secretary", true)).toEqual({ kind: "signed", executed: "sent" });
  });

  it("refuses a request that is already sent", async () => {
    const h = await harness();
    await ready(h, "L14");
    await sign(h, "L14", "president");
    expect(await sign(h, "L14", "secretary")).toMatchObject({ kind: "refused", refusal: { code: "request_closed" } });
  });

  it("answers an unknown request without recording anything", async () => {
    const h = await harness();
    const before = (await h.ledger.read(SESSION)).length;
    expect(await sign(h, "R-404", "president")).toMatchObject({ kind: "unknown_request", refusal: { code: "unknown_request" } });
    expect(await h.ledger.read(SESSION)).toHaveLength(before);
  });
});

describe("the executor", () => {
  it("blocks the fourth payout of a session and sends nothing", async () => {
    const h = await harness();
    const cones = { actingAs: "president" as const, payeeId: "team-supply" as const, amountCents: 100, description: "Cones", budgetLine: "equipment" as const, receiptId: "cones-team-supply" as const };
    await createPayoutRequest(deps(h), SESSION, cones);
    await createPayoutRequest(deps(h), SESSION, cones);
    for (const [id, second] of [["L14", "president"], ["L15", "president"], ["R-1", "secretary"]] as const) {
      await ready(h, id);
      expect(await sign(h, id, second)).toEqual({ kind: "signed", executed: "sent" });
    }
    await ready(h, "R-2");
    expect(await sign(h, "R-2", "treasurer")).toEqual({ kind: "blocked", code: "session_payout_limit", message: LIMIT_MESSAGES.session_payout_limit });
    expect(h.paypal.postJson).toHaveBeenCalledTimes(3);
    expect(requestStatus(findRequest(await h.ledger.read(SESSION), "R-2")!)).toBe("blocked");
  });

  it("blocks a payout that would take today's total across sessions past $500", async () => {
    const h = await harness();
    const busy = { ...deps(h), ledger: { ...h.ledger, sentPayoutCentsSince: async () => 49_900 } };
    await ready(h, "L14");
    expect(await signPayout(busy, SESSION, "L14", { actingAs: "president", acknowledgedFlags: false })).toMatchObject({
      kind: "blocked",
      code: "daily_payout_limit",
    });
    expect(h.paypal.postJson).not.toHaveBeenCalled();
  });

  it("counts the day in UTC", async () => {
    const h = await harness();
    let since = "";
    const watching = { ...deps(h), ledger: { ...h.ledger, sentPayoutCentsSince: async (iso: string) => ((since = iso), 0) } };
    await ready(h, "L14");
    await signPayout(watching, SESSION, "L14", { actingAs: "president", acknowledgedFlags: false });
    expect(since).toBe("2026-11-05T00:00:00.000Z");
  });

  it("records PayPal's refusal in plain words and closes the request", async () => {
    const h = await harness({ paypal: mockPaypal(() => ({ status: 422, body: { name: "INSUFFICIENT_FUNDS", debug_id: "abc123" } })) });
    await ready(h, "L14");
    expect(await sign(h, "L14", "president")).toEqual({ kind: "signed", executed: "failed" });
    expect((await last(h)).payload).toEqual({ requestId: "L14", httpStatus: 422, reason: "The club's PayPal balance is too low for this payout." });
  });

  it("sends nothing when a signature doesn't verify", async () => {
    const h = await harness();
    const distrustful = { ...deps(h), verifier: { verify: async () => false } };
    await ready(h, "L14");
    expect(await signPayout(distrustful, SESSION, "L14", { actingAs: "president", acknowledgedFlags: false })).toEqual({ kind: "signed", executed: "failed" });
    expect((await last(h)).payload).toMatchObject({ httpStatus: 0, reason: SIGNATURES_FAILED_REASON });
    expect(h.paypal.postJson).not.toHaveBeenCalled();
  });

  it("records one outcome when two officers add key 2 at once, every PayPal call with the same Request-Id", async () => {
    const h = await harness({ paypal: mockPaypal(() => batchCreated("BATCH-RACE")) });
    await ready(h, "L14");
    await Promise.all([sign(h, "L14", "president"), sign(h, "L14", "secretary")]);
    const events = await h.ledger.read(SESSION);
    expect(events.filter((e) => e.type === "payout.sent" || e.type === "payout.failed")).toHaveLength(1);
    const ids = new Set(h.paypal.postJson.mock.calls.map((call) => call[3]?.["PayPal-Request-Id"]));
    expect([...ids]).toEqual([findRequest(events, "L14")!.request.requestHash]);
  });
});
