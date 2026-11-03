import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi, type Mock } from "vitest";
import { createInMemoryAiTurnStore, type AiTurnStore, type TurnReservation } from "@/agents/llm/ai-turn-log";
import { liveTurn, type LiveTurnDeps } from "@/agents/llm/live-turn";
import { replayLines } from "@/agents/llm/replay";
import type { WireLine } from "@/agents/llm/wire";
import { fakeClient, fakeStream, hangingStream, message, textBlock, turnRequest, usage, type FakeClient } from "./fixtures";

const T0 = 1_790_000_000_000;
const reservation: TurnReservation = {
  turnId: "turn-1",
  sessionId: "session-a",
  model: "claude-opus-5-5",
  requestHash: "h".repeat(64),
  costMicroUsd: 900_000,
  at: T0,
};
const limits = { totalBudgetMicroUsd: 10_000_000, sessionBudgetMicroUsd: 10_000_000, sessionTurnsPerWindow: 10, windowMs: 60_000 };

async function setup(client: FakeClient, store: AiTurnStore = createInMemoryAiTurnStore()) {
  await store.turnLog.reserve(reservation, limits);
  const pending: Promise<unknown>[] = [];
  const deps: LiveTurnDeps & { log: Mock<(line: string) => void> } = {
    client,
    model: "claude-opus-5-5",
    store,
    reservation,
    now: () => T0 + 5000,
    log: vi.fn<(line: string) => void>(),
    waitUntil: (promise) => void pending.push(promise),
  };
  return { deps, store, settleBackground: () => Promise.all(pending) };
}

const collect = async (lines: AsyncIterable<WireLine>) => {
  const out: WireLine[] = [];
  for await (const line of lines) out.push(line);
  return out;
};

describe("liveTurn", () => {
  it("streams the turn, settles its actual cost before the terminal line, and records it for replay", async () => {
    const final = message([textBlock("Hello")], "end_turn", { usage: usage({ input_tokens: 1000, output_tokens: 1000 }) });
    const { deps, store, settleBackground } = await setup(fakeClient(fakeStream(final)));
    let committedAtTerminal: number | undefined;
    const lines: WireLine[] = [];
    for await (const line of liveTurn(deps, turnRequest("hi"), new AbortController().signal)) {
      if (line.type === "complete") committedAtTerminal = await store.turnLog.committedMicroUsd();
      lines.push(line);
    }
    expect(lines.at(-1)?.type).toBe("complete");
    expect(committedAtTerminal).toBe(24_000);
    await settleBackground();
    const recording = await store.recordings.find(reservation.requestHash);
    expect(recording).toMatchObject({ turnId: "turn-1", model: "claude-opus-5-5", recordedAt: T0 + 5000 });
    expect(replayLines(recording!).slice(1)).toEqual(
      lines.map((line): WireLine => (line.type === "complete" ? { type: "complete", response: { ...line.response, usage: undefined } } : line)).map(stripUndefined),
    );
  });

  it("settles a refused turn with its outcome and does not record it", async () => {
    const final = message([textBlock("partial")], "refusal");
    const { deps, store, settleBackground } = await setup(fakeClient(fakeStream(final)));
    const lines = await collect(liveTurn(deps, turnRequest(), new AbortController().signal));
    await settleBackground();
    expect(lines.at(-1)).toMatchObject({ type: "error", error: { code: "refusal" } });
    expect(await store.recordings.find(reservation.requestHash)).toBeUndefined();
    expect(await store.turnLog.committedMicroUsd()).toBe(Math.ceil((100 * 4000 + 50 * 20000) / 1000));
  });

  it("does not record a turn cut off by max_tokens", async () => {
    const { deps, store, settleBackground } = await setup(fakeClient(fakeStream(message([textBlock("cut")], "max_tokens"))));
    await collect(liveTurn(deps, turnRequest(), new AbortController().signal));
    await settleBackground();
    expect(await store.recordings.find(reservation.requestHash)).toBeUndefined();
  });

  it("settles in the background, at the usage seen so far, when the client stops reading mid-stream", async () => {
    let hung = false;
    const client = fakeClient((signal) => hangingStream(signal, new Anthropic.APIUserAbortError(), () => (hung = true)));
    const memory = createInMemoryAiTurnStore();
    const { deps, settleBackground } = await setup(client, memory);
    const controller = new AbortController();
    const iterator = liveTurn(deps, turnRequest(), controller.signal)[Symbol.asyncIterator]();
    const first = iterator.next();
    await vi.waitFor(() => expect(hung).toBe(true));
    controller.abort();
    await first;
    await iterator.return(undefined);
    await settleBackground();
    const settled = memory.events().find((event) => event.kind === "settled");
    expect(settled).toMatchObject({ kind: "settled", turnId: "turn-1", outcome: "aborted" });
    expect(settled?.costMicroUsd).toBeGreaterThan(0);
  });

  it("settles in the background when the reader goes away between events, before any terminal line", async () => {
    const memory = createInMemoryAiTurnStore();
    const { deps, settleBackground } = await setup(fakeClient(fakeStream(message([textBlock("Hello")]))), memory);
    const iterator = liveTurn(deps, turnRequest(), new AbortController().signal)[Symbol.asyncIterator]();
    expect(await iterator.next()).toMatchObject({ value: { type: "event", event: { type: "TEXT_MESSAGE_START" } } });
    await iterator.return(undefined);
    await settleBackground();
    const settled = memory.events().find((event) => event.kind === "settled");
    // The stream had reported message_start usage only: 100 input tokens and 1 output token.
    expect(settled).toMatchObject({ outcome: "aborted", costMicroUsd: 100 * 4 + 1 * 20 });
    expect(await memory.recordings.find(reservation.requestHash)).toBeUndefined();
  });

  it("still ends with its terminal line when settling or recording fails, and logs that it did", async () => {
    const memory = createInMemoryAiTurnStore();
    const failing: AiTurnStore = {
      turnLog: { ...memory.turnLog, settle: vi.fn(async () => Promise.reject(new Error("D1 down"))) },
      recordings: { ...memory.recordings, save: vi.fn(async () => Promise.reject(new Error("D1 down"))) },
    };
    const { deps, settleBackground } = await setup(fakeClient(fakeStream(message([textBlock("ok")]))), failing);
    const lines = await collect(liveTurn(deps, turnRequest(), new AbortController().signal));
    await settleBackground();
    expect(lines.at(-1)?.type).toBe("complete");
    const logged = deps.log.mock.calls.map(([line]) => String(line));
    expect(logged.some((line) => line.includes("settle=failed") && line.includes("turn=turn-1"))).toBe(true);
    expect(logged.some((line) => line.includes("record=failed"))).toBe(true);
    expect(logged.join("\n")).not.toContain("D1 down");
  });
});

function stripUndefined(line: WireLine): WireLine {
  return JSON.parse(JSON.stringify(line)) as WireLine;
}
