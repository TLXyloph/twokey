import { describe, expect, it } from "vitest";
import type { LedgerAppendInput } from "@/ledger/contracts";
import { currentRisk, isRiskPending, projectRequests, requestStatus, type RequestState } from "@/ledger/request-projection";
import { eligibleSigners, requestRefusal, signRefusal } from "@/disbursements/eligibility";
import { payoutRequested, payoutSent, requestedPayload } from "../ledger/fixtures";
import { aiCard, assessed, eventsOf, refused, signedBy } from "../ledger/events";

const stateOf = (...inputs: LedgerAppendInput[]): RequestState => {
  const [state] = projectRequests(eventsOf(inputs));
  if (!state) throw new Error("no request");
  return state;
};

/** L14-like: requested by the treasurer to Riverbend Team Supply, key 1 on, AI card in. */
const ready = (...more: LedgerAppendInput[]) => stateOf(payoutRequested(), signedBy("treasurer"), assessed(), assessed(aiCard()), ...more);
/** L15-like: a reimbursement to the treasurer, requested by the secretary. */
const reimbursement = (...more: LedgerAppendInput[]) =>
  stateOf(
    payoutRequested({ payeeId: "treasurer-reimbursement", requestedBy: "secretary" }),
    signedBy("secretary"),
    assessed(),
    assessed(aiCard()),
    ...more,
  );

describe("the request projection", () => {
  it("collects the signatures, marking the requester's as key 1", () => {
    const state = ready(signedBy("president"));
    expect(state.signatures.map((s) => [s.role, s.title, s.isRequest])).toEqual([
      ["treasurer", "Treasurer", true],
      ["president", "President", false],
    ]);
  });

  it("ignores events for a request that doesn't exist", () => {
    const states = projectRequests(eventsOf([payoutRequested(), signedBy("president", {}, "req-404")]));
    expect(states[0]?.signatures).toEqual([]);
  });

  it("is waiting, then sent, then confirmed; a confirmation also wins over a timed-out failure", () => {
    const hash = requestedPayload().requestHash;
    expect(requestStatus(ready())).toBe("waiting");
    expect(requestStatus(ready(payoutSent("req-1", hash)))).toBe("sent");
    const failed: LedgerAppendInput = { type: "payout.failed", payload: { requestId: "req-1", httpStatus: 0, reason: "no answer" } };
    expect(requestStatus(ready(failed))).toBe("failed");
    const confirmed: LedgerAppendInput = {
      type: "payout.confirmed",
      payload: { requestId: "req-1", payoutBatchId: "B", payoutItemId: null, status: "SUCCESS", paypalEventId: "WH-1", eventType: "PAYMENT.PAYOUTSBATCH.SUCCESS", paypalCreatedAt: null },
    };
    expect(requestStatus(ready(failed, confirmed))).toBe("confirmed");
  });

  it("shows the latest AI card over a later rules card, and the rules card while it is the only one", () => {
    expect(currentRisk(stateOf(payoutRequested(), assessed()))?.card.origin).toBe("rules");
    expect(currentRisk(ready(assessed({ summary: "late rules" })))?.card.origin).toBe("live");
  });

  it("keeps the receipt check pending until an AI card lands or an AI read is tried", () => {
    expect(isRiskPending(stateOf(payoutRequested(), assessed()))).toBe(true);
    expect(isRiskPending(ready())).toBe(false);
    const tried = assessed({ findings: [{ severity: "info", text: "The AI couldn't read it.", evidence: "", source: "ai" }] });
    expect(isRiskPending(stateOf(payoutRequested(), assessed(), tried))).toBe(false);
  });

  it("keeps refusals with the role, the rule and the time", () => {
    expect(ready(refused("parent", "not_an_officer")).refusals).toEqual([
      { role: "parent", code: "not_an_officer", message: "refused not_an_officer", at: expect.any(String) },
    ]);
  });
});

describe("signRefusal", () => {
  it("lets a second, different officer add key 2", () => {
    expect(signRefusal(ready(), "president", false)).toBeNull();
    expect(signRefusal(ready(), "secretary", false)).toBeNull();
  });

  it("refuses a parent", () => {
    expect(signRefusal(ready(), "parent", false)?.code).toBe("not_an_officer");
  });

  it("refuses the payee, in a sentence the drawer can show as it is", () => {
    expect(signRefusal(reimbursement(), "treasurer", false)).toEqual({
      code: "payee_cannot_sign",
      message: "The Treasurer is the payee, so the Treasurer can't sign this payout.",
    });
  });

  it("refuses the requester (their request is key 1) and anyone signing twice", () => {
    expect(signRefusal(ready(), "treasurer", false)).toEqual({
      code: "already_signed",
      message: "The Treasurer requested this payout, so the Treasurer's key is already on it. A second, different officer has to sign.",
    });
  });

  it("refuses a closed request: both keys on, sent, blocked or failed", () => {
    const hash = requestedPayload().requestHash;
    expect(signRefusal(ready(signedBy("president")), "secretary", false)?.code).toBe("request_closed");
    expect(signRefusal(ready(payoutSent("req-1", hash)), "president", false)?.message).toBe("This payout has already been sent to PayPal.");
    const blocked: LedgerAppendInput = { type: "payout.blocked", payload: { requestId: "req-1", code: "daily_payout_limit", message: "m" } };
    expect(signRefusal(ready(blocked), "president", false)?.code).toBe("request_closed");
  });

  it("waits for the receipt check before key 2", () => {
    const pending = stateOf(payoutRequested(), signedBy("treasurer"), assessed());
    expect(signRefusal(pending, "president", false)?.code).toBe("receipt_check_pending");
  });

  it("asks for the flags to be acknowledged on a check or stop card, and not on a clear one", () => {
    for (const verdict of ["check", "stop"] as const) {
      const flagged = stateOf(payoutRequested(), signedBy("treasurer"), assessed(aiCard({ verdict })));
      expect(signRefusal(flagged, "president", false)?.code, verdict).toBe("flags_not_acknowledged");
      expect(signRefusal(flagged, "president", true), verdict).toBeNull();
    }
  });

  it("checks the payee before the receipt check, so the payee hears the real reason", () => {
    const pending = stateOf(payoutRequested({ payeeId: "treasurer-reimbursement", requestedBy: "secretary" }), signedBy("secretary"), assessed());
    expect(signRefusal(pending, "treasurer", false)?.code).toBe("payee_cannot_sign");
  });
});

describe("requestRefusal", () => {
  it("refuses a parent and a requester who is the payee", () => {
    expect(requestRefusal("parent", null)?.code).toBe("not_an_officer");
    expect(requestRefusal("treasurer", "treasurer")).toEqual({
      code: "payee_cannot_sign",
      message: "The Treasurer is the payee, so the Treasurer can't request (and sign) this payout.",
    });
    expect(requestRefusal("secretary", "treasurer")).toBeNull();
  });
});

describe("eligibleSigners", () => {
  it("lists the officers who are neither the requester nor the payee", () => {
    expect(eligibleSigners(ready())).toEqual(["president", "secretary"]);
    expect(eligibleSigners(reimbursement())).toEqual(["president"]);
  });

  it("is empty once both keys are on or the request is closed", () => {
    expect(eligibleSigners(ready(signedBy("president")))).toEqual([]);
    expect(eligibleSigners(ready(payoutSent("req-1", requestedPayload().requestHash)))).toEqual([]);
  });
});

describe("the reviewer holds no payout key", () => {
  it("can't request or sign a payout, and the refusal says why", async () => {
    const { requestRefusal } = await import("@/disbursements/eligibility");
    expect(requestRefusal("reviewer", null)).toEqual({ code: "not_an_officer", message: "The reviewer can't request payouts. Only the club's officers can." });
  });
});
