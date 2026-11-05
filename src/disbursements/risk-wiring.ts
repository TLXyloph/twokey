/**
 * Where the routes get their `RiskAssessor` (the Risk context's port, contracts.ts).
 *
 * STUB until integration: the Risk context (src/disbursements/risk/) builds the real assessor
 * (rule checks, the AI receipt read behind the AI budget gates, recorded cards), and this function
 * is rewired to return it. Until then every request gets a "clear" rules card that says the
 * receipt check isn't wired, and the AI read reports "unavailable" (null), so the rules card stands.
 */
import type { RiskAssessor, RiskCard } from "@/ledger/contracts";

export const STUB_RULES_SUMMARY = "Receipt check not wired yet.";

/** The Worker env the real assessor will read (AI key, budget vars, D1); unused by the stub. */
export type RiskWiringEnv = Partial<CloudflareEnv>;

export function riskAssessorFor(_env: RiskWiringEnv): RiskAssessor {
  return {
    rulesCard(_input, now): RiskCard {
      return {
        verdict: "clear",
        summary: STUB_RULES_SUMMARY,
        findings: [],
        receipt: null,
        matchesRequest: null,
        origin: "rules",
        model: null,
        checkedAt: now.toISOString(),
      };
    },
    async aiCard() {
      return null;
    },
  };
}
