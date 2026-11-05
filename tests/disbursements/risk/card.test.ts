import { describe, expect, it } from "vitest";
import type { RiskCard } from "@/ledger/contracts";
import { mergeCard, treasurerFacts } from "@/disbursements/risk/card";
import { buildRulesCard } from "@/disbursements/risk/rules";
import { paintAnswer } from "../../agents/treasurer/fixtures";
import { fakeContext, request } from "./fixtures";

const NOW = new Date("2026-11-05T17:00:00.000Z");
const ctx = fakeContext();
const meta = { origin: "live" as const, model: "claude-opus-5-5", checkedAt: "2026-11-05T17:00:05.000Z" };

const rulesCard = (over: Partial<RiskCard> = {}): RiskCard => ({
  verdict: "clear",
  summary: "No rule flags.",
  findings: [],
  receipt: null,
  matchesRequest: null,
  origin: "rules",
  model: null,
  checkedAt: NOW.toISOString(),
  ...over,
});

describe("mergeCard", () => {
  it("keeps the rule findings, adds the AI's (marked ai), and takes the AI's reading and summary", () => {
    const officer = { severity: "warn" as const, text: "This pays an officer, the Treasurer.", evidence: "Payee: x", source: "rule" as const };
    const card = mergeCard(rulesCard({ verdict: "check", findings: [officer] }), paintAnswer(), meta);
    expect(card).toEqual({
      verdict: "check",
      summary: paintAnswer().summary,
      findings: [officer, { ...paintAnswer().findings[0], source: "ai" }],
      receipt: { vendor: "Bluebird Hardware", date: "2026-11-02", items: paintAnswer().items, totalCents: 3650 },
      matchesRequest: true,
      origin: "live",
      model: "claude-opus-5-5",
      checkedAt: "2026-11-05T17:00:05.000Z",
    });
  });

  it("takes the stricter verdict: the rules can raise the AI's, and the AI can raise the rules'", () => {
    expect(mergeCard(rulesCard({ verdict: "stop" }), paintAnswer({ verdict: "check" }), meta).verdict).toBe("stop");
    expect(mergeCard(rulesCard({ verdict: "clear" }), paintAnswer({ verdict: "stop" }), meta).verdict).toBe("stop");
  });

  it("doesn't let the AI's verdict be milder than its own findings, or than a receipt that doesn't match", () => {
    expect(mergeCard(rulesCard(), paintAnswer({ verdict: "clear" }), meta).verdict).toBe("check");
    expect(mergeCard(rulesCard(), paintAnswer({ verdict: "clear", findings: [], matchesRequest: false }), meta).verdict).toBe("check");
    expect(mergeCard(rulesCard(), paintAnswer({ verdict: "clear", findings: [] }), meta).verdict).toBe("clear");
  });

  it("lists findings worst first, rules before the AI within a severity", () => {
    const info = { severity: "info" as const, text: "i", evidence: "e", source: "rule" as const };
    const answer = paintAnswer({ findings: [{ severity: "stop", text: "s", evidence: "e" }, { severity: "info", text: "j", evidence: "e" }], verdict: "stop" });
    const card = mergeCard(rulesCard({ findings: [info] }), answer, meta);
    expect(card.findings.map((finding) => `${finding.severity}:${finding.source}`)).toEqual(["stop:ai", "info:rule", "info:ai"]);
  });
});

describe("treasurerFacts", () => {
  it("states the request in the club's terms: titles, budget left, club date and the rule results", () => {
    const paint = request({
      payeeId: "treasurer-reimbursement",
      payeeName: "Esther Huang (Treasurer), reimbursement",
      amountCents: 3650,
      description: "Field-paint reimbursement",
      budgetLine: "field-maintenance",
      requestedBy: "secretary",
      createdAt: "2026-11-03T15:00:00.000Z",
    });
    const input = { request: paint, sessionRequests: [paint] };
    const rules = buildRulesCard(input, NOW, ctx);
    expect(treasurerFacts(input, rules, ctx)).toEqual({
      payeeName: "Esther Huang (Treasurer), reimbursement",
      payeeOfficerTitle: "Treasurer",
      amountCents: 3650,
      description: "Field-paint reimbursement",
      budgetLine: { label: "Field maintenance", approvedCents: 5_000, leftCents: 5_000 },
      requestedByTitle: "Secretary",
      requestedOn: "Tuesday, November 3, 2026",
      officers: [
        { title: "Treasurer", name: "Esther Huang", address: "212 Willow Bend Rd, Riverbend" },
        { title: "President", name: "Marcus Bell", address: "48 Cedar Hollow Ln, Riverbend" },
        { title: "Secretary", name: "Priya Natarajan", address: "9 Quarry St, Riverbend" },
      ],
      ruleFindings: rules.findings,
      ruleVerdict: "check",
    });
  });

  it("carries nothing session-specific: no session id, request id, request hash, email or receipt hash", () => {
    const mine = request({ requestId: "req-UNIQUE-1", requestHash: "f".repeat(64), receiptSha256: "e".repeat(64), payeeEmail: "x@business.example.com" });
    const input = { request: mine, sessionRequests: [mine] };
    const text = JSON.stringify(treasurerFacts(input, buildRulesCard(input, NOW, ctx), ctx));
    for (const secret of ["req-UNIQUE-1", "f".repeat(16), "e".repeat(16), "x@business.example.com", "2026-11-04T15:00"]) {
      expect(text).not.toContain(secret);
    }
  });
});
