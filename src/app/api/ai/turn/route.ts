/**
 * POST /api/ai/turn: one Claude turn per request, streamed back as NDJSON `WireLine`s
 * (see `src/agents/llm/wire.ts`). Glue only: guardrails, then `runTurn`, then the stream.
 * Default Node runtime. The Anthropic key comes from `process.env` only, never from the client.
 */
import {
  budgetUsd,
  checkAdmission,
  clientKey,
  createInMemorySpendLedger,
  createRateLimiter,
  parseTurnBody,
  readBodyText,
  type Rejection,
} from "@/agents/llm/guardrails";
import { createAnthropicClient, runTurn, toNdjsonStream, type AnthropicLike } from "@/agents/llm/run-turn";
import { resolveModel } from "@/agents/llm/translate-request";
import { NDJSON_CONTENT_TYPE } from "@/agents/llm/wire";

// Per server instance: they reset on restart and are not shared between instances.
const limiter = createRateLimiter();
const ledger = createInMemorySpendLedger();
let client: AnthropicLike | undefined;

function errorResponse(rejection: Rejection): Response {
  return Response.json({ error: rejection.error }, { status: rejection.status, headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  const admitted = checkAdmission({
    apiKey: process.env.ANTHROPIC_API_KEY,
    clientKey: clientKey(request.headers),
    limiter,
    ledger,
    budgetUsd: budgetUsd(process.env),
  });
  if (!admitted.ok) return errorResponse(admitted.rejection);

  const body = await readBodyText(request);
  if (!body.ok) return errorResponse(body.rejection);
  const parsed = parseTurnBody(body.value);
  if (!parsed.ok) return errorResponse(parsed.rejection);

  client ??= createAnthropicClient(admitted.value);
  // Either a client disconnect (request.signal) or a cancelled response body stops the upstream call.
  const cancel = new AbortController();
  const signal = AbortSignal.any([request.signal, cancel.signal]);
  const lines = runTurn({ client, ledger, model: resolveModel(process.env) }, parsed.value, signal);
  return new Response(toNdjsonStream(lines, () => cancel.abort()), {
    status: 200,
    headers: { "content-type": NDJSON_CONTENT_TYPE, "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}
