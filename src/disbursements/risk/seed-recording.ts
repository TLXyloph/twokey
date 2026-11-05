/**
 * Recording the seeded requests' AI cards (development only; run through
 * scripts/record-seed-risk-cards.sh). Each seed request is checked exactly as the site checks it
 * (same rules context, facts, prompt and so the same replay key), and the validated answer is
 * stored under that key in recorded-cards.json. The site then serves it as a "recorded" card,
 * with no call and no reservation.
 *
 * Live calls here bypass the site's D1 gates on purpose: the person running the script approves
 * the spend, and the script prints the estimate first and the actual cost after.
 */
import { replayKey } from "@/agents/llm/replay-key";
import type { AnthropicLike } from "@/agents/llm/run-turn";
import { createTurnMeter, worstCaseMicroUsd } from "@/agents/llm/turn-cost";
import { parseAnswer, type AnswerProblem } from "@/agents/treasurer/answer";
import { callFailureCode, callTreasurer } from "@/agents/treasurer/call";
import { buildTreasurerParams } from "@/agents/treasurer/prompt";
import type { BetaMessageStreamParams } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { MAX_ATTEMPTS } from "./ai-card";
import { treasurerFacts } from "./card";
import type { RecordedCardEntry } from "./recorded";
import { loadReceiptImage, type ReceiptImages } from "./receipt-images";
import { RECEIPTS } from "./receipts";
import { buildRulesCard, DEMO_RULES_CONTEXT } from "./rules";
import { SEED_RISK_REQUESTS, SEED_SESSION_REQUESTS } from "./seed-requests";

export interface SeedPlan {
  label: string;
  key: string;
  params: BetaMessageStreamParams;
  /** What the site's gate would reserve for one attempt (a loose upper bound). */
  worstCaseMicroUsd: number;
}

/** The two seed checks as the site would build them, with their replay keys. No network. */
export async function planSeedRecordings(images: ReceiptImages, model: string, now: Date): Promise<SeedPlan[]> {
  const plans: SeedPlan[] = [];
  for (const seed of SEED_RISK_REQUESTS) {
    const input = { request: seed.request, sessionRequests: [...SEED_SESSION_REQUESTS] };
    const rules = buildRulesCard(input, now, DEMO_RULES_CONTEXT);
    const image = await loadReceiptImage(images, RECEIPTS[seed.request.receiptId]);
    const params = buildTreasurerParams(treasurerFacts(input, rules, DEMO_RULES_CONTEXT), image, model);
    plans.push({ label: seed.label, key: await replayKey(params), params, worstCaseMicroUsd: worstCaseMicroUsd(params) });
  }
  return plans;
}

export interface SeedRecordingResult {
  label: string;
  key: string;
  outcome: "recorded" | "already_recorded" | "failed";
  /** The answer's verdict, when recorded. */
  verdict?: string;
  /** Why it failed: the last attempt's problem or upstream error code. */
  problem?: AnswerProblem | string;
  attempts: number;
  costMicroUsd: number;
}

export interface SeedRecordingDeps {
  client: AnthropicLike;
  now(): number;
}

/** Calls the model for each plan not already in `existing`; returns the new file contents. */
export async function recordSeedCards(
  deps: SeedRecordingDeps,
  plans: readonly SeedPlan[],
  existing: Readonly<Record<string, RecordedCardEntry>>,
): Promise<{ entries: Record<string, RecordedCardEntry>; results: SeedRecordingResult[] }> {
  const entries: Record<string, RecordedCardEntry> = { ...existing };
  const results: SeedRecordingResult[] = [];
  for (const plan of plans) {
    if (existing[plan.key]) {
      results.push({ label: plan.label, key: plan.key, outcome: "already_recorded", attempts: 0, costMicroUsd: 0 });
      continue;
    }
    let costMicroUsd = 0;
    let problem: string | undefined;
    let attempts = 0;
    let recorded: RecordedCardEntry | undefined;
    let verdict: string | undefined;
    while (!recorded && attempts < MAX_ATTEMPTS) {
      attempts += 1;
      const meter = createTurnMeter();
      const call = await callTreasurer(deps.client, plan.params, meter);
      costMicroUsd += meter.costMicroUsd();
      if (!call.ok) {
        problem = callFailureCode(call.error);
        break;
      }
      const parsed = parseAnswer(call.message);
      if (parsed.ok) {
        verdict = parsed.answer.verdict;
        recorded = {
          label: plan.label,
          model: call.message.model,
          recordedAt: new Date(deps.now()).toISOString(),
          costUsd: meter.costMicroUsd() / 1e6,
          answer: parsed.answer,
        };
      } else {
        problem = parsed.problem;
        if (parsed.problem === "refusal") break;
      }
    }
    if (recorded) {
      entries[plan.key] = recorded;
      results.push({ label: plan.label, key: plan.key, outcome: "recorded", verdict, attempts, costMicroUsd });
    } else {
      results.push({ label: plan.label, key: plan.key, outcome: "failed", problem, attempts, costMicroUsd });
    }
  }
  return { entries, results };
}

/** recorded-cards.json's text: keys sorted, two-space indent, trailing newline. */
export function serializeRecordedCards(entries: Readonly<Record<string, RecordedCardEntry>>): string {
  const sorted = Object.fromEntries(Object.keys(entries).sort().map((key) => [key, entries[key]]));
  return `${JSON.stringify(sorted, null, 2)}\n`;
}
