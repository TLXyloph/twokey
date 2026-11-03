/**
 * Behaviour every AiTurnStore must have, run against the in-memory store and the D1 store (on real
 * SQLite with the real migration). Not a test file itself: the two suites import it.
 */
import { describe, expect, it } from "vitest";
import type { AiTurnStore, TurnReservation } from "@/agents/llm/ai-turn-log";
import type { AiLimits } from "@/agents/llm/turn-config";

const limits: AiLimits = { totalBudgetMicroUsd: 1_000_000, sessionBudgetMicroUsd: 600_000, sessionTurnsPerWindow: 3, windowMs: 60_000 };
const T0 = 1_790_000_000_000;

export const reservation = (over: Partial<TurnReservation> = {}): TurnReservation => ({
  turnId: "turn-1",
  sessionId: "session-a",
  model: "claude-opus-5-5",
  requestHash: "a".repeat(64),
  costMicroUsd: 400_000,
  at: T0,
  ...over,
});

const settlement = (turnId: string, sessionId: string, costMicroUsd: number, at = T0 + 1000) => ({
  turnId,
  sessionId,
  model: "claude-opus-5-5",
  costMicroUsd,
  outcome: "complete",
  usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0 },
  at,
});

export function describeAiTurnStore(name: string, makeStore: () => AiTurnStore): void {
  describe(`${name}: reservations`, () => {
    it("reserves a turn that fits every limit and counts it toward spend until it settles", async () => {
      const { turnLog } = makeStore();
      expect(await turnLog.reserve(reservation(), limits)).toBe("reserved");
      expect(await turnLog.committedMicroUsd()).toBe(400_000);
      await turnLog.settle(settlement("turn-1", "session-a", 12_345));
      expect(await turnLog.committedMicroUsd()).toBe(12_345);
      expect(await turnLog.committedMicroUsd("session-a")).toBe(12_345);
      expect(await turnLog.committedMicroUsd("session-b")).toBe(0);
    });

    it("refuses a reservation that would push the session past its share", async () => {
      const { turnLog } = makeStore();
      expect(await turnLog.reserve(reservation(), limits)).toBe("reserved");
      expect(await turnLog.reserve(reservation({ turnId: "turn-2", costMicroUsd: 200_001 }), limits)).toBe("session_budget");
      expect(await turnLog.reserve(reservation({ turnId: "turn-3", costMicroUsd: 200_000 }), limits)).toBe("reserved");
    });

    it("refuses a reservation that would push all sessions together past the hard total", async () => {
      const { turnLog } = makeStore();
      expect(await turnLog.reserve(reservation({ sessionId: "s1", costMicroUsd: 500_000 }), limits)).toBe("reserved");
      expect(await turnLog.reserve(reservation({ turnId: "turn-2", sessionId: "s2", costMicroUsd: 500_001 }), limits)).toBe("total_budget");
      expect(await turnLog.reserve(reservation({ turnId: "turn-3", sessionId: "s2", costMicroUsd: 500_000 }), limits)).toBe("reserved");
      expect(await turnLog.committedMicroUsd()).toBe(1_000_000);
    });

    it("frees the unused part of a reservation once the turn settles", async () => {
      const { turnLog } = makeStore();
      const wide = { ...limits, sessionBudgetMicroUsd: 1_000_000 };
      expect(await turnLog.reserve(reservation({ sessionId: "s1", costMicroUsd: 900_000 }), wide)).toBe("reserved");
      expect(await turnLog.reserve(reservation({ turnId: "turn-2", sessionId: "s2", costMicroUsd: 400_000 }), wide)).toBe("total_budget");
      await turnLog.settle(settlement("turn-1", "s1", 50_000));
      expect(await turnLog.reserve(reservation({ turnId: "turn-3", sessionId: "s2", costMicroUsd: 400_000 }), wide)).toBe("reserved");
    });

    it("refuses a fourth turn in the session's window, then admits it once the window slides", async () => {
      const { turnLog } = makeStore();
      const big = { totalBudgetMicroUsd: 100_000_000, sessionBudgetMicroUsd: 100_000_000 };
      for (let i = 0; i < 3; i++) {
        expect(await turnLog.reserve(reservation({ turnId: `t${i}`, at: T0 + i }), { ...limits, ...big })).toBe("reserved");
      }
      expect(await turnLog.reserve(reservation({ turnId: "t3", at: T0 + 10 }), { ...limits, ...big })).toBe("rate_limited");
      expect(await turnLog.reserve(reservation({ turnId: "t4", sessionId: "other", at: T0 + 10 }), { ...limits, ...big })).toBe("reserved");
      expect(await turnLog.reserve(reservation({ turnId: "t5", at: T0 + 60_001 }), { ...limits, ...big })).toBe("reserved");
    });

    it("counts replayed turns toward the rate, but not toward spend", async () => {
      const { turnLog } = makeStore();
      for (let i = 0; i < 3; i++) {
        await turnLog.recordReplay({ turnId: `r${i}`, sessionId: "session-a", requestHash: "b".repeat(64), outcome: i ? "hit" : "miss", at: T0 + i });
      }
      expect(await turnLog.countRecentTurns("session-a", T0 - 1)).toBe(3);
      expect(await turnLog.countRecentTurns("session-a", T0 + 1)).toBe(1);
      expect(await turnLog.committedMicroUsd()).toBe(0);
      expect(await turnLog.reserve(reservation({ at: T0 + 5 }), limits)).toBe("rate_limited");
    });

    it("settles a turn once: a second settlement is ignored", async () => {
      const { turnLog } = makeStore();
      await turnLog.reserve(reservation(), limits);
      await turnLog.settle(settlement("turn-1", "session-a", 10));
      await turnLog.settle(settlement("turn-1", "session-a", 999_999));
      expect(await turnLog.committedMicroUsd()).toBe(10);
    });

    it("refuses to settle a turn that was never reserved", async () => {
      const { turnLog } = makeStore();
      await expect(turnLog.settle(settlement("ghost", "session-a", 10))).rejects.toThrow(/without a reservation/);
    });
  });

  describe(`${name}: recordings`, () => {
    const recording = (over = {}) => ({ requestHash: "c".repeat(64), turnId: "turn-1", model: "claude-opus-5-5", recordedAt: T0, ndjson: '{"type":"complete"}\n', ...over });

    it("finds a saved recording by its key, and keeps the first one saved", async () => {
      const { recordings } = makeStore();
      expect(await recordings.find("c".repeat(64))).toBeUndefined();
      expect(await recordings.save(recording())).toBe("stored");
      expect(await recordings.save(recording({ turnId: "turn-2", ndjson: "other" }))).toBe("duplicate");
      expect(await recordings.find("c".repeat(64))).toEqual(recording());
    });
  });
}
