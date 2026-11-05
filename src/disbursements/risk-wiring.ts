/**
 * Where the routes get their `RiskAssessor` (the Risk context's port, contracts.ts): the real one,
 * with the rule checks, the recorded cards for the seeded requests, and the AI receipt read behind
 * the same budget gates as /api/ai/turn (src/disbursements/risk/index.ts).
 */
import type { RiskAssessor } from "@/ledger/contracts";
import { riskAssessorFromEnv, type RiskEnv } from "./risk";

/** The Worker env the assessor reads: the AI key and budget vars, D1 and the ASSETS binding. */
export type RiskWiringEnv = Partial<CloudflareEnv>;

export function riskAssessorFor(env: RiskWiringEnv): RiskAssessor {
  return riskAssessorFromEnv(env as RiskEnv, env.DB);
}
