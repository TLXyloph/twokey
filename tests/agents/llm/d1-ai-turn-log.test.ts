import { describe, expect, it } from "vitest";
import { createD1AiTurnLog, createD1AiTurnStore, createD1RecordingStore, RESERVE_TURN_SQL } from "@/agents/llm/d1-ai-turn-log";
import type { D1DatabaseLike, D1Value } from "@/platform/cloudflare-env";
import { describeAiTurnStore, reservation } from "./ai-turn-log.contract";
import { sqlite, sqliteD1 } from "./sqlite-d1";

const limits = { totalBudgetMicroUsd: 1_000_000, sessionBudgetMicroUsd: 1_000_000, sessionTurnsPerWindow: 5, windowMs: 60_000 };

describe.skipIf(!sqlite)("D1 store on SQLite with 0002_ai_turns.sql", () => {
  describeAiTurnStore("D1 store", () => createD1AiTurnStore(sqliteD1().db));

  it("appends nothing when a reservation is refused", async () => {
    const { db, all } = sqliteD1();
    const log = createD1AiTurnLog(db);
    expect(await log.reserve(reservation({ costMicroUsd: 1_000_001 }), limits)).toBe("session_budget");
    expect(all("SELECT COUNT(*) AS n FROM ai_turn_events")).toEqual([{ n: 0 }]);
  });

  it("stores the reservation with its worst case, hash and model", async () => {
    const { db, all } = sqliteD1();
    await createD1AiTurnLog(db).reserve(reservation(), limits);
    expect(all("SELECT turn_id, kind, session_id, model, request_hash, cost_micro_usd, outcome FROM ai_turn_events")).toEqual([
      { turn_id: "turn-1", kind: "reserved", session_id: "session-a", model: "claude-opus-5-5", request_hash: "a".repeat(64), cost_micro_usd: 400_000, outcome: null },
    ]);
  });

  it("refuses UPDATE and DELETE on both tables (append-only)", async () => {
    const { db, exec, all } = sqliteD1();
    const store = createD1AiTurnStore(db);
    await store.turnLog.reserve(reservation(), limits);
    await store.recordings.save({ requestHash: "c".repeat(64), turnId: "turn-1", model: "m", recordedAt: 1, ndjson: "x" });
    expect(() => exec("UPDATE ai_turn_events SET cost_micro_usd = 0")).toThrow(/append-only/);
    expect(() => exec("DELETE FROM ai_turn_events")).toThrow(/append-only/);
    expect(() => exec("UPDATE ai_turn_recordings SET ndjson = 'y'")).toThrow(/append-only/);
    expect(() => exec("DELETE FROM ai_turn_recordings")).toThrow(/append-only/);
    expect(all("SELECT cost_micro_usd FROM ai_turn_events")).toEqual([{ cost_micro_usd: 400_000 }]);
  });

  it("refuses a settlement from another session than the reservation's", async () => {
    const { db } = sqliteD1();
    const log = createD1AiTurnLog(db);
    await log.reserve(reservation(), limits);
    const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    await expect(log.settle({ turnId: "turn-1", sessionId: "intruder", model: "m", costMicroUsd: 0, outcome: "complete", usage, at: 2 })).rejects.toThrow(
      /without a reservation/,
    );
  });

  it("enforces the event shapes: kinds, negative costs, replay outcomes", () => {
    const { exec } = sqliteD1();
    const insert = (columns: string, values: string) => () => exec(`INSERT INTO ai_turn_events (${columns}) VALUES (${values})`);
    expect(insert("turn_id, kind, session_id, occurred_at", "'t', 'refunded', 's', 1")).toThrow(/CHECK/);
    expect(insert("turn_id, kind, session_id, occurred_at, model, request_hash, cost_micro_usd", "'t', 'reserved', 's', 1, 'm', 'h', -5")).toThrow(/CHECK/);
    expect(insert("turn_id, kind, session_id, occurred_at, request_hash, outcome", "'t', 'replayed', 's', 1, 'h', 'maybe'")).toThrow(/CHECK/);
    expect(insert("turn_id, kind, session_id, occurred_at, request_hash, outcome, cost_micro_usd", "'t', 'replayed', 's', 1, 'h', 'hit', 7")).toThrow(/CHECK/);
    expect(insert("turn_id, kind, session_id, occurred_at", "'t', 'reserved', 's', 1")).toThrow(/CHECK/);
  });
});

describe("D1 store, mock-first", () => {
  it("fails closed when the binding cannot return rows, instead of reading 'no spend'", async () => {
    const db: D1DatabaseLike = {
      prepare: () => {
        const statement = { bind: () => statement, run: async () => ({ meta: { changes: 0 } }) };
        return statement;
      },
    };
    await expect(createD1AiTurnLog(db).committedMicroUsd()).rejects.toThrow(/all\(\)/);
    await expect(createD1AiTurnLog(db).reserve(reservation(), limits)).rejects.toThrow(/all\(\)/);
    await expect(createD1RecordingStore(db).find("x")).rejects.toThrow(/all\(\)/);
  });

  it("binds the reservation's values in the order its SQL numbers them", async () => {
    const calls: { sql: string; values: D1Value[] }[] = [];
    const db: D1DatabaseLike = {
      prepare: (sql) => ({
        bind: (...values: D1Value[]) => {
          calls.push({ sql, values });
          return { bind: () => { throw new Error("bound twice"); }, run: async () => ({ meta: { changes: 1 } }) };
        },
        run: async () => {
          throw new Error("run without bind");
        },
      }),
    };
    await createD1AiTurnLog(db).reserve(reservation({ at: 100_000 }), limits);
    expect(calls).toEqual([
      { sql: RESERVE_TURN_SQL, values: ["turn-1", "session-a", 100_000, "claude-opus-5-5", "a".repeat(64), 400_000, 40_000, 5, 1_000_000, 1_000_000] },
    ]);
  });
});
