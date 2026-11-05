import { describe, expect, it } from "vitest";
import { riverbend } from "@/demo/riverbend";
import { BUDGET_LINES } from "@/demo/riverbend-policy";
import type { RiskFinding } from "@/ledger/contracts";
import { wordCount } from "@/disbursements/risk/format";
import { budgetStanding, buildRulesCard, ruleFindings, stricterVerdict, verdictOf } from "@/disbursements/risk/rules";
import { fakeContext, request } from "./fixtures";

const NOW = new Date("2026-11-05T17:00:00.000Z");
const ctx = fakeContext();
const only = (findings: RiskFinding[]) => findings.map((finding) => [finding.severity, finding.source]);

describe("the officer check", () => {
  it("warns when the payee is an officer, and names the officer", () => {
    const paint = request({ payeeId: "treasurer-reimbursement", payeeName: "Esther Huang (Treasurer), reimbursement", requestedBy: "secretary" });
    const findings = ruleFindings({ request: paint, sessionRequests: [paint] }, ctx);
    expect(only(findings)).toEqual([["warn", "rule"]]);
    expect(findings[0]!.text).toMatch(/officer/i);
    expect(findings[0]!.text).toMatch(/treasurer/i);
    expect(findings[0]!.evidence).toContain("Esther Huang (Treasurer), reimbursement");
  });

  it("doesn't flag the same officer twice for sharing her own surname", () => {
    const paint = request({ payeeId: "treasurer-reimbursement", payeeName: "Esther Huang (Treasurer), reimbursement" });
    expect(ruleFindings({ request: paint, sessionRequests: [] }, ctx)).toHaveLength(1);
  });

  it("warns when a non-officer payee shares an officer's surname, as a whole word only", () => {
    const bell = request({ payeeName: "Bell Field Services" });
    const findings = ruleFindings({ request: bell, sessionRequests: [] }, ctx);
    expect(only(findings)).toEqual([["warn", "rule"]]);
    expect(findings[0]!.text).toMatch(/surname/i);
    expect(findings[0]!.evidence).toContain("Marcus Bell");
    expect(ruleFindings({ request: request({ payeeName: "Bellows Supply" }), sessionRequests: [] }, ctx)).toEqual([]);
  });

  it("warns when the payee's address on file is an officer's address", () => {
    const withAddress = fakeContext({
      payees: [{ id: "team-supply", name: "Riverbend Team Supply", role: null, address: "9 quarry st, Riverbend" }],
    });
    const findings = ruleFindings({ request: request(), sessionRequests: [] }, withAddress);
    expect(only(findings)).toEqual([["warn", "rule"]]);
    expect(findings[0]!.text).toMatch(/address/i);
    expect(findings[0]!.evidence).toContain("9 Quarry St");
  });
});

describe("the budget check", () => {
  it("works out what's left: approved, minus completed spend in the seed, minus other requests on the line", () => {
    const mine = request({ requestId: "mine", amountCents: 300 });
    const other = request({ requestId: "other", amountCents: 250, createdAt: "2026-10-01T15:00:00Z" });
    const elsewhere = request({ requestId: "elsewhere", budgetLine: "field-maintenance", amountCents: 999 });
    const standing = budgetStanding({ request: mine, sessionRequests: [mine, other, elsewhere] }, ctx);
    expect(standing).toMatchObject({ approvedCents: 10_000, spentCents: 9_000, otherRequestsCents: 250, leftCents: 750 });
  });

  it("stops a request over what's left, with the figures as evidence", () => {
    const big = request({ amountCents: 1001 });
    const findings = ruleFindings({ request: big, sessionRequests: [big] }, ctx);
    expect(only(findings)).toEqual([["stop", "rule"]]);
    expect(findings[0]!.text).toMatch(/budget/i);
    expect(findings[0]!.evidence).toContain("$100.00 approved");
    expect(findings[0]!.evidence).toContain("$90.00 spent");
    expect(findings[0]!.evidence).toContain("$10.00 left");
    expect(findings[0]!.evidence).toContain("$10.01");
  });

  it("lets a request that uses exactly what's left through", () => {
    expect(ruleFindings({ request: request({ amountCents: 1000 }), sessionRequests: [] }, ctx)).toEqual([]);
  });

  it("reads the real seed: completed spend on the line's category, per the club's budget policy", () => {
    const equipment = BUDGET_LINES.find((line) => line.id === "equipment")!;
    const spent = riverbend.ledger
      .filter((row) => row.status === "completed" && row.direction === "out" && row.category === equipment.category)
      .reduce((sum, row) => sum + Math.round(-row.amount * 100), 0);
    const gloves = request({ amountCents: 4200 });
    expect(budgetStanding({ request: gloves, sessionRequests: [gloves] })).toMatchObject({
      approvedCents: equipment.approvedCents,
      spentCents: spent,
      leftCents: equipment.approvedCents - spent,
    });
  });
});

describe("the split check", () => {
  const at = (day: number) => `2026-11-${String(day).padStart(2, "0")}T15:00:00.000Z`;

  it("warns when the same payee has two or more requests within 7 days that together exceed $50", () => {
    const gloves = request({ requestId: "gloves", amountCents: 2000, description: "Goalkeeper gloves", createdAt: at(2) });
    const cones = request({ requestId: "cones", amountCents: 3100, description: "Practice cones", createdAt: at(4) });
    const findings = ruleFindings({ request: cones, sessionRequests: [gloves, cones] }, fakeContext({ budgetLines: [] }));
    const split = findings.find((finding) => /split|add up/i.test(finding.text));
    expect(split).toMatchObject({ severity: "warn", source: "rule" });
    expect(split!.evidence).toContain("Nov 2: $20.00 (Goalkeeper gloves)");
    expect(split!.evidence).toContain("Nov 4: $31.00 (Practice cones)");
    expect(split!.evidence).toContain("$51.00");
  });

  it("ignores exactly $50, other payees and requests more than 7 days apart", () => {
    const base = request({ requestId: "base", amountCents: 2500, createdAt: at(10) });
    const equal = request({ requestId: "equal", amountCents: 2500, createdAt: at(11) });
    const otherPayee = request({ requestId: "other", payeeId: "treasurer-reimbursement", amountCents: 4000, createdAt: at(11) });
    const longAgo = request({ requestId: "old", amountCents: 4000, createdAt: "2026-11-02T14:59:00.000Z" });
    const noBudget = fakeContext({ budgetLines: [] });
    const findings = ruleFindings({ request: base, sessionRequests: [base, equal, otherPayee, longAgo] }, noBudget);
    expect(findings.filter((finding) => finding.text.includes("7 days"))).toEqual([]);
  });

  it("counts the request itself once, whether or not it is in the session list", () => {
    const one = request({ requestId: "one", amountCents: 4900 });
    expect(ruleFindings({ request: one, sessionRequests: [one, one] }, fakeContext({ budgetLines: [] }))).toEqual([]);
  });
});

describe("the round-amount signal", () => {
  const paintTo = (amountCents: number) =>
    request({ payeeId: "treasurer-reimbursement", payeeName: "Esther Huang (Treasurer), reimbursement", amountCents });

  it("adds an info finding for a round amount of $40 or more, but only alongside another flag", () => {
    const findings = ruleFindings({ request: paintTo(4200), sessionRequests: [] }, ctx);
    expect(only(findings)).toEqual([
      ["stop", "rule"],
      ["warn", "rule"],
      ["info", "rule"],
    ]);
    expect(findings[2]!.evidence).toContain("$42.00");
  });

  it("stays silent on its own, below $40, or with cents", () => {
    const roomy = fakeContext({ budgetLines: [{ id: "equipment", label: "Equipment", category: "equipment", approvedCents: 1_000_000 }] });
    expect(ruleFindings({ request: request({ amountCents: 4200 }), sessionRequests: [] }, roomy)).toEqual([]);
    expect(ruleFindings({ request: paintTo(3900), sessionRequests: [] }, roomy).map((f) => f.severity)).toEqual(["warn"]);
    expect(ruleFindings({ request: paintTo(4250), sessionRequests: [] }, roomy).map((f) => f.severity)).toEqual(["warn"]);
  });
});

describe("the rules card", () => {
  it("is clear with no findings, and says so in plain words", () => {
    const card = buildRulesCard({ request: request({ amountCents: 500 }), sessionRequests: [] }, NOW, ctx);
    expect(card).toEqual({
      verdict: "clear",
      summary: expect.any(String),
      findings: [],
      receipt: null,
      matchesRequest: null,
      origin: "rules",
      model: null,
      checkedAt: "2026-11-05T17:00:00.000Z",
    });
    expect(card.summary).toMatch(/no rule flags/i);
  });

  it("takes its verdict from the worst finding, and keeps the summary to 25 words", () => {
    const everything = request({
      payeeId: "treasurer-reimbursement",
      payeeName: "Esther Huang Bell Natarajan (Treasurer), reimbursement",
      amountCents: 4000,
    });
    const card = buildRulesCard({ request: everything, sessionRequests: [everything, request({ requestId: "x", payeeId: "treasurer-reimbursement", amountCents: 2000 })] }, NOW, ctx);
    expect(card.verdict).toBe("stop");
    expect(card.findings.length).toBeGreaterThanOrEqual(5);
    expect(wordCount(card.summary)).toBeLessThanOrEqual(25);
  });

  it("is check when the worst finding is a warning", () => {
    const paint = request({ payeeId: "treasurer-reimbursement", payeeName: "Esther Huang (Treasurer), reimbursement", amountCents: 500 });
    const card = buildRulesCard({ request: paint, sessionRequests: [paint] }, NOW, ctx);
    expect(card.verdict).toBe("check");
    expect(card.summary).toMatch(/officer/i);
  });
});

describe("verdicts", () => {
  it("orders clear < check < stop", () => {
    expect(verdictOf([])).toBe("clear");
    expect(verdictOf([{ severity: "info", text: "", evidence: "", source: "rule" }])).toBe("clear");
    expect(verdictOf([{ severity: "warn", text: "", evidence: "", source: "ai" }])).toBe("check");
    expect(stricterVerdict("clear", "check")).toBe("check");
    expect(stricterVerdict("stop", "check")).toBe("stop");
    expect(stricterVerdict("clear", "clear")).toBe("clear");
  });
});
