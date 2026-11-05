import { describe, expect, it } from "vitest";
import { BUDGET_LINES } from "@/demo/riverbend-policy";
import {
  budgetLeftCents,
  formatCents,
  formatClubTime,
  formatStepTime,
  limitsLine,
  needsAcknowledgement,
  originLabel,
  parseAmountToCents,
  requestSections,
  reviewButtonLabel,
  roleTitle,
  signatureLine,
  signHint,
  timelineRows,
  verdictLabel,
  waitingCount,
} from "@/ui/judge/judge-model";
import { boardView, fixtureClubData, glovesRequest, paintRequest, riskCard, sentRequest } from "../../fixtures/board-view";

describe("money", () => {
  it("prints cents as dollars with two decimals and separators", () => {
    expect(formatCents(4_200)).toBe("$42.00");
    expect(formatCents(3_650)).toBe("$36.50");
    expect(formatCents(499_750)).toBe("$4,997.50");
    expect(formatCents(0)).toBe("$0.00");
  });

  it("reads an amount a judge types, up to the $50.00 cap, in whole cents", () => {
    expect(parseAmountToCents("42")).toEqual({ ok: true, cents: 4_200 });
    expect(parseAmountToCents(" $36.5 ")).toEqual({ ok: true, cents: 3_650 });
    expect(parseAmountToCents("0.99")).toEqual({ ok: true, cents: 99 });
    expect(parseAmountToCents("50.00")).toEqual({ ok: true, cents: 5_000 });
  });

  it("explains what is wrong with an amount it refuses", () => {
    expect(parseAmountToCents("")).toEqual({ ok: false, message: "Enter an amount." });
    expect(parseAmountToCents("abc")).toEqual({ ok: false, message: "Enter an amount in dollars, like 42.00." });
    expect(parseAmountToCents("4.505")).toEqual({ ok: false, message: "Use at most two decimal places." });
    expect(parseAmountToCents("0")).toEqual({ ok: false, message: "The amount must be more than $0.00." });
    expect(parseAmountToCents("50.01")).toEqual({ ok: false, message: "Judge mode caps a payout at $50.00." });
  });
});

describe("times, in the club's time zone", () => {
  it("prints a step's time with seconds and the zone", () => {
    expect(formatClubTime("2026-11-05T16:42:05Z")).toBe("10:42:05 AM CST");
  });

  it("adds the date when the step was on another day", () => {
    const now = new Date("2026-11-05T17:00:00Z");
    expect(formatStepTime("2026-11-05T16:42:05Z", now)).toBe("10:42:05 AM CST");
    expect(formatStepTime("2026-11-02T15:10:00Z", now)).toBe("Nov 2, 9:10 AM CST");
  });
});

describe("the review button", () => {
  it("counts waiting payouts from the live view, and nothing before it arrives", () => {
    expect(waitingCount(boardView())).toBe(2);
    expect(waitingCount(boardView({ requests: [sentRequest()] }))).toBe(0);
    expect(waitingCount(null)).toBeNull();
  });

  it("names the action for an officer, and says when nothing is waiting", () => {
    expect(reviewButtonLabel("treasurer", 2)).toBe("Review 2 payouts");
    expect(reviewButtonLabel("president", 1)).toBe("Review 1 payout");
    expect(reviewButtonLabel("secretary", 0)).toBe("No payouts waiting");
  });

  it("lets a parent look, not review", () => {
    expect(reviewButtonLabel("parent", 2)).toBe("See payouts");
    expect(reviewButtonLabel("parent", 0)).toBe("See payouts");
  });
});

describe("labels", () => {
  it("titles each role", () => {
    expect(roleTitle("treasurer")).toBe("Treasurer");
    expect(roleTitle("parent")).toBe("Parent");
  });

  it("puts each verdict in plain words", () => {
    expect(verdictLabel("clear")).toBe("Looks right");
    expect(verdictLabel("check")).toBe("Check this");
    expect(verdictLabel("stop")).toBe("Stop");
  });

  it("says where a risk card came from", () => {
    expect(originLabel("live")).toBe("Checked by the AI");
    expect(originLabel("recorded")).toBe("Recorded check");
    expect(originLabel("replay")).toBe("Replay of a recorded check");
    expect(originLabel("rules")).toBe("Rules only");
  });

  it("asks for the flags tick on a check or stop card only", () => {
    expect(needsAcknowledgement(riskCard({ verdict: "clear" }))).toBe(false);
    expect(needsAcknowledgement(riskCard({ verdict: "check" }))).toBe(true);
    expect(needsAcknowledgement(riskCard({ verdict: "stop" }))).toBe(true);
    expect(needsAcknowledgement(null)).toBe(false);
  });

  it("writes one line per signature, with the demo key's id", () => {
    expect(signatureLine(glovesRequest().signatures[0]!)).toBe("Signed by the Treasurer · demo key 7f3a1c2e");
  });

  it("counts the payouts this session can still send", () => {
    expect(limitsLine({ payoutCapCents: 5_000, sessionPayoutsLeft: 2, dailyCentsLeft: 50_000 })).toBe("2 of 3 payouts left in this session");
    expect(limitsLine({ payoutCapCents: 5_000, sessionPayoutsLeft: 1, dailyCentsLeft: 50_000 })).toBe("1 of 3 payouts left in this session");
    expect(limitsLine({ payoutCapCents: 5_000, sessionPayoutsLeft: 0, dailyCentsLeft: 50_000 })).toBe(
      "No payouts left in this session",
    );
  });

  it("says when the day's limit across all sessions is the tighter one", () => {
    expect(limitsLine({ payoutCapCents: 5_000, sessionPayoutsLeft: 2, dailyCentsLeft: 3_000 })).toBe(
      "2 of 3 payouts left in this session · $30.00 left today across all sessions",
    );
    expect(limitsLine({ payoutCapCents: 5_000, sessionPayoutsLeft: 2, dailyCentsLeft: 0 })).toBe(
      "The demo's daily limit is used up. Try again tomorrow.",
    );
  });
});

describe("sign hints (the server still decides)", () => {
  it("tells an eligible officer their key is the second one", () => {
    expect(signHint(glovesRequest(), "president")).toEqual({ text: "Your key would be the second of two.", expectRefusal: false });
  });

  it("warns the payee, and invites them to try", () => {
    expect(signHint(paintRequest(), "treasurer")).toEqual({
      text: "You're the payee, so your key can't approve this. Try it: the server checks, not this page.",
      expectRefusal: true,
    });
  });

  it("tells the first signer who can add the second key", () => {
    expect(signHint(glovesRequest(), "treasurer")).toEqual({
      text: "You signed this request. The second key must come from the President or the Secretary.",
      expectRefusal: true,
    });
    expect(signHint(paintRequest(), "secretary")).toEqual({
      text: "You signed this request. The second key must come from the President.",
      expectRefusal: true,
    });
  });

  it("tells a parent that only officers sign", () => {
    expect(signHint(glovesRequest(), "parent")).toEqual({ text: "Parents can see payouts. Only officers sign them.", expectRefusal: true });
  });

  it("has nothing to say once a payout has left the queue", () => {
    expect(signHint(sentRequest(), "president")).toBeNull();
  });
});

describe("request sections", () => {
  it("lists waiting requests first, then the rest, keeping the server's order", () => {
    const sent = { ...sentRequest(), requestId: "sent" };
    const { waiting, closed } = requestSections(boardView({ requests: [sent, glovesRequest(), paintRequest()] }));
    expect(waiting.map((r) => r.requestId)).toEqual(["req_seed_gloves", "req_seed_paint"]);
    expect(closed.map((r) => r.requestId)).toEqual(["sent"]);
  });
});

describe("the timeline", () => {
  const now = new Date("2026-11-05T17:00:00Z");

  it("shows the four steps, with the ones still to come waiting", () => {
    const rows = timelineRows(sentRequest(), now);
    expect(rows.map((r) => [r.label, r.state])).toEqual([
      ["Requested", "done"],
      ["Signed", "done"],
      ["Sent to PayPal", "done"],
      ["PayPal confirmed", "pending"],
    ]);
    expect(rows[2]!.detail).toBe("Batch 5UXD2E8A7");
    expect(rows[2]!.time).toBe("10:42:07 AM CST");
    expect(rows[3]!.time).toBeNull();
  });

  it("ticks the last step when PayPal confirms", () => {
    const rows = timelineRows(sentRequest([{ step: "confirmed", label: "PayPal confirmed", at: "2026-11-05T16:42:24Z" }]), now);
    expect(rows[3]).toMatchObject({ label: "PayPal confirmed", state: "done", time: "10:42:24 AM CST" });
  });

  it("ends in 'Not sent' with the reason for a blocked or failed payout", () => {
    const blocked = {
      ...glovesRequest(),
      status: "blocked" as const,
      timeline: [
        ...glovesRequest().timeline,
        { step: "signed" as const, label: "Signed", at: "2026-11-05T16:42:05Z" },
        { step: "blocked" as const, label: "Blocked", at: "2026-11-05T16:42:05Z", detail: "This session has sent its 3 payouts." },
      ],
    };
    const rows = timelineRows(blocked, now);
    expect(rows.map((r) => [r.label, r.state])).toEqual([
      ["Requested", "done"],
      ["Signed", "done"],
      ["Not sent", "stopped"],
    ]);
    expect(rows[2]!.detail).toBe("This session has sent its 3 payouts.");
  });
});

describe("budget lines", () => {
  it("leaves what was approved minus what the season's ledger spent on the line", () => {
    const equipment = BUDGET_LINES.find((l) => l.id === "equipment")!;
    const data = fixtureClubData();
    const spent = data.ledger
      .filter((row) => row.direction === "out" && row.category === equipment.category)
      .reduce((total, row) => total - Math.round(row.amount * 100), 0);
    expect(budgetLeftCents(data, equipment)).toBe(equipment.approvedCents - spent);
  });
});
