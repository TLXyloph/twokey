import { describe, expect, it } from "vitest";
import { createInMemoryAiTurnStore } from "@/agents/llm/ai-turn-log";
import { describeAiTurnStore, reservation } from "./ai-turn-log.contract";

describeAiTurnStore("in-memory store", createInMemoryAiTurnStore);

describe("createInMemoryAiTurnStore", () => {
  it("keeps every event as a frozen copy, in append order", async () => {
    const store = createInMemoryAiTurnStore();
    const original = reservation();
    await store.turnLog.reserve(original, { totalBudgetMicroUsd: 1e9, sessionBudgetMicroUsd: 1e9, sessionTurnsPerWindow: 9, windowMs: 60_000 });
    original.costMicroUsd = 1;
    const [event] = store.events();
    expect(event).toMatchObject({ kind: "reserved", turnId: "turn-1", costMicroUsd: 400_000 });
    expect(Object.isFrozen(event)).toBe(true);
  });
});
