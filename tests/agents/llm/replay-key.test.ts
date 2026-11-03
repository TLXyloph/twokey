import type { AgAiConversationItem, AgAiOutputMessage } from "ag-studio";
import { describe, expect, it } from "vitest";
import { canonicalJson, normalizeForReplay, replayKey } from "@/agents/llm/replay-key";
import { buildMessageParams } from "@/agents/llm/translate-request";
import { REPLAY_LABEL, type TurnRequest } from "@/agents/llm/wire";
import { turnRequest, userMessage } from "./fixtures";

const tool = { name: "compare_event_takings", description: "Compare", parameters: { type: "object", properties: {} } };
const keyOf = (request: TurnRequest, model = "claude-opus-5-5") => replayKey(buildMessageParams(request, model));

const call = (callId: string, name = "view_page"): AgAiConversationItem => ({
  id: callId,
  kind: "output",
  type: "function_call",
  callId,
  name,
  arguments: "{}",
  status: "completed",
});
const output = (callId: string, text: string): AgAiConversationItem => ({ type: "function_call_output", callId, output: text, status: "completed" });
const assistantText = (text: string): AgAiOutputMessage => ({
  id: "a1",
  kind: "output",
  type: "message",
  role: "assistant",
  status: "completed",
  content: [{ type: "text", text, annotations: [] }],
});

describe("replayKey", () => {
  it("is a stable SHA-256 hex digest of the request", async () => {
    const key = await keyOf(turnRequest("Where did the car-wash money go?"));
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(await keyOf(turnRequest("Where did the car-wash money go?"))).toBe(key);
  });

  it("ignores what the server fixes: model, limits, betas, fallbacks and cache markers", async () => {
    const params = buildMessageParams(turnRequest("hi", { instructions: "Be brief." }), "claude-opus-5-5");
    const changed = { ...params, model: "claude-sonnet-5-5", max_tokens: 10, betas: [], fallbacks: undefined, output_config: undefined, cache_control: undefined };
    const unmarked = JSON.parse(JSON.stringify(params).replaceAll(',"cache_control":{"type":"ephemeral"}', "")) as typeof params;
    expect(await replayKey(changed)).toBe(await replayKey(params));
    expect(await replayKey(unmarked)).toBe(await replayKey(params));
  });

  it("changes with anything the model reads: the question, instructions, tools or tool choice", async () => {
    const base = await keyOf(turnRequest("hi", { instructions: "A", tools: [tool], toolChoice: "auto" }));
    const variants = [
      turnRequest("hi!", { instructions: "A", tools: [tool], toolChoice: "auto" }),
      turnRequest("hi", { instructions: "B", tools: [tool], toolChoice: "auto" }),
      turnRequest("hi", { instructions: "A", tools: [{ ...tool, description: "Compare!" }], toolChoice: "auto" }),
      turnRequest("hi", { instructions: "A", tools: [tool], toolChoice: "none" }),
    ];
    for (const variant of variants) expect(await keyOf(variant)).not.toBe(base);
  });

  it("treats tool-call ids as labels, so Studio's random preflight ids still match", async () => {
    const run = (runId: string) =>
      turnRequest("Add a chart", {
        input: [userMessage("Add a chart"), call(`${runId}-preflight-0`), output(`${runId}-preflight-0`, "page A"), call(`${runId}-preflight-1`, "view_plan"), output(`${runId}-preflight-1`, "plan")],
      });
    expect(await keyOf(run("run-1111"))).toBe(await keyOf(run("run-2222")));
  });

  it("still tells apart which result belongs to which call", async () => {
    const pair = (first: string, second: string) =>
      turnRequest("x", { input: [userMessage("x"), call("a"), output("a", first), call("b", "view_plan"), output("b", second)] });
    expect(await keyOf(pair("one", "two"))).not.toBe(await keyOf(pair("two", "one")));
  });

  it("matches a history whose earlier answer carries the replay label to the same history without it", async () => {
    const history = (answer: string) =>
      turnRequest("Follow-up", { input: [userMessage("Where did the car-wash money go?"), assistantText(answer), userMessage("Follow-up")] });
    expect(await keyOf(history(`${REPLAY_LABEL}The car wash raised $15.`))).toBe(await keyOf(history("The car wash raised $15.")));
  });
});

describe("normalizeForReplay", () => {
  it("keeps only system, messages, tools and tool choice", () => {
    const params = buildMessageParams(turnRequest("hi", { tools: [tool] }), "claude-opus-5-5");
    expect(Object.keys(normalizeForReplay(params)).sort()).toEqual(["messages", "system", "tool_choice", "tools"]);
  });
});

describe("canonicalJson", () => {
  it("sorts object keys at every depth and keeps array order", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: null } })).toBe('{"a":{"c":null,"d":[3,{"y":2,"z":1}]},"b":1}');
    expect(canonicalJson({ a: undefined, b: 2 })).toBe('{"b":2}');
  });
});
