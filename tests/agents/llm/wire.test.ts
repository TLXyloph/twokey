import { describe, expect, it } from "vitest";
import { createLineDecoder, encodeLine, REPLAY_LABEL, type WireLine } from "@/agents/llm/wire";

const errorLine: WireLine = { type: "error", error: { code: "refusal", message: "declined" } };

describe("wire NDJSON contract", () => {
  it("round-trips a line through encode and decode", () => {
    const decoder = createLineDecoder();
    expect(decoder.push(encodeLine(errorLine))).toEqual([errorLine]);
  });

  it("buffers a line split across chunks until its newline arrives", () => {
    const decoder = createLineDecoder();
    const text = encodeLine(errorLine);
    expect(decoder.push(text.slice(0, 10))).toEqual([]);
    expect(decoder.push(text.slice(10))).toEqual([errorLine]);
  });

  it("returns several lines from one chunk, skipping blank lines", () => {
    const decoder = createLineDecoder();
    expect(decoder.push(`${encodeLine(errorLine)}\n${encodeLine(errorLine)}`)).toHaveLength(2);
  });

  it("flushes a trailing line that has no newline", () => {
    const decoder = createLineDecoder();
    decoder.push(JSON.stringify(errorLine));
    expect(decoder.flush()).toEqual([errorLine]);
  });

  it("rejects a line with an unknown type", () => {
    const decoder = createLineDecoder();
    expect(() => decoder.push('{"type":"surprise"}\n')).toThrow(/unknown type/);
  });

  it("accepts the replay marker line that opens a replayed stream", () => {
    const replay: WireLine = { type: "replay", replay: { recordedAt: 1_790_000_000_000 } };
    expect(createLineDecoder().push(encodeLine(replay))).toEqual([replay]);
  });
});

describe("REPLAY_LABEL", () => {
  it("names the replay in words a judge reads, and ends in a paragraph break", () => {
    expect(REPLAY_LABEL).toContain("Replay of a recorded answer");
    expect(REPLAY_LABEL.endsWith("\n\n")).toBe(true);
  });
});
