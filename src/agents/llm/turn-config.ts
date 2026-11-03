/**
 * The AI routes' configuration, read from the Worker env: secrets (`wrangler secret put`) and the
 * non-secret vars in wrangler.jsonc. Every limit is configuration, never a constant in code, and a
 * missing or malformed one is refused (503), never replaced by a built-in default.
 *
 *   TWOKEY_SESSION_SECRET               secret, >= 32 chars: signs the judge-session cookie
 *   TWOKEY_SITE_ORIGIN                  e.g. https://twokey.afterscroll.workers.dev; required
 *                                       outside development
 *   TWOKEY_AI_BUDGET_USD                hard total budget for the live AI, across all sessions
 *   TWOKEY_AI_SESSION_BUDGET_USD        each judge session's share of it
 *   TWOKEY_AI_SESSION_TURNS_PER_MINUTE  turns (live or replayed) per session per minute
 *   TWOKEY_AI_SESSIONS_PER_IP_PER_HOUR  new judge sessions per client IP per rolling hour
 *                                       (read by the session route only)
 *   ANTHROPIC_API_KEY                   secret; absent means "live AI off": replays only
 *   TWOKEY_AI_MODEL                     optional override of the server-fixed model
 *
 * Problems are reported as `<NAME>:<reason>` codes, never values.
 */
import type { OriginPolicy } from "./origin";
import { normalizeOrigin } from "./origin";
import { isUsableSessionSecret } from "./judge-session";
import type { SessionIssueLimit } from "./session-issuance-log";
import { resolveModel } from "./translate-request";

export const RATE_WINDOW_MS = 60_000;
export const SESSION_IP_WINDOW_MS = 60 * 60_000;

export interface AiConfigEnv {
  ANTHROPIC_API_KEY?: string;
  TWOKEY_SESSION_SECRET?: string;
  TWOKEY_SITE_ORIGIN?: string;
  TWOKEY_AI_BUDGET_USD?: string;
  TWOKEY_AI_SESSION_BUDGET_USD?: string;
  TWOKEY_AI_SESSION_TURNS_PER_MINUTE?: string;
  TWOKEY_AI_SESSIONS_PER_IP_PER_HOUR?: string;
  TWOKEY_AI_MODEL?: string;
}

/** Money in whole micro-dollars (1 USD = 1,000,000), so sums in D1 are exact integers. */
export interface AiLimits {
  totalBudgetMicroUsd: number;
  sessionBudgetMicroUsd: number;
  sessionTurnsPerWindow: number;
  windowMs: number;
}

export interface SessionConfig {
  sessionSecret: string;
  origin: OriginPolicy;
}

/** What the session route needs: the session config plus the per-IP cap on new sessions. */
export interface SessionIssueConfig extends SessionConfig {
  ipLimit: SessionIssueLimit;
}

export interface TurnConfig extends SessionConfig {
  /** Undefined when the live AI is off; the route then serves replays only. */
  apiKey: string | undefined;
  model: string;
  limits: AiLimits;
}

export type ConfigCheck<T> = { ok: true; value: T } | { ok: false; problems: string[] };

const USD = /^(\d{1,8})(?:\.(\d{1,6}))?$/;

/** "2.5" -> 2_500_000. Plain decimals only, at most 6 places and under $100M; anything else is undefined. */
export function parseUsdToMicro(text: string | undefined): number | undefined {
  const match = USD.exec(text?.trim() ?? "");
  if (!match) return undefined;
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? "").padEnd(6, "0"));
  return whole * 1_000_000 + fraction;
}

function parseCount(text: string | undefined): number | undefined {
  const trimmed = text?.trim() ?? "";
  return /^\d{1,6}$/.test(trimmed) ? Number(trimmed) : undefined;
}

export function resolveSessionConfig(env: AiConfigEnv, development: boolean): ConfigCheck<SessionConfig> {
  const problems: string[] = [];
  const secret = env.TWOKEY_SESSION_SECRET;
  if (!secret?.trim()) problems.push("TWOKEY_SESSION_SECRET:unset");
  else if (!isUsableSessionSecret(secret)) problems.push("TWOKEY_SESSION_SECRET:too_short");
  const rawOrigin = env.TWOKEY_SITE_ORIGIN?.trim();
  const siteOrigin = normalizeOrigin(rawOrigin);
  if (rawOrigin && !siteOrigin) problems.push("TWOKEY_SITE_ORIGIN:invalid");
  else if (!rawOrigin && !development) problems.push("TWOKEY_SITE_ORIGIN:unset");
  if (problems.length > 0 || !isUsableSessionSecret(secret)) return { ok: false, problems };
  return { ok: true, value: { sessionSecret: secret.trim(), origin: { siteOrigin, development } } };
}

export function resolveSessionIssueConfig(env: AiConfigEnv, development: boolean): ConfigCheck<SessionIssueConfig> {
  const session = resolveSessionConfig(env, development);
  const problems = session.ok ? [] : [...session.problems];
  const perWindow = parseCount(env.TWOKEY_AI_SESSIONS_PER_IP_PER_HOUR);
  if (perWindow === undefined) problems.push("TWOKEY_AI_SESSIONS_PER_IP_PER_HOUR:invalid");
  if (!session.ok || perWindow === undefined) return { ok: false, problems };
  return { ok: true, value: { ...session.value, ipLimit: { perWindow, windowMs: SESSION_IP_WINDOW_MS } } };
}

export function resolveTurnConfig(env: AiConfigEnv, development: boolean): ConfigCheck<TurnConfig> {
  const session = resolveSessionConfig(env, development);
  const problems = session.ok ? [] : [...session.problems];
  const totalBudgetMicroUsd = parseUsdToMicro(env.TWOKEY_AI_BUDGET_USD);
  const sessionBudgetMicroUsd = parseUsdToMicro(env.TWOKEY_AI_SESSION_BUDGET_USD);
  const sessionTurnsPerWindow = parseCount(env.TWOKEY_AI_SESSION_TURNS_PER_MINUTE);
  if (totalBudgetMicroUsd === undefined) problems.push("TWOKEY_AI_BUDGET_USD:invalid");
  if (sessionBudgetMicroUsd === undefined) problems.push("TWOKEY_AI_SESSION_BUDGET_USD:invalid");
  if (sessionTurnsPerWindow === undefined) problems.push("TWOKEY_AI_SESSION_TURNS_PER_MINUTE:invalid");
  if (
    !session.ok ||
    problems.length > 0 ||
    totalBudgetMicroUsd === undefined ||
    sessionBudgetMicroUsd === undefined ||
    sessionTurnsPerWindow === undefined
  ) {
    return { ok: false, problems };
  }
  return {
    ok: true,
    value: {
      ...session.value,
      apiKey: env.ANTHROPIC_API_KEY?.trim() || undefined,
      model: resolveModel({ TWOKEY_AI_MODEL: env.TWOKEY_AI_MODEL }),
      limits: { totalBudgetMicroUsd, sessionBudgetMicroUsd, sessionTurnsPerWindow, windowMs: RATE_WINDOW_MS },
    },
  };
}
