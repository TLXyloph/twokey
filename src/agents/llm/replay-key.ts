/**
 * The replay key: a SHA-256 of the normalized request the server would send to the model. Two
 * requests share a key exactly when the model would read the same thing, so a recording made for
 * one is an honest answer to the other.
 *
 * Normalized means:
 * - only `system`, `messages`, `tools` and `tool_choice` count; the model, limits, betas,
 *   fallbacks and effort are server-fixed, and `cache_control` markers are billing hints;
 * - tool-call ids become positional labels (t0, t1, ... in order of first appearance), applied to
 *   both `tool_use.id` and `tool_result.tool_use_id`, so which result answers which call is kept.
 *   Studio seeds some agents' runs with tool calls whose ids embed a random run id;
 * - objects are serialized with sorted keys.
 * The replay label is stripped earlier, when the history is translated (translate-request.ts).
 */
import type { BetaMessageStreamParams } from "@anthropic-ai/sdk/resources/beta/messages/messages";

export const REPLAY_KEY_VERSION = "twokey-replay-v1";

export interface ReplayKeySource {
  system: unknown;
  messages: unknown;
  tools: unknown;
  tool_choice: unknown;
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

function stripCacheControl(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripCacheControl);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "cache_control").map(([key, item]) => [key, stripCacheControl(item)]));
}

function relabelToolIds(messages: unknown): unknown {
  const labels = new Map<string, string>();
  const label = (id: unknown): unknown => {
    if (typeof id !== "string") return id;
    if (!labels.has(id)) labels.set(id, `t${labels.size}`);
    return labels.get(id);
  };
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (!isObject(value)) return value;
    const copy = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item)]));
    if (copy.type === "tool_use") copy.id = label(copy.id);
    if (copy.type === "tool_result") copy.tool_use_id = label(copy.tool_use_id);
    return copy;
  };
  return visit(messages);
}

export function normalizeForReplay(params: BetaMessageStreamParams): ReplayKeySource {
  return {
    system: stripCacheControl(params.system ?? null),
    messages: relabelToolIds(stripCacheControl(params.messages)),
    tools: stripCacheControl(params.tools ?? null),
    tool_choice: params.tool_choice ?? null,
  };
}

/** JSON with object keys sorted at every depth; `undefined` members are dropped, as JSON.stringify does. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => (item === undefined ? "null" : canonicalJson(item))).join(",")}]`;
  if (isObject(value)) {
    const members = Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${members.join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function replayKey(params: BetaMessageStreamParams): Promise<string> {
  const text = `${REPLAY_KEY_VERSION}\n${canonicalJson(normalizeForReplay(params))}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
