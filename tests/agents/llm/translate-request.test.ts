import { describe, expect, it } from "vitest";
import type {
  AgAiConversationItem,
  AgAiInputContent,
  AgAiInputMessage,
  AgAiOutputMessage,
  AgAiReasoningItem,
  AgAiToolCall,
  AgAiToolCallResult,
  AgAiToolSchema,
} from "ag-studio";
import {
  buildMessageParams,
  cleanSchema,
  DEFAULT_MODEL,
  FALLBACK_BETA,
  MAX_TOKENS,
  REQUIRED_TOOL_INSTRUCTION,
  resolveModel,
  toAnthropicMessages,
  toAnthropicTools,
  toToolChoice,
} from "@/agents/llm/translate-request";
import { REPLAY_LABEL, type TurnRequest } from "@/agents/llm/wire";

const user = (text: string, extra: AgAiInputContent[] = []): AgAiInputMessage => ({
  id: `u-${text}`,
  kind: "input",
  type: "message",
  role: "user",
  content: [{ type: "text", text }, ...extra],
  status: "completed",
});
const system = (text: string): AgAiInputMessage => ({ ...user(text), id: `s-${text}`, role: "system" });
const assistant = (text: string): AgAiOutputMessage => ({
  id: `a-${text}`,
  kind: "output",
  type: "message",
  role: "assistant",
  status: "completed",
  content: [{ type: "text", text, annotations: [] }],
});
const call = (callId: string, name = "lookup", args = `{"q":"${callId}"}`): AgAiToolCall => ({
  id: `fc-${callId}`,
  kind: "output",
  type: "function_call",
  callId,
  name,
  arguments: args,
  status: "completed",
});
const output = (callId: string, text = `result ${callId}`): AgAiToolCallResult => ({
  type: "function_call_output",
  callId,
  output: text,
  status: "completed",
});
const reasoning = (id: string): AgAiReasoningItem => ({
  id,
  kind: "output",
  type: "reasoning",
  summary: [{ type: "summary", text: "private chain of thought" }],
  content: [{ type: "text", text: "private chain of thought" }],
});
const tool = (name: string, parameters: Record<string, unknown> = { type: "object", properties: {} }): AgAiToolSchema => ({
  name,
  description: `${name} tool`,
  parameters,
});
const request = (input: AgAiConversationItem[], extra: Partial<TurnRequest> = {}): TurnRequest => ({
  input,
  responseFormat: { type: "text" },
  ...extra,
});

describe("buildMessageParams: fixed server parameters", () => {
  it("fixes model, limits, effort, caching and the refusal fallback, and omits thinking", () => {
    const params = buildMessageParams(request([user("hi")]), DEFAULT_MODEL);
    expect(params.model).toBe("claude-opus-5-5");
    expect(params.max_tokens).toBe(MAX_TOKENS);
    expect(MAX_TOKENS).toBe(16000);
    expect(params.output_config).toEqual({ effort: "medium" });
    expect(params.cache_control).toEqual({ type: "ephemeral" });
    expect(params.betas).toEqual([FALLBACK_BETA]);
    expect(FALLBACK_BETA).toBe("server-side-fallback-2026-07-01");
    expect(params.fallbacks).toBe("default");
    expect("thinking" in params).toBe(false);
    expect("tools" in params).toBe(false);
    expect("tool_choice" in params).toBe(false);
  });

  it("uses the model it is given, never one from the request", () => {
    const sneaky = { ...request([user("hi")]), model: { id: "claude-haiku-4-5" } } as TurnRequest;
    expect(buildMessageParams(sneaky, "claude-sonnet-5-5").model).toBe("claude-sonnet-5-5");
  });

  it("resolves the model from TWOKEY_AI_MODEL, defaulting to Opus 5.5", () => {
    expect(resolveModel({})).toBe("claude-opus-5-5");
    expect(resolveModel({ TWOKEY_AI_MODEL: "  " })).toBe("claude-opus-5-5");
    expect(resolveModel({ TWOKEY_AI_MODEL: "claude-sonnet-5-5" })).toBe("claude-sonnet-5-5");
  });
});

describe("system assembly", () => {
  it("puts instructions first, then system messages in order, and caches the stable prefix", () => {
    const params = buildMessageParams(
      request([system("be terse"), user("hi"), system("now in review mode"), user("go")], { instructions: "You are TwoKey." }),
      DEFAULT_MODEL,
    );
    expect(params.system).toEqual([
      { type: "text", text: "You are TwoKey." },
      { type: "text", text: "be terse" },
      { type: "text", text: "now in review mode", cache_control: { type: "ephemeral" } },
    ]);
    expect(params.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "hi" }, { type: "text", text: "go" }] },
    ]);
  });

  it("omits system when there is nothing to say", () => {
    expect("system" in buildMessageParams(request([user("hi")]), DEFAULT_MODEL)).toBe(false);
  });

  it("adds a JSON-only instruction for a json response format, after the cached prefix", () => {
    const params = buildMessageParams(
      request([user("hi")], {
        instructions: "base",
        responseFormat: { type: "json", name: "verdict", description: "A verdict", schema: { type: "object" } },
      }),
      DEFAULT_MODEL,
    );
    const blocks = params.system as { text: string; cache_control?: unknown }[];
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({ type: "text", text: "base", cache_control: { type: "ephemeral" } });
    expect(blocks[1]?.cache_control).toBeUndefined();
    expect(blocks[1]?.text).toContain("only with JSON");
    expect(blocks[1]?.text).toContain("verdict");
    expect(blocks[1]?.text).toContain('{"type":"object"}');
  });
});

describe("toAnthropicMessages: content mapping", () => {
  it("maps data-URL images to base64, http(s) to URL images, and files to a placeholder", () => {
    const messages = toAnthropicMessages([
      user("look", [
        { type: "image", detail: "auto", imageUrl: "data:image/png;base64,iVBORw0KGgo=" },
        { type: "image", detail: "auto", imageUrl: "https://example.com/receipt.jpg" },
        { type: "image", detail: "auto", imageUrl: "ftp://example.com/x.png" },
        { type: "file", filename: "ledger.csv", fileData: "YSxi" },
      ]),
    ]);
    expect(messages).toHaveLength(1);
    const content = messages[0]?.content as { type: string }[];
    expect(content[0]).toEqual({ type: "text", text: "look" });
    expect(content[1]).toEqual({ type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } });
    expect(content[2]).toEqual({ type: "image", source: { type: "url", url: "https://example.com/receipt.jpg" } });
    expect(content[3]).toMatchObject({ type: "text" });
    expect(content[4]).toMatchObject({ type: "text", text: expect.stringContaining("ledger.csv") });
  });

  it("skips empty text parts", () => {
    expect(toAnthropicMessages([user(""), user("real")])).toEqual([
      { role: "user", content: [{ type: "text", text: "real" }] },
    ]);
  });

  it("prepends a minimal user turn when history does not start with the user", () => {
    const messages = toAnthropicMessages([assistant("hello"), user("hi")]);
    expect(messages[0]?.role).toBe("user");
    expect(messages[1]).toEqual({ role: "assistant", content: [{ type: "text", text: "hello" }] });
    expect(messages[2]).toEqual({ role: "user", content: [{ type: "text", text: "hi" }] });
  });

  it("appends a minimal user turn when history ends on the assistant (no prefill)", () => {
    const messages = toAnthropicMessages([user("hi"), assistant("partial")]);
    expect(messages.at(-1)?.role).toBe("user");
  });

  it("strips the replay label the browser showed, so the model never reads it", () => {
    const messages = toAnthropicMessages([user("hi"), assistant(`${REPLAY_LABEL}The answer.`), assistant(REPLAY_LABEL), user("more")]);
    expect(messages[1]).toEqual({ role: "assistant", content: [{ type: "text", text: "The answer." }] });
    expect(JSON.stringify(messages)).not.toContain("Replay of a recorded answer");
  });

  it("keeps the label's words when they are not the label prefix", () => {
    const messages = toAnthropicMessages([user("hi"), assistant(`Quote: ${REPLAY_LABEL}`)]);
    expect(messages[1]).toEqual({ role: "assistant", content: [{ type: "text", text: `Quote: ${REPLAY_LABEL}` }] });
  });
});

describe("toAnthropicMessages: tool call regrouping", () => {
  it("regroups interleaved parallel calls into one assistant turn and one user turn of results", () => {
    const messages = toAnthropicMessages([
      user("check both"),
      assistant("Checking both."),
      call("c1"),
      output("c1"),
      call("c2", "balance", "{}"),
      output("c2", "42"),
      assistant("Done."),
      user("thanks"),
    ]);
    expect(messages).toEqual([
      { role: "user", content: [{ type: "text", text: "check both" }] },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Checking both." },
          { type: "tool_use", id: "c1", name: "lookup", input: { q: "c1" } },
          { type: "tool_use", id: "c2", name: "balance", input: {} },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "c1", content: "result c1" },
          { type: "tool_result", tool_use_id: "c2", content: "42" },
        ],
      },
      { role: "assistant", content: [{ type: "text", text: "Done." }] },
      { role: "user", content: [{ type: "text", text: "thanks" }] },
    ]);
  });

  it("keeps tool results first when a user message follows them", () => {
    const messages = toAnthropicMessages([user("go"), call("c1"), output("c1"), user("and also")]);
    expect(messages[2]).toEqual({
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "c1", content: "result c1" },
        { type: "text", text: "and also" },
      ],
    });
  });

  it("drops reasoning items entirely, even between calls", () => {
    const messages = toAnthropicMessages([
      user("go"),
      reasoning("r1"),
      call("c1"),
      reasoning("r2"),
      output("c1"),
      reasoning("r3"),
      assistant("ok"),
    ]);
    const serialized = JSON.stringify(messages);
    expect(serialized).not.toContain("thinking");
    expect(serialized).not.toContain("private chain of thought");
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant", "user"]);
  });

  it("replaces unparseable arguments with {} and tells the model in the tool result", () => {
    const messages = toAnthropicMessages([user("go"), call("c1", "lookup", "{not json"), output("c1", "fine")]);
    expect(messages[1]?.content).toEqual([{ type: "tool_use", id: "c1", name: "lookup", input: {} }]);
    const [result] = messages[2]?.content as { type: string; content: string }[];
    expect(result?.content).toContain("not valid JSON");
    expect(result?.content).toContain("fine");
  });

  it("answers a call that has no recorded output with an error result", () => {
    const messages = toAnthropicMessages([user("go"), call("c1"), user("never mind")]);
    expect(messages[2]?.content).toEqual([
      { type: "tool_result", tool_use_id: "c1", is_error: true, content: expect.stringContaining("No result") },
      { type: "text", text: "never mind" },
    ]);
  });

  it("turns an output with no matching call into plain text", () => {
    const messages = toAnthropicMessages([user("go"), output("ghost", "orphaned")]);
    expect(JSON.stringify(messages)).not.toContain("tool_result");
    expect(JSON.stringify(messages)).toContain("orphaned");
  });
});

describe("toAnthropicTools", () => {
  it("maps name, description and parameters, skipping provider-hosted tools", () => {
    const tools = toAnthropicTools([
      tool("lookup", { type: "object", properties: { q: { type: "string" } }, required: ["q"] }),
      { ...tool("web_search"), kind: "provided", provider: { type: "web_search_20260209", name: "web_search" } },
      { ...tool("complete_task"), kind: "server" },
    ]);
    expect(tools).toEqual([
      {
        name: "lookup",
        description: "lookup tool",
        input_schema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
      },
      { name: "complete_task", description: "complete_task tool", input_schema: { type: "object", properties: {} } },
    ]);
    for (const t of tools) {
      expect("strict" in t).toBe(false);
      expect("eager_input_streaming" in t).toBe(false);
      expect("type" in t).toBe(false);
    }
  });
});

describe("cleanSchema", () => {
  it("strips {not:{}} branches, unwraps single-branch anyOf, and drops $schema at any depth", () => {
    const cleaned = cleanSchema({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        memo: { description: "optional memo", anyOf: [{ type: "string" }, { not: {} }] },
        amount: { anyOf: [{ type: "number" }, { type: "string" }, { not: {} }] },
        tags: { type: "array", items: { anyOf: [{ type: "string", $schema: "x" }, { not: {} }] } },
        $schema: { type: "string" },
      },
      $defs: { Money: { anyOf: [{ type: "integer" }, { not: {} }] } },
      default: { $schema: "kept because it is data" },
    });
    expect(cleaned).toEqual({
      type: "object",
      properties: {
        memo: { type: "string", description: "optional memo" },
        amount: { anyOf: [{ type: "number" }, { type: "string" }] },
        tags: { type: "array", items: { type: "string" } },
        $schema: { type: "string" },
      },
      $defs: { Money: { type: "integer" } },
      default: { $schema: "kept because it is data" },
    });
  });

  it("keeps a non-empty not schema", () => {
    expect(cleanSchema({ anyOf: [{ type: "string" }, { not: { type: "null" } }] })).toEqual({
      anyOf: [{ type: "string" }, { not: { type: "null" } }],
    });
  });
});

describe("toToolChoice", () => {
  it("maps auto, undefined and none directly", () => {
    expect(toToolChoice(undefined)).toEqual({ toolChoice: { type: "auto" } });
    expect(toToolChoice("auto")).toEqual({ toolChoice: { type: "auto" } });
    expect(toToolChoice("none")).toEqual({ toolChoice: { type: "none" } });
  });

  it("never forces a tool: required and {name} become auto plus an instruction", () => {
    expect(toToolChoice("required")).toEqual({ toolChoice: { type: "auto" }, instruction: REQUIRED_TOOL_INSTRUCTION });
    expect(REQUIRED_TOOL_INSTRUCTION).toBe("You must call one of the available tools in this turn.");
    expect(toToolChoice({ name: "complete_task" })).toEqual({
      toolChoice: { type: "auto" },
      instruction: "You must call the `complete_task` tool now; do not answer with text alone.",
    });
  });

  it("appends the forcing instruction as a trailing, uncached system block", () => {
    const params = buildMessageParams(
      request([user("finish")], { instructions: "base", tools: [tool("complete_task")], toolChoice: { name: "complete_task" } }),
      DEFAULT_MODEL,
    );
    expect(params.tool_choice).toEqual({ type: "auto" });
    expect(params.system).toEqual([
      { type: "text", text: "base", cache_control: { type: "ephemeral" } },
      { type: "text", text: "You must call the `complete_task` tool now; do not answer with text alone." },
    ]);
  });

  it("sends no tool_choice and no forcing instruction when no tools survive", () => {
    const params = buildMessageParams(
      request([user("hi")], { tools: [{ ...tool("web"), kind: "provided" }], toolChoice: "required" }),
      DEFAULT_MODEL,
    );
    expect("tools" in params).toBe(false);
    expect("tool_choice" in params).toBe(false);
    expect("system" in params).toBe(false);
  });
});
