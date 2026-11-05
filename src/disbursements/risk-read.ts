/**
 * `POST …/risk`: the AI receipt read, at most once per request (idempotency key
 * `ai-risk:${requestHash}`). Its card is appended as `risk.assessed` and supersedes the rules card.
 * When the AI is unavailable (the assessor answers null, or fails), the rules card stands: it is
 * appended again with an AI-sourced note saying so, which records the attempt in the ledger and
 * ends `riskPending` (src/ledger/request-projection.ts).
 */
import type { RiskAssessor, RiskCard, RiskFinding } from "@/ledger/contracts";
import type { TwoKeyLedgerStore } from "@/ledger/ledger-store";
import { currentRisk, findRequest, isRiskPending, projectRequests } from "@/ledger/request-projection";
import { appendRiskCard, keys } from "./request-steps";

export const AI_UNAVAILABLE_FINDING: RiskFinding = {
  severity: "info",
  text: "The AI couldn't read the receipt just now, so only the rule checks apply.",
  evidence: "AI receipt read unavailable",
  source: "ai",
};

export interface RiskReadDeps {
  ledger: TwoKeyLedgerStore;
  risk: RiskAssessor;
  now: () => Date;
  log?(line: string): void;
}

export type RiskReadOutcome = "unknown_request" | "already_done" | "ai_card" | "rules_stand";

export async function runRiskRead(deps: RiskReadDeps, sessionId: string, requestId: string): Promise<RiskReadOutcome> {
  const events = await deps.ledger.read(sessionId);
  const state = findRequest(events, requestId);
  if (!state) return "unknown_request";
  if (!isRiskPending(state)) return "already_done";
  const input = { request: state.request, sessionRequests: projectRequests(events).map((s) => s.request) };
  let card: RiskCard | null = null;
  try {
    card = await deps.risk.aiCard(input, sessionId, deps.now());
  } catch {
    deps.log?.("[payouts/risk] ai_card_error");
    card = null;
  }
  const outcome: RiskReadOutcome = card ? "ai_card" : "rules_stand";
  if (!card) {
    const rules = currentRisk(state)?.card ?? deps.risk.rulesCard(input, deps.now());
    card = { ...rules, findings: [...rules.findings, AI_UNAVAILABLE_FINDING], checkedAt: deps.now().toISOString() };
  }
  await appendRiskCard((event) => deps.ledger.append(sessionId, event), state.request, card, keys.aiRisk(state.request.requestHash));
  return outcome;
}
