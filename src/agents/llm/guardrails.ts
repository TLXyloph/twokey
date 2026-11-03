/**
 * Server-side guardrails for `POST /api/ai/turn`: body validation and size limits, a per-client
 * rate limit, and a spend cap. The route must not be an open proxy to the Anthropic API, so
 * everything the browser sends is validated here and nothing it sends picks the model or limits.
 *
 * The rate limiter and the spend ledger are in-memory: per server instance, reset on restart.
 */
import { z } from "zod";
import type { AgAiReasoningItem } from "ag-studio";
import type { TurnRequest, WireError, WireErrorCode } from "./wire";

export const LIMITS = {
  maxBodyBytes: 1024 * 1024,
  maxInputItems: 500,
  maxTools: 64,
  maxToolSchemaBytes: 64 * 1024,
  maxInstructionsBytes: 100 * 1024,
  maxSchemaDepth: 64,
} as const;
export const RATE_LIMIT = { turns: 20, windowMs: 60_000 } as const;
export const DEFAULT_BUDGET_USD = 5;

export interface Rejection {
  status: number;
  error: WireError;
}
export type Checked<T> = { ok: true; value: T } | { ok: false; rejection: Rejection };

const reject = (status: number, code: WireErrorCode, message: string): Rejection => ({ status, error: { code, message } });
const badRequest = (message: string): { ok: false; rejection: Rejection } => ({
  ok: false,
  rejection: reject(400, "bad_request", message),
});

// ---------------------------------------------------------------------------------------------
// Body validation
// ---------------------------------------------------------------------------------------------

const byteLength = (text: string): number => new TextEncoder().encode(text).byteLength;

function depthWithin(value: unknown, remaining: number): boolean {
  if (remaining < 0) return false;
  if (Array.isArray(value)) return value.every((item) => depthWithin(item, remaining - 1));
  if (typeof value === "object" && value !== null) {
    return Object.values(value).every((item) => depthWithin(item, remaining - 1));
  }
  return true;
}

const jsonSchema = z
  .record(z.string(), z.unknown())
  .refine((schema) => depthWithin(schema, LIMITS.maxSchemaDepth), "schema is nested too deeply");
const status = z.enum(["in_progress", "completed", "incomplete"]);

const inputMessage = z.object({
  id: z.string(),
  kind: z.literal("input"),
  type: z.literal("message"),
  // Studio types this as user | system; a developer message is treated as system.
  role: z.enum(["user", "system", "developer"]).transform((role): "user" | "system" => (role === "user" ? "user" : "system")),
  content: z.array(
    z.discriminatedUnion("type", [
      z.object({ type: z.literal("text"), text: z.string() }),
      z.object({
        type: z.literal("image"),
        detail: z.enum(["low", "high", "auto"]),
        fileId: z.string().optional(),
        imageUrl: z.string().optional(),
      }),
      z.object({
        type: z.literal("file"),
        fileData: z.string().optional(),
        fileId: z.string().optional(),
        fileUrl: z.string().optional(),
        filename: z.string().optional(),
      }),
    ]),
  ),
  status,
});

const outputMessage = z.object({
  id: z.string(),
  kind: z.literal("output"),
  type: z.literal("message"),
  role: z.literal("assistant"),
  status,
  content: z.array(
    z.discriminatedUnion("type", [
      // Annotations are never forwarded to Claude, so they are accepted and discarded.
      z.object({ type: z.literal("text"), text: z.string(), annotations: z.array(z.unknown()).optional().transform((): never[] => []) }),
      z.object({ type: z.literal("refusal"), refusal: z.string() }),
    ]),
  ),
});

const functionCall = z.object({
  id: z.string(),
  kind: z.literal("output"),
  type: z.literal("function_call"),
  callId: z.string().min(1),
  name: z.string().min(1),
  arguments: z.string(),
  status: status.optional(),
  result: z.string().optional(),
});

const functionCallOutput = z.object({
  id: z.string().optional(),
  kind: z.literal("input").optional(),
  type: z.literal("function_call_output"),
  callId: z.string().min(1),
  output: z.string(),
  status,
});

// Reasoning is never replayed, so any shape is accepted and its content is discarded at the door.
const reasoning = z
  .looseObject({ type: z.literal("reasoning") })
  .transform((): AgAiReasoningItem => ({ id: "", kind: "output", type: "reasoning", summary: [] }));

const tool = z.object({
  name: z.string().min(1).max(256),
  description: z.string(),
  parameters: jsonSchema,
  // `provider` is deliberately not accepted: provider-native tool declarations never reach Claude.
  kind: z.enum(["client", "server", "provided"]).optional(),
});

const turnRequestSchema = z.object({
  input: z.array(z.union([inputMessage, outputMessage, functionCall, functionCallOutput, reasoning])).max(LIMITS.maxInputItems),
  instructions: z
    .string()
    .refine((text) => byteLength(text) <= LIMITS.maxInstructionsBytes, `instructions exceed ${LIMITS.maxInstructionsBytes} bytes`)
    .optional(),
  tools: z
    .array(tool)
    .max(LIMITS.maxTools)
    .refine((tools) => byteLength(JSON.stringify(tools)) <= LIMITS.maxToolSchemaBytes, "tool schemas exceed 64 KB in total")
    .optional(),
  toolChoice: z.union([z.enum(["auto", "none", "required"]), z.object({ name: z.string().min(1) })]).optional(),
  responseFormat: z.discriminatedUnion("type", [
    z.object({ type: z.literal("text") }),
    z.object({ type: z.literal("json"), name: z.string(), description: z.string().optional(), schema: jsonSchema }),
  ]),
});

const bodySchema = z.object({ request: turnRequestSchema });

/** Parses and validates a JSON body `{ request: TurnRequest }`. Unknown fields (e.g. `model`) are dropped. */
export function parseTurnBody(text: string): Checked<TurnRequest> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return badRequest("Request body is not valid JSON.");
  }
  try {
    const result = bodySchema.safeParse(json);
    if (!result.success) {
      const issues = result.error.issues.slice(0, 3).map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`);
      return badRequest(`Invalid request: ${issues.join("; ")}`);
    }
    const value: TurnRequest = result.data.request;
    return { ok: true, value };
  } catch {
    return badRequest("Invalid request.");
  }
}

/** Reads the body as text, refusing (without buffering it all) anything over `maxBytes`. */
export async function readBodyText(request: Request, maxBytes: number = LIMITS.maxBodyBytes): Promise<Checked<string>> {
  const tooLarge = `Request body exceeds ${maxBytes} bytes.`;
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return badRequest(tooLarge);
  if (!request.body) return { ok: true, value: "" };
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return badRequest(tooLarge);
      }
      text += decoder.decode(value, { stream: true });
    }
  } catch {
    return badRequest("Could not read the request body.");
  }
  return { ok: true, value: text + decoder.decode() };
}

// ---------------------------------------------------------------------------------------------
// Rate limit
// ---------------------------------------------------------------------------------------------

/**
 * The first `x-forwarded-for` address, else "local". The header is only trustworthy behind a proxy
 * that overwrites it (as Vercel does); elsewhere a client can choose its own key.
 */
export function clientKey(headers: Headers): string {
  const first = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return first ? first.slice(0, 100) : "local";
}

export interface RateLimiter {
  /** Records one turn for `key`; false when the key is over its limit (the turn is not recorded). */
  take(key: string): boolean;
}

export interface RateLimiterOptions {
  limit?: number;
  windowMs?: number;
  now?: () => number;
  /** Least recently used keys beyond this are forgotten, bounding memory. */
  maxKeys?: number;
}

/** Sliding-window log: at most `limit` turns in any `windowMs` per key. */
export function createRateLimiter(options: RateLimiterOptions = {}): RateLimiter {
  const { limit = RATE_LIMIT.turns, windowMs = RATE_LIMIT.windowMs, now = Date.now, maxKeys = 10_000 } = options;
  const hits = new Map<string, number[]>();
  return {
    take(key) {
      const at = now();
      const recent = (hits.get(key) ?? []).filter((time) => time > at - windowMs);
      hits.delete(key);
      const allowed = recent.length < limit;
      if (allowed) recent.push(at);
      hits.set(key, recent);
      if (hits.size > maxKeys) {
        const oldest = hits.keys().next().value;
        if (oldest !== undefined) hits.delete(oldest);
      }
      return allowed;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Spend cap
// ---------------------------------------------------------------------------------------------

/** Anthropic-shaped token counts; `input_tokens` excludes cache reads and writes. */
export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

export interface SpendLedger {
  getSpentUsd(): number;
  /** Adds one turn's (or one attempt's) usage at `model`'s prices; returns its cost in USD. */
  record(usage: TokenUsage, model: string): number;
}

/** USD per million tokens. Cache write is the 5-minute TTL rate (what automatic caching uses). */
export interface ModelPrice {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export const PRICES_PER_MTOK: Readonly<Record<string, ModelPrice>> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
};
const OPUS_PRICE: ModelPrice = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 };

/** Exact or dated-snapshot match; anything else (e.g. a fallback model) is charged at Opus 5.5 rates. */
export function priceFor(model: string): ModelPrice {
  const key = Object.keys(PRICES_PER_MTOK).find((name) => model === name || model.startsWith(`${name}-`));
  return (key && PRICES_PER_MTOK[key]) || OPUS_PRICE;
}

export function costUsd(usage: TokenUsage, model: string): number {
  const price = priceFor(model);
  const tokens =
    usage.input_tokens * price.input +
    usage.output_tokens * price.output +
    (usage.cache_read_input_tokens ?? 0) * price.cacheRead +
    (usage.cache_creation_input_tokens ?? 0) * price.cacheWrite;
  return tokens / 1_000_000;
}

export function createInMemorySpendLedger(): SpendLedger {
  let spent = 0;
  return {
    getSpentUsd: () => spent,
    record(usage, model) {
      const cost = costUsd(usage, model);
      spent += cost;
      return cost;
    },
  };
}

/** The cap from `TWOKEY_AI_BUDGET_USD`; a missing, malformed or negative value means the $5 default. */
export function budgetUsd(env: Readonly<Record<string, string | undefined>>): number {
  const raw = env.TWOKEY_AI_BUDGET_USD?.trim();
  const value = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_BUDGET_USD;
}

// ---------------------------------------------------------------------------------------------
// Admission
// ---------------------------------------------------------------------------------------------

export interface AdmissionInput {
  apiKey: string | undefined;
  clientKey: string;
  limiter: RateLimiter;
  ledger: SpendLedger;
  budgetUsd: number;
}

/** The checks that run before the body is read: configuration, rate, then budget. Yields the API key. */
export function checkAdmission(input: AdmissionInput): Checked<string> {
  const refuse = (rejection: Rejection) => ({ ok: false as const, rejection });
  if (!input.apiKey) return refuse(reject(503, "misconfigured", "The AI service is not configured on this server."));
  if (!input.limiter.take(input.clientKey)) {
    return refuse(reject(429, "rate_limited", "Too many AI turns from this client; wait a minute and try again."));
  }
  if (input.ledger.getSpentUsd() >= input.budgetUsd) {
    return refuse(reject(402, "budget_exceeded", "The AI spend cap for this server has been reached."));
  }
  return { ok: true, value: input.apiKey };
}
