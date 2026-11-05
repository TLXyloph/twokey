/**
 * The Risk context's public API (spec §4): a `RiskAssessor` (src/ledger/contracts.ts).
 *
 *   rulesCard(input, now)          code checks only; instant and free (./rules.ts)
 *   aiCard(input, sessionId, now)  the treasurer agent reads the receipt, behind the AI route's
 *                                  budget gates; a "live", "recorded" or "replay" card, or null
 *                                  (./ai-card.ts)
 *
 * `createRiskAssessor(deps)` takes every dependency (tests pass fakes). `riskAssessorFromEnv(env,
 * db)` builds the real ones for a route, the same way /api/ai/turn does: strings from the Worker
 * env (falling back to process.env, which OpenNext fills from the Worker env and `next dev` from
 * .env), the turn log on D1 (in memory under `next dev` only), and the receipt images from the
 * ASSETS binding (from public/ when there is none).
 */
import { createInMemoryAiTurnStore, type AiTurnStore } from "@/agents/llm/ai-turn-log";
import { createD1AiTurnStore } from "@/agents/llm/d1-ai-turn-log";
import { createAnthropicClient, type AnthropicLike } from "@/agents/llm/run-turn";
import { resolveModel } from "@/agents/llm/translate-request";
import { resolveTurnConfig, type AiConfigEnv } from "@/agents/llm/turn-config";
import type { RiskAssessor } from "@/ledger/contracts";
import type { D1DatabaseLike } from "@/platform/cloudflare-env";
import { aiReadCard, type AiReadDeps } from "./ai-card";
import { loadRecordedCards, type RecordedCards } from "./recorded";
import recordedCardsJson from "./recorded-cards.json";
import { assetReceiptImages, fileReceiptImages, isAssetFetcher } from "./receipt-images";
import { buildRulesCard, DEMO_RULES_CONTEXT, type RulesContext } from "./rules";

export { RECEIPTS, receiptById, type SampleReceipt } from "./receipts";
export type { AiReadDeps } from "./ai-card";

export interface RiskAssessorDeps {
  /** The club's policy and seed; the demo's by default. */
  rules?: RulesContext;
  /** Without it, `aiCard` always resolves to null (the rules card stands). */
  ai?: Omit<AiReadDeps, "rules">;
}

export function createRiskAssessor(deps: RiskAssessorDeps = {}): RiskAssessor {
  const rules = deps.rules ?? DEMO_RULES_CONTEXT;
  const ai = deps.ai && { ...deps.ai, rules };
  return {
    rulesCard: (input, now) => buildRulesCard(input, now, rules),
    aiCard: async (input, sessionId, now) => (ai ? aiReadCard(ai, input, sessionId, now) : null),
  };
}

/** The env a route hands over: the AI route's strings, plus the ASSETS binding. */
export type RiskEnv = AiConfigEnv & { ASSETS?: unknown };

export interface RiskEnvOverrides {
  clientFor?(apiKey: string): AnthropicLike;
  log?(line: string): void;
}

const ENV_NAMES = [
  "ANTHROPIC_API_KEY",
  "TWOKEY_SESSION_SECRET",
  "TWOKEY_SITE_ORIGIN",
  "TWOKEY_AI_BUDGET_USD",
  "TWOKEY_AI_SESSION_BUDGET_USD",
  "TWOKEY_AI_SESSION_TURNS_PER_MINUTE",
  "TWOKEY_AI_MODEL",
] as const satisfies readonly (keyof AiConfigEnv)[];

// Per isolate, as in the AI route: the client is reused while the key is the same, and under
// `next dev` the turn log lives in memory (reset on restart).
let cachedClient: { apiKey: string; client: AnthropicLike } | undefined;
let devStore: AiTurnStore | undefined;
let recordedCards: RecordedCards | undefined;

function clientFor(apiKey: string): AnthropicLike {
  if (cachedClient?.apiKey !== apiKey) cachedClient = { apiKey, client: createAnthropicClient(apiKey) };
  return cachedClient.client;
}

export function riskAssessorFromEnv(env: RiskEnv, db: D1DatabaseLike | undefined, overrides: RiskEnvOverrides = {}): RiskAssessor {
  const log = overrides.log ?? ((line: string) => console.info(line));
  const development = process.env.NODE_ENV === "development";
  const strings: AiConfigEnv = Object.fromEntries(ENV_NAMES.map((name) => [name, env[name] ?? process.env[name]]));
  const config = resolveTurnConfig(strings, development);
  const store = db ? createD1AiTurnStore(db) : development ? (devStore ??= createInMemoryAiTurnStore()) : undefined;
  const apiKey = config.ok ? config.value.apiKey : undefined;
  return createRiskAssessor({
    ai: {
      images: isAssetFetcher(env.ASSETS) ? assetReceiptImages(env.ASSETS) : fileReceiptImages(`${process.cwd()}/public`),
      recorded: (recordedCards ??= loadRecordedCards(recordedCardsJson, log)),
      model: config.ok ? config.value.model : resolveModel({ TWOKEY_AI_MODEL: strings.TWOKEY_AI_MODEL }),
      store,
      // No turn log, no gates: then nothing may call the model.
      live: store && config.ok && apiKey ? { client: (overrides.clientFor ?? clientFor)(apiKey), limits: config.value.limits } : undefined,
      now: Date.now,
      newId: () => crypto.randomUUID(),
      log,
    },
  });
}
