/**
 * `POST /api/ai/turn`'s core: request in, response out, every dependency injected. The route file
 * is the glue that supplies the Worker env, D1 and the Anthropic client.
 *
 * Checks run cheapest first, and nothing reaches the model or the turn log until they pass:
 *   config missing or malformed (secret, origin, limits)  -> 503 misconfigured
 *   Origin / Sec-Fetch-Site not this site                  -> 403 forbidden
 *   D1 binding missing                                     -> 503 misconfigured
 *   no valid judge-session cookie                          -> 401 no_session
 *   body too large or invalid                              -> 400 bad_request
 * Then the turn is answered one of three ways:
 *   live:   the worst case is reserved (atomically, with every limit checked), the model is
 *           called and the actual cost settled                                   -> 200 NDJSON
 *   replay: the live AI is unavailable (budget used up, or no API key) and a recording matches
 *           the request's replay key; the stream opens with a `replay` line     -> 200 NDJSON
 *   miss:   unavailable and nothing matches: one plain message saying so         -> 200 NDJSON
 *   The session's turn rate (live and replayed) over the window               -> 429 rate_limited
 *   A turn-log failure before the model is called                             -> 500 internal
 *
 * One log line per request: outcome, status, short ids and the reserved amount. Never the cookie,
 * the key, the prompt or the answer.
 */
import type { AiTurnStore, TurnReservation } from "./ai-turn-log";
import { parseTurnBody, readBodyText } from "./guardrails";
import { verifySession } from "./judge-session";
import { liveTurn } from "./live-turn";
import { checkSameOrigin } from "./origin";
import { replayLines, unavailableLines, type UnavailableReason } from "./replay";
import { replayKey } from "./replay-key";
import { toNdjsonStream, type AnthropicLike } from "./run-turn";
import { buildMessageParams } from "./translate-request";
import { resolveTurnConfig, type AiConfigEnv, type TurnConfig } from "./turn-config";
import { worstCaseMicroUsd } from "./turn-cost";
import { NDJSON_CONTENT_TYPE, type TurnRequest, type WireErrorCode, type WireLine } from "./wire";

export interface AiTurnHandlerDeps {
  env: AiConfigEnv;
  /** True only under `next dev`: admits loopback origins and makes TWOKEY_SITE_ORIGIN optional. */
  development: boolean;
  /** Undefined when the D1 binding is missing. */
  store: AiTurnStore | undefined;
  /** Builds (or reuses) the Anthropic client; the route caches it per isolate. */
  clientFor(apiKey: string): AnthropicLike;
  waitUntil?(promise: Promise<unknown>): void;
  now?(): number;
  newId?(): string;
  log?(line: string): void;
}

const MESSAGES: Partial<Record<WireErrorCode, string>> = {
  misconfigured: "The AI service is not configured on this server.",
  forbidden: "This AI service only answers requests from the TwoKey demo itself.",
  no_session: "No demo session: reload the demo page and try again.",
  rate_limited: "Too many AI turns from this session; wait a minute and try again.",
  internal: "The AI turn failed on the server.",
};

interface LogFields {
  status: number;
  sessionId?: string;
  turnId?: string;
  requestHash?: string;
  reservedMicroUsd?: number;
  /** Fixed codes built from constants only. */
  detail?: string;
}

function logLine(outcome: string, fields: LogFields): string {
  const parts = [`[ai/turn] outcome=${outcome}`, `status=${fields.status}`];
  if (fields.sessionId) parts.push(`session=${fields.sessionId.slice(0, 8)}`);
  if (fields.turnId) parts.push(`turn=${fields.turnId}`);
  if (fields.requestHash) parts.push(`key=${fields.requestHash.slice(0, 12)}`);
  if (fields.reservedMicroUsd !== undefined) parts.push(`reserved_usd=${(fields.reservedMicroUsd / 1e6).toFixed(4)}`);
  if (fields.detail) parts.push(`detail=${fields.detail}`);
  return parts.join(" ");
}

function errorResponse(status: number, code: WireErrorCode, message?: string): Response {
  return Response.json(
    { error: { code, message: message ?? MESSAGES[code] ?? "The AI turn failed." } },
    { status, headers: { "cache-control": "no-store" } },
  );
}

function ndjsonResponse(lines: AsyncGenerator<WireLine, void, undefined>, onCancel?: () => void): Response {
  return new Response(toNdjsonStream(lines, onCancel), {
    status: 200,
    headers: { "content-type": NDJSON_CONTENT_TYPE, "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}

async function* fromArray(lines: readonly WireLine[]): AsyncGenerator<WireLine, void, undefined> {
  yield* lines;
}

interface TurnContext {
  config: TurnConfig;
  store: AiTurnStore;
  sessionId: string;
  turnId: string;
  requestHash: string;
}

export async function handleAiTurn(request: Request, deps: AiTurnHandlerDeps): Promise<Response> {
  const log = deps.log ?? ((line: string) => console.info(line));
  const now = deps.now ?? Date.now;
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const waitUntil = deps.waitUntil ?? ((promise: Promise<unknown>) => void promise);
  const refuse = (outcome: string, status: number, code: WireErrorCode, fields: Omit<LogFields, "status"> = {}): Response => {
    log(logLine(outcome, { ...fields, status }));
    return errorResponse(status, code);
  };

  const config = resolveTurnConfig(deps.env, deps.development);
  if (!config.ok) return refuse("misconfigured", 503, "misconfigured", { detail: config.problems.join(",") });
  const origin = checkSameOrigin(request.headers, config.value.origin);
  if (!origin.ok) return refuse("forbidden", 403, "forbidden", { detail: origin.reason });
  if (!deps.store) return refuse("misconfigured", 503, "misconfigured", { detail: "DB:unbound" });
  const store = deps.store;
  const session = await verifySession(request.headers.get("cookie"), config.value.sessionSecret, now());
  if (!session.ok) return refuse("no_session", 401, "no_session", { detail: session.reason });
  const sessionId = session.session.id;

  const text = await readBodyText(request);
  if (!text.ok) return refuse("bad_request", 400, "bad_request", { sessionId, detail: "body" });
  const parsed = parseTurnBody(text.value);
  if (!parsed.ok) {
    log(logLine("bad_request", { status: 400, sessionId, detail: "validation" }));
    return errorResponse(parsed.rejection.status, parsed.rejection.error.code, parsed.rejection.error.message);
  }

  const params = buildMessageParams(parsed.value, config.value.model);
  const context: TurnContext = { config: config.value, store, sessionId, turnId: newId(), requestHash: await replayKey(params) };
  const ids = { sessionId, turnId: context.turnId, requestHash: context.requestHash };
  try {
    const { apiKey, limits, model } = config.value;
    if (apiKey === undefined) {
      if ((await store.turnLog.countRecentTurns(sessionId, now() - limits.windowMs)) >= limits.sessionTurnsPerWindow) {
        return refuse("rate_limited", 429, "rate_limited", ids);
      }
      return await answerWithoutModel(context, "off", { log, now });
    }
    const reservation = { ...ids, model, costMicroUsd: worstCaseMicroUsd(params), at: now() };
    const reserved = await store.turnLog.reserve(reservation, limits);
    if (reserved === "rate_limited") return refuse("rate_limited", 429, "rate_limited", ids);
    if (reserved !== "reserved") return await answerWithoutModel(context, reserved, { log, now });
    log(logLine("live", { status: 200, ...ids, reservedMicroUsd: reservation.costMicroUsd }));
    return startLiveTurn(request, deps.clientFor(apiKey), context, parsed.value, reservation, { log, now, waitUntil });
  } catch {
    return refuse("store_error", 500, "internal", ids);
  }
}

function startLiveTurn(
  request: Request,
  client: AnthropicLike,
  context: TurnContext,
  turn: TurnRequest,
  reservation: TurnReservation,
  helpers: { log: (line: string) => void; now: () => number; waitUntil: (promise: Promise<unknown>) => void },
): Response {
  // Either a client disconnect (request.signal) or a cancelled response body stops the upstream call.
  const cancel = new AbortController();
  const signal = AbortSignal.any([request.signal, cancel.signal]);
  const lines = liveTurn(
    { client, model: context.config.model, store: context.store, reservation, ...helpers },
    turn,
    signal,
  );
  return ndjsonResponse(lines, () => cancel.abort());
}

async function answerWithoutModel(
  context: TurnContext,
  reason: UnavailableReason,
  helpers: { log: (line: string) => void; now: () => number },
): Promise<Response> {
  const { store, sessionId, turnId, requestHash } = context;
  const found = await store.recordings.find(requestHash);
  let lines: WireLine[] | undefined;
  let detail: string = reason;
  if (found) {
    try {
      lines = replayLines(found);
    } catch {
      detail = `${reason},corrupt_recording`;
    }
  }
  await store.turnLog.recordReplay({ turnId, sessionId, requestHash, outcome: lines ? "hit" : "miss", at: helpers.now() });
  helpers.log(logLine(lines ? "replay_hit" : "replay_miss", { status: 200, sessionId, turnId, requestHash, detail }));
  return ndjsonResponse(fromArray(lines ?? unavailableLines(reason, turnId, helpers.now)));
}
