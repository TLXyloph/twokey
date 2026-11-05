import { describe, expect, it } from "vitest";
import type { CloseException, CloseFigures } from "@/close/contracts";
import { octoberClose } from "@/close/october";
import {
  approvedTotal,
  budgetRows,
  carriedForwardLine,
  closeFinding,
  DRAFT_LABEL,
  exceptionView,
  ledgerSections,
  money,
  openItemsLine,
  plural,
  roleName,
  shortDay,
  shortHash,
  signatureLine,
  signButtonLabel,
  signedMoney,
  signHint,
  statementCells,
  twoKeyLine,
} from "@/ui/close/close-model";

const october = octoberClose();
const withFigures = (over: Partial<CloseFigures>): CloseFigures => ({ ...october, ...over });
const noTwoKeys = (over: Partial<Extract<CloseException, { kind: "no_two_key_record" }>> = {}): CloseException => ({
  kind: "no_two_key_record",
  count: 1,
  totalCents: 41_250,
  rowIds: ["L03"],
  firstSignedRequestDate: "2026-11-02",
  ...over,
});

describe("formatting", () => {
  it("formats cents as dollars, with the sign in the text as a true minus", () => {
    expect(money(436_875)).toBe("$4,368.75");
    expect(money(0)).toBe("$0.00");
    expect(signedMoney(417_500, "+")).toBe("+$4,175.00");
    expect(signedMoney(-235_525, "−")).toBe("−$2,355.25");
  });

  it("writes ISO dates as short days, without the locale or a time zone", () => {
    expect(shortDay("2026-10-01")).toBe("Oct 1");
    expect(shortDay("2026-12-31")).toBe("Dec 31");
  });

  it("pluralises by count", () => {
    expect(plural(1, "deposit", "deposits")).toBe("1 deposit");
    expect(plural(0, "deposit", "deposits")).toBe("0 deposits");
  });

  it("labels the draft without naming a vendor", () => {
    expect(DRAFT_LABEL).toBe("Drafted by the AI (recorded)");
  });
});

describe("the statement", () => {
  it("reads opening + in − out = closing from the computed figures", () => {
    expect(statementCells(october)).toEqual([
      { key: "opening", label: "Opening balance", value: "$2,549.00", note: "Oct 1" },
      { key: "in", label: "Money in", value: "+$4,175.00", note: "4 deposits" },
      { key: "out", label: "Money out", value: "−$2,355.25", note: "7 payments" },
      { key: "closing", label: "Closing balance", value: "$4,368.75", note: "Oct 31" },
    ]);
  });

  it("proves the month carries forward to the account balance, with its as-of time in the club's zone", () => {
    expect(carriedForwardLine(october)).toEqual({
      ok: true,
      text: "Carries forward: $4,368.75 + $630.00 completed after Oct 31 = $4,998.75, the club account's balance as of Nov 3, 10:30 AM CST.",
    });
  });

  it("says plainly when it doesn't carry forward", () => {
    const off = withFigures({ carriedForward: { ...october.carriedForward, balanceCents: 500_000, reconciles: false } });
    expect(carriedForwardLine(off)).toEqual({
      ok: false,
      text: "Doesn't carry forward: $4,368.75 + $630.00 completed after Oct 31 = $4,998.75, but the club account's balance as of Nov 3, 10:30 AM CST is $5,000.00.",
    });
  });

  it("states the open items at month end, none or their total", () => {
    expect(openItemsLine(october)).toBe("Open at month end: none. No payout was waiting for a second key on Oct 31.");
    const open = withFigures({
      openItems: [
        { rowId: "P1", date: "2026-10-31", description: "Cones", counterparty: "Riverbend Team Supply", amountCents: 4_800, requestedBy: "treasurer" },
        { rowId: "P2", date: "2026-10-30", description: "Paint", counterparty: "Bluebird Hardware", amountCents: 1_250, requestedBy: "secretary" },
      ],
    });
    expect(openItemsLine(open)).toBe("Open at month end: 2 payouts ($60.50) waiting for a second key on Oct 31.");
  });

  it("counts every October payment as two-key approved, and says they are demo data", () => {
    expect(twoKeyLine(october)).toEqual({ ok: true, text: "Two keys: all 7 payments out are approved by two officers (demo data, taken as approved)." });
  });

  it("names the payments signed in TwoKey apart from the demo data, and leaves the basis out when none is demo data", () => {
    expect(twoKeyLine(withFigures({ twoKeyRecord: { payments: 7, signed: 2, seedApproved: 5 } })).text).toBe(
      "Two keys: all 7 payments out are approved by two officers (5 are demo data, taken as approved).",
    );
    expect(twoKeyLine(withFigures({ twoKeyRecord: { payments: 7, signed: 7, seedApproved: 0 } })).text).toBe("Two keys: all 7 payments out are approved by two officers.");
    expect(twoKeyLine(withFigures({ twoKeyRecord: { payments: 1, signed: 1, seedApproved: 0 } })).text).toBe("Two keys: the one payment out is approved by two officers.");
  });

  it("points a payment without two keys at the exceptions", () => {
    expect(twoKeyLine(withFigures({ twoKeyRecord: { payments: 8, signed: 0, seedApproved: 7 } }))).toEqual({
      ok: false,
      text: "Two keys: 7 of 8 payments out are approved by two officers (7 are demo data, taken as approved). 1 payment is under Exceptions.",
    });
    expect(twoKeyLine(withFigures({ twoKeyRecord: { payments: 3, signed: 0, seedApproved: 0 } })).text).toBe(
      "Two keys: 0 of 3 payments out are approved by two officers. 3 payments are under Exceptions.",
    );
  });

  it("says so when nothing went out", () => {
    expect(twoKeyLine(withFigures({ twoKeyRecord: { payments: 0, signed: 0, seedApproved: 0 } }))).toEqual({ ok: true, text: "Two keys: no payments went out this month." });
  });

  it("answers the title row: does the month add up, and how much is left for the Reviewer", () => {
    expect(closeFinding(october)).toBe("October adds up and closes at $4,368.75. 1 exception to check before the Reviewer signs.");
    expect(closeFinding(withFigures({ exceptions: [] }))).toBe("October adds up and closes at $4,368.75. Nothing needs a second look before the Reviewer signs.");
    const off = withFigures({ carriedForward: { ...october.carriedForward, reconciles: false }, exceptions: [...october.exceptions, noTwoKeys()] });
    expect(closeFinding(off)).toBe("October doesn't carry forward to the account balance. 2 exceptions to check before the Reviewer signs.");
  });
});

describe("the exceptions", () => {
  it("shows the car-wash gap as a shortfall in the data maroon, with the arithmetic", () => {
    expect(october.exceptions).toHaveLength(1);
    expect(exceptionView(october.exceptions[0]!, october)).toEqual({
      key: "gap-car-wash",
      title: "Car wash, Oct 24",
      figure: "−$1,290.00",
      shortfall: true,
      lines: ["87 cars logged × $15.00 = $1,305.00 expected.", "$15.00 received; $1,290.00 has no record."],
    });
  });

  it("asks for paper approvals when every unsigned payment predates TwoKey's first signed request", () => {
    expect(exceptionView(noTwoKeys(), october)).toEqual({
      key: "no-two-key-record",
      title: "Paid with no two-key record",
      figure: "$412.50",
      shortfall: false,
      lines: ["1 payment out has no two officers' signatures on record.", "All predate TwoKey's first signed request (Nov 2): check them against the officers' paper approvals."],
    });
  });

  it("asks only for the approvals when a payment is on or after TwoKey's first signed request, or there is none", () => {
    expect(exceptionView(noTwoKeys({ firstSignedRequestDate: "2026-10-01" }), october).lines[1]).toBe("Check them against the officers' approvals.");
    expect(exceptionView(noTwoKeys({ firstSignedRequestDate: null }), october).lines[1]).toBe("Check them against the officers' approvals.");
  });

  it("names an overspent line and a payment on no budget line", () => {
    expect(exceptionView({ kind: "over_budget", budgetLine: "facilities", label: "Facilities", approvedCents: 40_000, spentCents: 45_000, overCents: 5_000 }, october)).toEqual({
      key: "over-facilities",
      title: "Facilities over budget",
      figure: "−$50.00",
      shortfall: false,
      lines: ["$450.00 paid against $400.00 approved for the season."],
    });
    expect(exceptionView({ kind: "no_budget_line", rowId: "X2", category: "gifts", description: "Gift cards", amountCents: 2_500 }, october)).toEqual({
      key: "nobudget-X2",
      title: "Paid from no budget line",
      figure: "$25.00",
      shortfall: false,
      lines: ["Gift cards: its category, gifts, is on no budget line."],
    });
  });
});

describe("October, row by row", () => {
  const [moneyIn, moneyOut] = ledgerSections(october);

  it("lists the deposits with what each fundraiser was expected to take, and the car wash short", () => {
    expect(moneyIn).toMatchObject({ key: "in", title: "Money in", count: "4 deposits", total: "+$4,175.00" });
    expect(moneyIn!.rows.map((row) => row.key)).toEqual(["L02", "L04", "L07", "L10"]);
    expect(moneyIn!.rows[0]).toMatchObject({ date: "Oct 3", against: null, short: null, amount: "$1,800.00" });
    expect(moneyIn!.rows[3]).toMatchObject({ date: "Oct 24", against: "$1,305.00 expected", short: "$1,290.00 short", amount: "$15.00" });
    expect(moneyIn!.rows[1]).toMatchObject({ against: "$1,280.00 expected", short: null });
  });

  it("lists the payments by date, each against its budget line", () => {
    expect(moneyOut).toMatchObject({ key: "out", title: "Money out", count: "7 payments", total: "−$2,355.25" });
    expect(moneyOut!.rows.map((row) => row.key)).toEqual(["L03", "L05", "L06", "L08", "L09", "L11", "L12"]);
    expect(moneyOut!.rows[0]).toMatchObject({ date: "Oct 5", against: "Equipment", short: null, amount: "$412.50" });
    expect(moneyOut!.rows[2]).toMatchObject({ date: "Oct 12", against: "Fundraising costs" });
  });
});

describe("the budget lines", () => {
  const rows = budgetRows(october);

  it("draws each line at its true share of the season's approval", () => {
    expect(rows.find((row) => row.key === "equipment")).toEqual({
      key: "equipment",
      label: "Equipment",
      figures: "$412.50 of $700.00",
      spentZero: false,
      share: 412.5 / 700,
      meta: "1 payment · $287.50 left",
    });
    expect(rows.find((row) => row.key === "fundraising-costs")).toMatchObject({ meta: "3 payments · $51.25 left" });
  });

  it("prints a line with nothing paid as a real zero", () => {
    expect(rows.find((row) => row.key === "banquet")).toMatchObject({ figures: "$0.00 of $300.00", spentZero: true, share: 0, meta: "No payments · $300.00 left" });
  });

  it("draws an overrun full and says how far over", () => {
    const over = budgetRows(withFigures({ budgetLines: [{ ...october.budgetLines[1]!, spentCents: 45_000, leftCents: -5_000 }] }));
    expect(over[0]).toMatchObject({ share: 1, meta: "1 payment · $50.00 over" });
  });

  it("totals the season's approval", () => {
    expect(approvedTotal(october)).toBe(october.budgetLines.reduce((sum, line) => sum + line.approvedCents, 0));
    expect(money(approvedTotal(october))).toBe("$3,700.00");
  });
});

describe("the sign-off's words", () => {
  it("names every role, and the button by the acting role", () => {
    expect(["president", "treasurer", "secretary", "reviewer", "parent"].map((role) => roleName(role as never))).toEqual(["President", "Treasurer", "Secretary", "Reviewer", "Parent"]);
    expect(signButtonLabel("reviewer", false)).toBe("Sign as Reviewer");
    expect(signButtonLabel("treasurer", true)).toBe("Signing…");
  });

  it("hints, never locks: only the Reviewer is expected to succeed", () => {
    expect(signHint("reviewer")).toEqual({ text: "Your demo key signs this close's hash. Change any figure and the signature no longer matches it.", expectRefusal: false });
    for (const role of ["president", "treasurer", "secretary", "parent"] as const) {
      expect(signHint(role)).toEqual({ text: "Only the Reviewer, a non-signer, signs the close. The server refuses every other role.", expectRefusal: true });
    }
  });

  it("states the signature by role and key, and shortens a hash for a sentence", () => {
    expect(signatureLine({ title: "Reviewer", keyId: "4951e1dd" })).toBe("Signed by the Reviewer · demo key 4951e1dd");
    expect(shortHash("70f5a1c5853aaddb0c2635fe08f515f8fe6b51827c2fc10c77584299dc1c3548")).toBe("70f5a1c5…");
    expect(shortHash("abc")).toBe("abc");
  });
});
