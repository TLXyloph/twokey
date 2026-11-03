import { describe, expect, it } from "vitest";
import {
  parseUsdToMicro,
  RATE_WINDOW_MS,
  resolveSessionConfig,
  resolveSessionIssueConfig,
  resolveTurnConfig,
  SESSION_IP_WINDOW_MS,
  type AiConfigEnv,
} from "@/agents/llm/turn-config";

const SECRET = "test-session-secret-not-real-0123456789abcdef";
const env = (over: Partial<AiConfigEnv> = {}): AiConfigEnv => ({
  TWOKEY_SESSION_SECRET: SECRET,
  TWOKEY_SITE_ORIGIN: "https://twokey.afterscroll.workers.dev",
  TWOKEY_AI_BUDGET_USD: "1",
  TWOKEY_AI_SESSION_BUDGET_USD: "2.5",
  TWOKEY_AI_SESSION_TURNS_PER_MINUTE: "10",
  ...over,
});

describe("parseUsdToMicro", () => {
  it("converts a plain decimal dollar string to whole micro-dollars, exactly", () => {
    expect(parseUsdToMicro("1")).toBe(1_000_000);
    expect(parseUsdToMicro("0")).toBe(0);
    expect(parseUsdToMicro("2.5")).toBe(2_500_000);
    expect(parseUsdToMicro("0.000001")).toBe(1);
    expect(parseUsdToMicro(" 12.34 ")).toBe(12_340_000);
  });

  it("refuses anything else: empty, negative, exponent, too precise or too large", () => {
    for (const text of [undefined, "", "-1", "1e3", "0.0000001", "abc", "1.", ".5", "1,000", "1000000000"]) {
      expect(parseUsdToMicro(text)).toBeUndefined();
    }
  });
});

describe("resolveSessionConfig", () => {
  it("returns the secret and the origin policy", () => {
    expect(resolveSessionConfig(env(), false)).toEqual({
      ok: true,
      value: { sessionSecret: SECRET, origin: { siteOrigin: "https://twokey.afterscroll.workers.dev", development: false } },
    });
  });

  it("names every problem by variable, never by value", () => {
    const result = resolveSessionConfig(env({ TWOKEY_SESSION_SECRET: "tiny-value", TWOKEY_SITE_ORIGIN: "ftp://x" }), false);
    expect(result).toEqual({ ok: false, problems: ["TWOKEY_SESSION_SECRET:too_short", "TWOKEY_SITE_ORIGIN:invalid"] });
    expect(JSON.stringify(result)).not.toContain("tiny-value");
  });

  it("requires the site origin in production but not in development", () => {
    expect(resolveSessionConfig(env({ TWOKEY_SITE_ORIGIN: undefined }), false)).toEqual({ ok: false, problems: ["TWOKEY_SITE_ORIGIN:unset"] });
    expect(resolveSessionConfig(env({ TWOKEY_SITE_ORIGIN: undefined }), true)).toMatchObject({
      ok: true,
      value: { origin: { siteOrigin: undefined, development: true } },
    });
  });

  it("requires the session secret everywhere", () => {
    expect(resolveSessionConfig(env({ TWOKEY_SESSION_SECRET: undefined }), true)).toEqual({ ok: false, problems: ["TWOKEY_SESSION_SECRET:unset"] });
  });
});

describe("resolveSessionIssueConfig", () => {
  it("adds the per-IP cap over a rolling hour", () => {
    expect(resolveSessionIssueConfig(env({ TWOKEY_AI_SESSIONS_PER_IP_PER_HOUR: "5" }), false)).toMatchObject({
      ok: true,
      value: { sessionSecret: SECRET, ipLimit: { perWindow: 5, windowMs: SESSION_IP_WINDOW_MS } },
    });
    expect(SESSION_IP_WINDOW_MS).toBe(3_600_000);
  });

  it("refuses a missing or malformed cap instead of using a built-in number", () => {
    for (const value of [undefined, "", "five", "2.5", "-1"]) {
      expect(resolveSessionIssueConfig(env({ TWOKEY_AI_SESSIONS_PER_IP_PER_HOUR: value }), false)).toEqual({
        ok: false,
        problems: ["TWOKEY_AI_SESSIONS_PER_IP_PER_HOUR:invalid"],
      });
    }
  });

  it("includes the session problems too", () => {
    expect(resolveSessionIssueConfig(env({ TWOKEY_SESSION_SECRET: undefined, TWOKEY_AI_SESSIONS_PER_IP_PER_HOUR: "5" }), false)).toEqual({
      ok: false,
      problems: ["TWOKEY_SESSION_SECRET:unset"],
    });
  });
});

describe("resolveTurnConfig", () => {
  it("reads the limits from the vars and fixes the model on the server", () => {
    const result = resolveTurnConfig(env({ ANTHROPIC_API_KEY: "test-key-not-real" }), false);
    expect(result).toMatchObject({
      ok: true,
      value: {
        apiKey: "test-key-not-real",
        model: "claude-opus-5-5",
        limits: { totalBudgetMicroUsd: 1_000_000, sessionBudgetMicroUsd: 2_500_000, sessionTurnsPerWindow: 10, windowMs: RATE_WINDOW_MS },
      },
    });
  });

  it("treats a missing API key as 'live AI off', not as misconfiguration", () => {
    expect(resolveTurnConfig(env({ ANTHROPIC_API_KEY: "  " }), false)).toMatchObject({ ok: true, value: { apiKey: undefined } });
  });

  it("refuses missing or malformed limits instead of falling back to a built-in number", () => {
    const result = resolveTurnConfig(
      env({ TWOKEY_AI_BUDGET_USD: undefined, TWOKEY_AI_SESSION_BUDGET_USD: "lots", TWOKEY_AI_SESSION_TURNS_PER_MINUTE: "2.5" }),
      false,
    );
    expect(result).toEqual({
      ok: false,
      problems: ["TWOKEY_AI_BUDGET_USD:invalid", "TWOKEY_AI_SESSION_BUDGET_USD:invalid", "TWOKEY_AI_SESSION_TURNS_PER_MINUTE:invalid"],
    });
  });

  it("includes the session problems too", () => {
    expect(resolveTurnConfig(env({ TWOKEY_SESSION_SECRET: undefined }), false)).toEqual({ ok: false, problems: ["TWOKEY_SESSION_SECRET:unset"] });
  });
});
