import { describe, expect, it, vi } from "vitest";
import { decodeRiskRecording, encodeRiskRecording, loadRecordedCards, RISK_RECORDING_KIND } from "@/disbursements/risk/recorded";
import committed from "@/disbursements/risk/recorded-cards.json";
import { paintAnswer } from "../../agents/treasurer/fixtures";

const KEY = "c".repeat(64);
const entry = (over: Record<string, unknown> = {}) => ({
  label: "L15 field-paint reimbursement (seed)",
  model: "claude-opus-5-5",
  recordedAt: "2026-11-05T20:00:00.000Z",
  costUsd: 0.021,
  answer: paintAnswer(),
  ...over,
});

describe("loadRecordedCards", () => {
  it("loads entries keyed by replay key", () => {
    const cards = loadRecordedCards({ [KEY]: entry() });
    expect(cards.get(KEY)).toEqual({ model: "claude-opus-5-5", recordedAt: "2026-11-05T20:00:00.000Z", answer: paintAnswer() });
  });

  it("skips (and logs by key prefix) entries with a bad key, a bad answer or extra fields", () => {
    const log = vi.fn();
    const cards = loadRecordedCards(
      {
        "not-a-key": entry(),
        ["d".repeat(64)]: entry({ answer: { ...paintAnswer(), totalCents: 36.5 } }),
        ["e".repeat(64)]: entry({ prompt: "leaked" }),
        [KEY]: entry(),
      },
      log,
    );
    expect([...cards.keys()]).toEqual([KEY]);
    expect(log).toHaveBeenCalledTimes(3);
    expect(log.mock.calls.flat().join("\n")).not.toContain("leaked");
  });

  it("treats anything but an object as empty", () => {
    expect(loadRecordedCards(null).size).toBe(0);
    expect(loadRecordedCards([entry()]).size).toBe(0);
  });

  it("loads the committed file without skipping anything", () => {
    const log = vi.fn();
    const cards = loadRecordedCards(committed, log);
    expect(log).not.toHaveBeenCalled();
    expect(cards.size).toBe(Object.keys(committed).length);
  });
});

describe("the replay store's encoding", () => {
  it("round-trips an answer, marked with its kind", () => {
    const text = encodeRiskRecording(paintAnswer());
    expect(JSON.parse(text).kind).toBe(RISK_RECORDING_KIND);
    expect(decodeRiskRecording(text)).toEqual(paintAnswer());
  });

  it("returns null for a chat turn's NDJSON, another kind, or an invalid answer", () => {
    expect(decodeRiskRecording('{"type":"event"}\n{"type":"complete"}\n')).toBeNull();
    expect(decodeRiskRecording(JSON.stringify({ kind: "other", answer: paintAnswer() }))).toBeNull();
    expect(decodeRiskRecording(JSON.stringify({ kind: RISK_RECORDING_KIND, answer: { vendor: 1 } }))).toBeNull();
  });
});
