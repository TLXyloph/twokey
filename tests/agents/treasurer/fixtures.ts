/** Builders for the treasurer-agent tests. */
import type { TreasurerAnswer } from "@/agents/treasurer/answer";
import type { TreasurerFacts } from "@/agents/treasurer/prompt";

export const paintAnswer = (over: Partial<TreasurerAnswer> = {}): TreasurerAnswer => ({
  vendor: "Bluebird Hardware",
  date: "2026-11-02",
  items: [
    { description: "Field marking paint white, 2 at $12.25", amountCents: 2450 },
    { description: "Patio string lights 24ft", amountCents: 1200 },
  ],
  totalCents: 3650,
  matchesRequest: true,
  findings: [
    {
      severity: "warn",
      text: "The receipt includes patio string lights, which aren't a field-maintenance cost.",
      evidence: "Receipt line 2: patio string lights, $12.00",
    },
  ],
  verdict: "check",
  summary: "The total matches, but $12.00 of it is patio string lights, not field paint.",
  ...over,
});

export const paintFacts = (over: Partial<TreasurerFacts> = {}): TreasurerFacts => ({
  payeeName: "Esther Huang (Treasurer), reimbursement",
  payeeOfficerTitle: "Treasurer",
  amountCents: 3650,
  description: "Field-paint reimbursement",
  budgetLine: { label: "Field maintenance", approvedCents: 15_000, leftCents: 15_000 },
  requestedByTitle: "Secretary",
  requestedOn: "Tuesday, November 3, 2026",
  officers: [
    { title: "Treasurer", name: "Esther Huang", address: "212 Willow Bend Rd, Riverbend" },
    { title: "President", name: "Marcus Bell", address: "48 Cedar Hollow Ln, Riverbend" },
  ],
  ruleFindings: [{ severity: "warn", text: "This pays an officer, the Treasurer.", evidence: "Payee: Esther Huang (Treasurer), reimbursement", source: "rule" }],
  ruleVerdict: "check",
  ...over,
});
