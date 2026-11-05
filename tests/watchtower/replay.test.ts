import { describe, expect, it } from "vitest";
import { RECORDED_OUTSIDE_SEND } from "@/watchtower/recorded-outside-send";
import { replayOutsideSend } from "@/watchtower/replay";
import measured from "../fixtures/paypal/transaction-search-2026-11-05.json";

const NOW = new Date("2026-11-07T18:00:00.000Z");

describe("the recorded outside send", () => {
  it("is Test B's two rows exactly as PayPal reported them: the T0000 and its T0300 funding row", () => {
    const fromFixture = measured.transaction_details.filter((d) =>
      ["1TY14748YE721631B", "0UN74527JS883252U"].includes(d.transaction_info.transaction_id),
    );
    expect(RECORDED_OUTSIDE_SEND.transaction_details).toEqual(fromFixture);
  });
});

describe("replayOutsideSend", () => {
  it("runs the recorded rows through the same classifier and returns the alert, labelled as a replay", () => {
    expect(replayOutsideSend(NOW)).toEqual({
      label: "Replay of a real sandbox event: a $3.21 website send on Nov 3, 2026.",
      finding: {
        transactionId: "1TY14748YE721631B",
        kind: "outside_debit",
        eventCode: "T0000",
        label: "Sent from PayPal's website",
        amountCents: 321,
        counterparty: "Esther Huang (Treasurer)",
        counterpartyIsOfficer: true,
        at: "2026-11-03T20:27:29Z",
        firstSeenAt: "2026-11-07T18:00:00.000Z",
        reportedAfterMinutes: null,
        fundedByBank: true,
        explanation: null,
      },
    });
  });
});
