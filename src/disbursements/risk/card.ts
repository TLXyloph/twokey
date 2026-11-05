/**
 * The bridge between the Risk context and the treasurer agent: the facts the agent reads, and the
 * final card built from the rules card plus the agent's answer.
 *
 * The final card keeps every rule finding and adds the AI's (source "ai"). Its verdict is the
 * strictest of: the rules' verdict, the AI's verdict, the AI's own findings, and "check" when the
 * receipt doesn't match the request. The AI is advisory: this only decides whether the second
 * signer must tick "I've read the flags"; it never blocks the executor.
 */
import type { TreasurerAnswer } from "@/agents/treasurer/answer";
import type { TreasurerFacts } from "@/agents/treasurer/prompt";
import type { RiskCard, RiskFinding, RiskInput } from "@/ledger/contracts";
import { clubDate } from "./format";
import { budgetStanding, officerTitle, stricterVerdict, verdictOf, type RulesContext } from "./rules";

const SEVERITY_RANK: Readonly<Record<RiskFinding["severity"], number>> = { stop: 0, warn: 1, info: 2 };

/** What the agent reads about a request. Only facts that are the same in every session. */
export function treasurerFacts(input: RiskInput, rules: RiskCard, ctx: RulesContext): TreasurerFacts {
  const { request } = input;
  const payee = ctx.payees.find((entry) => entry.id === request.payeeId);
  const standing = budgetStanding(input, ctx);
  return {
    payeeName: request.payeeName,
    payeeOfficerTitle: payee?.role ? officerTitle(payee.role) : null,
    amountCents: request.amountCents,
    description: request.description,
    budgetLine: standing && { label: standing.line.label, approvedCents: standing.approvedCents, leftCents: standing.leftCents },
    requestedByTitle: officerTitle(request.requestedBy),
    requestedOn: clubDate(request.createdAt)?.long ?? "an unknown date",
    officers: ctx.officers.map((officer) => ({ title: officerTitle(officer.role), name: officer.name, address: officer.address })),
    ruleFindings: rules.findings,
    ruleVerdict: rules.verdict,
  };
}

export interface CardMeta {
  origin: "live" | "recorded" | "replay";
  model: string;
  checkedAt: string;
}

export function mergeCard(rules: RiskCard, answer: TreasurerAnswer, meta: CardMeta): RiskCard {
  const aiFindings: RiskFinding[] = answer.findings.map((finding) => ({ ...finding, source: "ai" }));
  const findings = [...rules.findings, ...aiFindings].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  let verdict = stricterVerdict(rules.verdict, stricterVerdict(answer.verdict, verdictOf(aiFindings)));
  if (!answer.matchesRequest) verdict = stricterVerdict(verdict, "check");
  return {
    verdict,
    summary: answer.summary,
    findings,
    receipt: { vendor: answer.vendor, date: answer.date, items: answer.items, totalCents: answer.totalCents },
    matchesRequest: answer.matchesRequest,
    origin: meta.origin,
    model: meta.model,
    checkedAt: meta.checkedAt,
  };
}
