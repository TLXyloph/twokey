import type { AgLlmResponse } from "ag-studio";
import { describe, expect, it } from "vitest";
import {
  createRecordingBuffer,
  MAX_RECORDING_BYTES,
  replayLines,
  UNAVAILABLE_MESSAGES,
  unavailableLines,
} from "@/agents/llm/replay";
import type { TurnRecording } from "@/agents/llm/ai-turn-log";
import { createLineDecoder, type WireLine } from "@/agents/llm/wire";

const response: AgLlmResponse = {
  id: "msg_1",
  createdAt: 1_790_000_000_000,
  status: "completed",
  model: "claude-opus-5-5",
  output: [{ id: "msg_1-0", kind: "output", type: "message", role: "assistant", status: "completed", content: [{ type: "text", text: "Hello there", annotations: [] }] }],
  usage: { inputTokens: 100, outputTokens: 5, totalTokens: 105 },
};
const complete: Extract<WireLine, { type: "complete" }> = { type: "complete", response };
const ev = (event: Extract<WireLine, { type: "event" }>["event"]): WireLine => ({ type: "event", event });
const decode = (ndjson: string) => {
  const decoder = createLineDecoder();
  return [...decoder.push(ndjson), ...decoder.flush()];
};
const recording = (ndjson: string): TurnRecording => ({ requestHash: "h", turnId: "turn-1", model: "claude-opus-5-5", recordedAt: 1_790_000_000_000, ndjson });

describe("createRecordingBuffer", () => {
  it("records the turn's lines, joining consecutive text and tool-argument deltas", () => {
    const buffer = createRecordingBuffer();
    buffer.add(ev({ type: "TEXT_MESSAGE_START", messageId: "m", role: "assistant" }));
    buffer.add(ev({ type: "TEXT_MESSAGE_CONTENT", messageId: "m", delta: "Hello" }));
    buffer.add(ev({ type: "TEXT_MESSAGE_CONTENT", messageId: "m", delta: " there" }));
    buffer.add(ev({ type: "TEXT_MESSAGE_END", messageId: "m" }));
    buffer.add(ev({ type: "TOOL_CALL_START", toolCallId: "t", toolCallName: "lookup" }));
    buffer.add(ev({ type: "TOOL_CALL_ARGS", toolCallId: "t", delta: '{"q":' }));
    buffer.add(ev({ type: "TOOL_CALL_ARGS", toolCallId: "t", delta: '"dues"}' }));
    buffer.add(ev({ type: "TOOL_CALL_END", toolCallId: "t" }));
    const ndjson = buffer.finish(complete);
    expect(ndjson).toBeDefined();
    expect(decode(ndjson!)).toEqual([
      ev({ type: "TEXT_MESSAGE_START", messageId: "m", role: "assistant" }),
      ev({ type: "TEXT_MESSAGE_CONTENT", messageId: "m", delta: "Hello there" }),
      ev({ type: "TEXT_MESSAGE_END", messageId: "m" }),
      ev({ type: "TOOL_CALL_START", toolCallId: "t", toolCallName: "lookup" }),
      ev({ type: "TOOL_CALL_ARGS", toolCallId: "t", delta: '{"q":"dues"}' }),
      ev({ type: "TOOL_CALL_END", toolCallId: "t" }),
      complete,
    ]);
  });

  it("does not join deltas of different messages", () => {
    const buffer = createRecordingBuffer();
    buffer.add(ev({ type: "TEXT_MESSAGE_CONTENT", messageId: "a", delta: "1" }));
    buffer.add(ev({ type: "TEXT_MESSAGE_CONTENT", messageId: "b", delta: "2" }));
    expect(decode(buffer.finish(complete)!)).toHaveLength(3);
  });

  it("gives up on a recording too large for one D1 row", () => {
    const buffer = createRecordingBuffer();
    buffer.add(ev({ type: "TEXT_MESSAGE_CONTENT", messageId: "m", delta: "x".repeat(MAX_RECORDING_BYTES) }));
    expect(buffer.finish(complete)).toBeUndefined();
  });
});

describe("replayLines", () => {
  it("opens with the replay marker, then the recorded events and response, without the original usage", () => {
    const buffer = createRecordingBuffer();
    buffer.add(ev({ type: "TEXT_MESSAGE_START", messageId: "m", role: "assistant" }));
    const lines = replayLines(recording(buffer.finish(complete)!));
    expect(lines[0]).toEqual({ type: "replay", replay: { recordedAt: 1_790_000_000_000 } });
    expect(lines[1]).toEqual(ev({ type: "TEXT_MESSAGE_START", messageId: "m", role: "assistant" }));
    const { usage: _usage, ...withoutUsage } = response;
    expect(lines[2]).toEqual({ type: "complete", response: withoutUsage });
    expect(lines).toHaveLength(3);
  });

  it.each([
    ["no complete line", '{"type":"event","event":{"type":"TEXT_MESSAGE_END","messageId":"m"}}\n'],
    ["an error terminal", '{"type":"error","error":{"code":"refusal","message":"no"}}\n'],
    ["lines after complete", `${JSON.stringify(complete)}\n${JSON.stringify(complete)}\n`],
    ["not JSON", "garbage\n"],
  ])("refuses a corrupt recording (%s)", (_name, ndjson) => {
    expect(() => replayLines(recording(ndjson))).toThrow(/recording/);
  });
});

describe("unavailableLines", () => {
  it("answers with one plain message and a completed response that calls no tools", () => {
    const lines = unavailableLines("total_budget", "turn-9", () => 1_790_000_000_123);
    const text = UNAVAILABLE_MESSAGES.total_budget;
    expect(text).toBe("The live AI budget for this demo is used up. Try one of the suggested questions.");
    expect(lines).toEqual([
      ev({ type: "TEXT_MESSAGE_START", messageId: "twokey-unavailable-turn-9", role: "assistant" }),
      ev({ type: "TEXT_MESSAGE_CONTENT", messageId: "twokey-unavailable-turn-9", delta: text }),
      ev({ type: "TEXT_MESSAGE_END", messageId: "twokey-unavailable-turn-9" }),
      {
        type: "complete",
        response: {
          id: "twokey-unavailable-turn-9",
          createdAt: 1_790_000_000_123,
          status: "completed",
          output: [{ id: "twokey-unavailable-turn-9", kind: "output", type: "message", role: "assistant", status: "completed", content: [{ type: "text", text, annotations: [] }] }],
        },
      },
    ]);
  });

  it("says why, truthfully, for each reason", () => {
    expect(UNAVAILABLE_MESSAGES.session_budget).toMatch(/this session/i);
    expect(UNAVAILABLE_MESSAGES.off).toMatch(/switched off/i);
    for (const message of Object.values(UNAVAILABLE_MESSAGES)) expect(message).toMatch(/suggested questions/);
  });
});
