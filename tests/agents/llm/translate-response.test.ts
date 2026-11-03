import { describe, expect, it } from "vitest";
import type { AgAiEvent } from "ag-studio";
import { blockMessageId, StreamTranslator, toAgLlmResponse, toAgUsage } from "@/agents/llm/translate-response";
import { eventsFor, fallbackBlock, message, textBlock, thinkingBlock, toolUseBlock, usage } from "./fixtures";

const translateAll = (events: ReturnType<typeof eventsFor>): AgAiEvent[] => {
  const translator = new StreamTranslator();
  return events.flatMap((event) => translator.translate(event));
};

describe("StreamTranslator", () => {
  it("maps a text block to TEXT_MESSAGE_START/CONTENT/END with a stable per-block messageId", () => {
    const events = eventsFor(message([textBlock("Hello")]));
    events.splice(3, 0, { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: " there" } });
    expect(translateAll(events)).toEqual([
      { type: "TEXT_MESSAGE_START", messageId: "msg_1-0", role: "assistant" },
      { type: "TEXT_MESSAGE_CONTENT", messageId: "msg_1-0", delta: "Hello" },
      { type: "TEXT_MESSAGE_CONTENT", messageId: "msg_1-0", delta: " there" },
      { type: "TEXT_MESSAGE_END", messageId: "msg_1-0" },
    ]);
    expect(blockMessageId("msg_1", 0)).toBe("msg_1-0");
  });

  it("maps a tool_use block to TOOL_CALL_START/ARGS/END keyed by the block id", () => {
    const events = eventsFor(message([textBlock("Checking."), toolUseBlock("toolu_1", "lookup", { q: "dues" })], "tool_use"));
    expect(translateAll(events)).toEqual([
      { type: "TEXT_MESSAGE_START", messageId: "msg_1-0", role: "assistant" },
      { type: "TEXT_MESSAGE_CONTENT", messageId: "msg_1-0", delta: "Checking." },
      { type: "TEXT_MESSAGE_END", messageId: "msg_1-0" },
      { type: "TOOL_CALL_START", toolCallId: "toolu_1", toolCallName: "lookup" },
      { type: "TOOL_CALL_ARGS", toolCallId: "toolu_1", delta: '{"q":"dues"}' },
      { type: "TOOL_CALL_END", toolCallId: "toolu_1" },
    ]);
  });

  it("ignores thinking, fallback and unknown blocks along with their deltas", () => {
    const events = eventsFor(message([thinkingBlock(), fallbackBlock(), textBlock("ok")]));
    events.splice(2, 0, { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "hmm", estimated_tokens: null } });
    expect(translateAll(events)).toEqual([
      { type: "TEXT_MESSAGE_START", messageId: "msg_1-2", role: "assistant" },
      { type: "TEXT_MESSAGE_CONTENT", messageId: "msg_1-2", delta: "ok" },
      { type: "TEXT_MESSAGE_END", messageId: "msg_1-2" },
    ]);
    const types = translateAll(events).map((event) => event.type);
    expect(types.some((type) => type.startsWith("REASONING"))).toBe(false);
  });

  it("emits nothing for a text block that never receives text", () => {
    const events = eventsFor(message([textBlock("")]));
    expect(translateAll(events)).toEqual([]);
  });

  it("tracks the token usage reported so far, for turns that never finish", () => {
    const translator = new StreamTranslator();
    expect(translator.usageSoFar()).toBeUndefined();
    const [start, ...rest] = eventsFor(message([textBlock("hi")], "end_turn", { usage: usage({ output_tokens: 42, cache_read_input_tokens: 7 }) }));
    translator.translate(start!);
    expect(translator.usageSoFar()).toMatchObject({ input_tokens: 100, output_tokens: 1 });
    rest.forEach((event) => translator.translate(event));
    expect(translator.usageSoFar()).toMatchObject({ input_tokens: 100, output_tokens: 42, cache_read_input_tokens: 0 });
  });
});

describe("toAgLlmResponse", () => {
  const now = () => 1_700_000_000_000;

  it("maps text and tool_use blocks to Studio output items, in order", () => {
    const response = toAgLlmResponse(
      message([textBlock("Checking."), toolUseBlock("toolu_1", "lookup", { q: "dues" })], "tool_use"),
      now,
    );
    expect(response).toMatchObject({ id: "msg_1", createdAt: 1_700_000_000_000, model: "claude-opus-5-5", status: "completed" });
    expect(response.incompleteDetails).toBeUndefined();
    expect(response.output).toEqual([
      {
        id: "msg_1-0",
        kind: "output",
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "text", text: "Checking.", annotations: [] }],
      },
      {
        id: "toolu_1",
        kind: "output",
        type: "function_call",
        callId: "toolu_1",
        name: "lookup",
        arguments: '{"q":"dues"}',
        status: "completed",
      },
    ]);
  });

  it("maps usage, counting cache reads and writes inside inputTokens", () => {
    expect(
      toAgUsage(usage({ input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 300, cache_creation_input_tokens: 40 })),
    ).toEqual({ inputTokens: 350, outputTokens: 20, totalTokens: 370, cachedInputTokens: 300, cacheWriteTokens: 40 });
    expect(toAgUsage(usage({ output_tokens_details: { thinking_tokens: 12 } }))).toMatchObject({ reasoningTokens: 12 });
  });

  it("reports max_tokens as incomplete and drops a trailing tool call that may be truncated", () => {
    const response = toAgLlmResponse(
      message([textBlock("Paying out"), toolUseBlock("toolu_1", "approve_payout", { amount: 1 })], "max_tokens"),
      now,
    );
    expect(response.status).toBe("incomplete");
    expect(response.incompleteDetails).toEqual({ reason: "max_output_tokens" });
    expect(response.output.map((item) => item.type)).toEqual(["message"]);
  });

  it("ignores thinking and fallback blocks and drops tool calls from a declined partial", () => {
    const response = toAgLlmResponse(
      message([
        thinkingBlock(),
        textBlock("Partial before decline. "),
        toolUseBlock("toolu_declined", "lookup", {}),
        fallbackBlock(),
        textBlock("Fallback answer."),
        toolUseBlock("toolu_ok", "lookup", { q: 1 }),
      ], "tool_use"),
      now,
    );
    expect(response.output.map((item) => item.id)).toEqual(["msg_1-1", "msg_1-4", "toolu_ok"]);
  });
});
