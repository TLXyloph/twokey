/**
 * The AI receipt read behind the AI route's gates. It spends from the same budget as
 * `POST /api/ai/turn`: the same turn log (D1 `ai_turn_events`), the same limits (the session's
 * share, the $10 total, the per-session rate) and the same reserve -> call -> settle steps.
 *
 * In order:
 *   1. Load the receipt image (hash-checked) and build the prompt; its replay key names it.
 *   2. recorded-cards.json has the key            -> "recorded" card; no call, no reservation.
 *   3. Live AI on: reserve the worst case          -> refused (budget, rate): go to 5.
 *      call the model, settle the actual cost      -> the call failed (upstream, refusal): go to 5.
 *      the answer validates                        -> "live" card, and the answer is recorded
 *                                                     under the key for later replays.
 *      it doesn't                                  -> retry once (a new reservation), then null.
 *   4. Live AI off (no key, or AI config incomplete): go to 5.
 *   5. The recordings store has the key            -> "replay" card; otherwise null.
 * A null leaves the rules card standing. Store failures also end in null; the AI never blocks.
 *
 * One log line per step: outcome, short ids and costs. Never the prompt, the image or the answer.
 */
import type { AiTurnStore } from "@/agents/llm/ai-turn-log";
import { replayKey } from "@/agents/llm/replay-key";
import type { AnthropicLike } from "@/agents/llm/run-turn";
import type { AiLimits } from "@/agents/llm/turn-config";
import { createTurnMeter, worstCaseMicroUsd } from "@/agents/llm/turn-cost";
import { parseAnswer, type TreasurerAnswer } from "@/agents/treasurer/answer";
import { callFailureCode, callTreasurer } from "@/agents/treasurer/call";
import { buildTreasurerParams } from "@/agents/treasurer/prompt";
import type { BetaMessageStreamParams } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { RiskCard, RiskInput } from "@/ledger/contracts";
import { mergeCard, treasurerFacts } from "./card";
import { decodeRiskRecording, encodeRiskRecording, type RecordedCards } from "./recorded";
import { loadReceiptImage, type ReceiptImages } from "./receipt-images";
import { receiptById } from "./receipts";
import { buildRulesCard, type RulesContext } from "./rules";

export const MAX_ATTEMPTS = 2;

export interface LiveAi {
  client: AnthropicLike;
  limits: AiLimits;
}

export interface AiReadDeps {
  rules: RulesContext;
  images: ReceiptImages;
  recorded: RecordedCards;
  model: string;
  /** The AI route's turn log and recordings. Undefined (no D1 outside dev): recorded cards only. */
  store: AiTurnStore | undefined;
  /** Undefined when the live AI is off (no API key, or the AI config is incomplete): replays only. */
  live: LiveAi | undefined;
  now(): number;
  newId(): string;
  log(line: string): void;
}

interface Step {
  params: BetaMessageStreamParams;
  key: string;
  rules: RiskCard;
  sessionId: string;
  checkedAt: string;
}

type LiveOutcome = { kind: "card"; card: RiskCard } | { kind: "invalid" } | { kind: "unavailable"; reason: string };

const usd = (micro: number) => (micro / 1e6).toFixed(4);

function logLine(outcome: string, step: Partial<Step>, extra: Record<string, string | number> = {}): string {
  const parts = [`[risk/ai] outcome=${outcome}`];
  if (step.sessionId) parts.push(`session=${step.sessionId.slice(0, 8)}`);
  if (step.key) parts.push(`key=${step.key.slice(0, 12)}`);
  for (const [name, value] of Object.entries(extra)) parts.push(`${name}=${value}`);
  return parts.join(" ");
}

export async function aiReadCard(deps: AiReadDeps, input: RiskInput, sessionId: string, now: Date): Promise<RiskCard | null> {
  const receipt = receiptById(input.request.receiptId);
  if (!receipt) {
    deps.log(logLine("unknown_receipt", { sessionId }));
    return null;
  }
  let step: Step;
  try {
    const image = await loadReceiptImage(deps.images, receipt);
    const rules = buildRulesCard(input, now, deps.rules);
    const params = buildTreasurerParams(treasurerFacts(input, rules, deps.rules), image, deps.model);
    step = { params, key: await replayKey(params), rules, sessionId, checkedAt: now.toISOString() };
  } catch {
    deps.log(logLine("image_unavailable", { sessionId }, { receipt: receipt.id }));
    return null;
  }

  const recorded = deps.recorded.get(step.key);
  if (recorded) {
    deps.log(logLine("recorded", step));
    return mergeCard(step.rules, recorded.answer, { origin: "recorded", model: recorded.model, checkedAt: recorded.recordedAt });
  }
  const { store } = deps;
  if (!store) {
    deps.log(logLine("unavailable", step, { detail: "no_store" }));
    return null;
  }
  try {
    const outcome: LiveOutcome = deps.live ? await tryLive(deps, deps.live, store, step) : { kind: "unavailable", reason: "off" };
    if (outcome.kind === "card") return outcome.card;
    if (outcome.kind === "invalid") return null;
    return await replay(deps, store, step, outcome.reason);
  } catch {
    deps.log(logLine("store_error", step));
    return null;
  }
}

async function tryLive(deps: AiReadDeps, live: LiveAi, store: AiTurnStore, step: Step): Promise<LiveOutcome> {
  const worstCase = worstCaseMicroUsd(step.params);
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const turnId = deps.newId();
    const reserved = await store.turnLog.reserve(
      { turnId, sessionId: step.sessionId, model: deps.model, requestHash: step.key, costMicroUsd: worstCase, at: deps.now() },
      live.limits,
    );
    if (reserved !== "reserved") return { kind: "unavailable", reason: reserved };

    const meter = createTurnMeter();
    const call = await callTreasurer(live.client, step.params, meter);
    const parsed = call.ok ? parseAnswer(call.message) : undefined;
    const outcome = !call.ok ? callFailureCode(call.error) : parsed?.ok ? "complete" : (parsed?.problem ?? "invalid");
    const model = call.ok ? call.message.model : deps.model;
    await store.turnLog
      .settle({ turnId, sessionId: step.sessionId, model, costMicroUsd: meter.costMicroUsd(), outcome, usage: meter.usage(), at: deps.now() })
      .catch(() => deps.log(logLine("settle_failed", step, { turn: turnId })));
    deps.log(
      logLine(outcome === "complete" ? "live" : `live_${outcome}`, step, {
        attempt,
        turn: turnId,
        reserved_usd: usd(worstCase),
        cost_usd: usd(meter.costMicroUsd()),
        input: meter.usage().inputTokens,
        output: meter.usage().outputTokens,
      }),
    );

    if (!call.ok) return { kind: "unavailable", reason: outcome };
    if (parsed?.ok) {
      await record(deps, store, step, turnId, model, parsed.answer);
      return { kind: "card", card: mergeCard(step.rules, parsed.answer, { origin: "live", model, checkedAt: step.checkedAt }) };
    }
    if (parsed?.problem === "refusal") return { kind: "unavailable", reason: "refusal" };
  }
  return { kind: "invalid" };
}

async function record(deps: AiReadDeps, store: AiTurnStore, step: Step, turnId: string, model: string, answer: TreasurerAnswer): Promise<void> {
  try {
    await store.recordings.save({ requestHash: step.key, turnId, model, recordedAt: deps.now(), ndjson: encodeRiskRecording(answer) });
  } catch {
    deps.log(logLine("record_failed", step, { turn: turnId }));
  }
}

async function replay(deps: AiReadDeps, store: AiTurnStore, step: Step, reason: string): Promise<RiskCard | null> {
  const found = await store.recordings.find(step.key);
  const answer = found ? decodeRiskRecording(found.ndjson) : null;
  const turnId = deps.newId();
  await store.turnLog
    .recordReplay({ turnId, sessionId: step.sessionId, requestHash: step.key, outcome: answer ? "hit" : "miss", at: deps.now() })
    .catch(() => deps.log(logLine("replay_note_failed", step, { turn: turnId })));
  deps.log(logLine(answer ? "replay_hit" : "replay_miss", step, { detail: reason }));
  if (!found || !answer) return null;
  return mergeCard(step.rules, answer, { origin: "replay", model: found.model, checkedAt: new Date(found.recordedAt).toISOString() });
}
