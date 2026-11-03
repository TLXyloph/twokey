/**
 * POST /api/ai/turn: one AI turn per request, streamed back as NDJSON `WireLine`s
 * (see `src/agents/llm/wire.ts`). Glue only: the checks, the D1 turn log, the live call and the
 * replays are `handleAiTurn` (src/agents/llm/ai-turn-handler.ts), which documents the statuses.
 *
 * Strings (secrets and vars) come from `process.env`, which OpenNext fills from the Worker env and
 * `next dev` fills from .env. The D1 binding and `waitUntil` come from `getCloudflareContext()`.
 * Under plain `next dev` there is no Cloudflare context; there, and only there, the turn log is
 * in memory (per process, reset on restart). Anywhere else a missing DB binding answers 503.
 */
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createInMemoryAiTurnStore, type AiTurnStore } from "@/agents/llm/ai-turn-log";
import { handleAiTurn } from "@/agents/llm/ai-turn-handler";
import { createD1AiTurnStore } from "@/agents/llm/d1-ai-turn-log";
import { createAnthropicClient, type AnthropicLike } from "@/agents/llm/run-turn";
import type {} from "@/platform/cloudflare-env"; // the CloudflareEnv bindings (DB, secrets, vars)

export const runtime = "nodejs";

interface WorkerContext {
  env: CloudflareEnv;
  waitUntil?: (promise: Promise<unknown>) => void;
}

// Per isolate: the client is reused while the key is the same.
let cachedClient: { apiKey: string; client: AnthropicLike } | undefined;
let devStore: AiTurnStore | undefined;

function clientFor(apiKey: string): AnthropicLike {
  if (cachedClient?.apiKey !== apiKey) cachedClient = { apiKey, client: createAnthropicClient(apiKey) };
  return cachedClient.client;
}

function workerContext(): WorkerContext {
  try {
    const { env, ctx } = getCloudflareContext<Record<string, unknown>, { waitUntil(promise: Promise<unknown>): void }>();
    return { env, waitUntil: (promise) => ctx.waitUntil(promise) };
  } catch {
    // No Cloudflare context (e.g. plain `next dev`): no bindings.
    return { env: {} };
  }
}

export async function POST(request: Request): Promise<Response> {
  const { env, waitUntil } = workerContext();
  const development = process.env.NODE_ENV === "development";
  const store = env.DB ? createD1AiTurnStore(env.DB) : development ? (devStore ??= createInMemoryAiTurnStore()) : undefined;
  return handleAiTurn(request, {
    env: {
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      TWOKEY_SESSION_SECRET: process.env.TWOKEY_SESSION_SECRET,
      TWOKEY_SITE_ORIGIN: process.env.TWOKEY_SITE_ORIGIN,
      TWOKEY_AI_BUDGET_USD: process.env.TWOKEY_AI_BUDGET_USD,
      TWOKEY_AI_SESSION_BUDGET_USD: process.env.TWOKEY_AI_SESSION_BUDGET_USD,
      TWOKEY_AI_SESSION_TURNS_PER_MINUTE: process.env.TWOKEY_AI_SESSION_TURNS_PER_MINUTE,
      TWOKEY_AI_MODEL: process.env.TWOKEY_AI_MODEL,
    },
    development,
    store,
    clientFor,
    waitUntil,
  });
}
