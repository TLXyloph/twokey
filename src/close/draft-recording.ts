/**
 * Recording the AI's draft of the close (development only; run through
 * scripts/record-close-draft.sh). The draft is made from the computed figures, validated, and stored
 * in recorded-draft.json under the close hash. The site then serves it as "Drafted by the AI
 * (recorded)", with no call.
 *
 * The call bypasses the site's AI budget gates on purpose: the person running the script approves
 * the spend, and the script prints the estimate first and the actual cost after.
 */
import type { AnthropicLike } from "@/agents/llm/run-turn";
import { createTurnMeter, worstCaseMicroUsd } from "@/agents/llm/turn-cost";
import { callFailureCode, callTreasurer } from "@/agents/treasurer/call";
import type { BetaMessageStreamParams } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { CloseFigures } from "./contracts";
import { parseDraftMessage, type RecordedDraftEntry } from "./draft";
import { buildCloseDraftParams } from "./draft-prompt";
import { closeHash } from "./october";

/** One retry for an answer that doesn't validate; never for a refusal or an upstream error. */
export const MAX_DRAFT_ATTEMPTS = 2;

export interface DraftPlan {
  month: string;
  closeHash: string;
  params: BetaMessageStreamParams;
  /** A loose upper bound for one attempt (what the site's gate would reserve). */
  worstCaseMicroUsd: number;
}

export async function planCloseDraft(figures: CloseFigures, model: string): Promise<DraftPlan> {
  const params = buildCloseDraftParams(figures, model);
  return { month: figures.month, closeHash: await closeHash(figures), params, worstCaseMicroUsd: worstCaseMicroUsd(params) };
}

export interface DraftRecordingResult {
  outcome: "recorded" | "failed";
  /** The last attempt's problem or the upstream error's code. */
  problem?: string;
  attempts: number;
  costMicroUsd: number;
  entry?: RecordedDraftEntry;
}

export async function recordCloseDraft(deps: { client: AnthropicLike; now(): number }, plan: DraftPlan): Promise<DraftRecordingResult> {
  let costMicroUsd = 0;
  let problem: string | undefined;
  let attempts = 0;
  while (attempts < MAX_DRAFT_ATTEMPTS) {
    attempts += 1;
    const meter = createTurnMeter();
    const call = await callTreasurer(deps.client, plan.params, meter);
    costMicroUsd += meter.costMicroUsd();
    if (!call.ok) return { outcome: "failed", problem: callFailureCode(call.error), attempts, costMicroUsd };
    const parsed = parseDraftMessage(call.message);
    if (parsed.ok) {
      const entry: RecordedDraftEntry = {
        month: plan.month,
        model: call.message.model,
        recordedAt: new Date(deps.now()).toISOString(),
        costUsd: costMicroUsd / 1e6,
        draft: parsed.draft,
      };
      return { outcome: "recorded", attempts, costMicroUsd, entry };
    }
    problem = parsed.problem;
    if (parsed.problem === "refusal") break;
  }
  return { outcome: "failed", problem, attempts, costMicroUsd };
}
