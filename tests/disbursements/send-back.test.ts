import { describe, expect, it } from "vitest";
import { sendBackPayout } from "@/disbursements/send-back";
import { signPayout } from "@/disbursements/approve";
import { runRiskRead } from "@/disbursements/risk-read";
import { foldBoard } from "@/ledger/fold";
import { findRequest, requestStatus } from "@/ledger/request-projection";
import { toRequestView } from "@/ledger/request-view";
import { riverbend } from "@/demo/riverbend";
import { deps, harness, SESSION, type Harness } from "./harness";

const REASON = "The receipt includes $12 of patio string lights. Please file the paint on its own.";
const sendBack = (h: Harness, requestId: string, actingAs: Parameters<typeof sendBackPayout>[3]["actingAs"], reason = REASON) =>
  sendBackPayout(deps(h), SESSION, requestId, { actingAs, reason });
const stateOf = async (h: Harness, requestId: string) => findRequest(await h.ledger.read(SESSION), requestId)!;

describe("sendBackPayout: a second officer sends a request back with a reason", () => {
  it("closes the request, records who sent it back and why, and sends nothing", async () => {
    const h = await harness();
    expect(await sendBack(h, "L15", "president")).toEqual({ kind: "sent_back" });
    const state = await stateOf(h, "L15");
    expect(requestStatus(state)).toBe("sent_back");
    const view = toRequestView(state);
    expect(view.status).toBe("sent_back");
    expect(view.timeline.at(-1)).toMatchObject({ step: "sent_back", label: "Sent back by the President", detail: REASON });
    expect(view.eligibleSigners).toEqual([]);
    expect(view.refusals).toEqual([]);
    expect(h.paypal.postJson).not.toHaveBeenCalled();
  });

  it("then refuses any signature on it", async () => {
    const h = await harness();
    await sendBack(h, "L14", "secretary");
    await runRiskRead(deps(h), SESSION, "L14");
    const outcome = await signPayout(deps(h), SESSION, "L14", { actingAs: "president", acknowledgedFlags: true });
    expect(outcome).toMatchObject({ kind: "refused", refusal: { code: "request_closed", message: "The Secretary sent this payout back, so it can't be signed." } });
    expect(h.paypal.postJson).not.toHaveBeenCalled();
  });

  it("drops the sent-back payout from the waiting queue and the ledger rows", async () => {
    const h = await harness();
    await sendBack(h, "L15", "president");
    const board = foldBoard(riverbend, await h.ledger.read(SESSION), { sharedBalance: null, dailySentCents: 0, seedHash: "x" });
    expect(board.data.ledger.find((row) => row.id === "L15")).toBeUndefined();
    expect(board.requests.find((r) => r.requestId === "L15")?.status).toBe("sent_back");
  });
});

describe("sendBackPayout: only an officer who could sign key 2 may send it back", () => {
  it.each([
    ["parent", "not_an_officer"],
    ["reviewer", "not_an_officer"],
    ["secretary", "already_signed"],
    ["treasurer", "payee_cannot_sign"],
  ] as const)("refuses the %s on the paint reimbursement (%s) and records the refusal", async (role, code) => {
    const h = await harness();
    const outcome = await sendBack(h, "L15", role);
    expect(outcome).toMatchObject({ kind: "refused", refusal: { code } });
    const state = await stateOf(h, "L15");
    expect(requestStatus(state)).toBe("waiting");
    expect(state.refusals.map((r) => r.code)).toEqual([code]);
  });

  it("refuses a request that was already sent", async () => {
    const h = await harness();
    await runRiskRead(deps(h), SESSION, "L14");
    await signPayout(deps(h), SESSION, "L14", { actingAs: "president", acknowledgedFlags: true });
    expect(await sendBack(h, "L14", "secretary")).toMatchObject({ kind: "refused", refusal: { code: "request_closed" } });
  });

  it("answers an unknown request without recording anything", async () => {
    const h = await harness();
    const before = (await h.ledger.read(SESSION)).length;
    expect(await sendBack(h, "nope", "president")).toMatchObject({ kind: "unknown_request" });
    expect((await h.ledger.read(SESSION)).length).toBe(before);
  });
});
