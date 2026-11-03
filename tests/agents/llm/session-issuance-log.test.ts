import { describe, expect, it } from "vitest";
import { createD1SessionIssuanceLog, ISSUE_SESSION_SQL } from "@/agents/llm/d1-session-issuance-log";
import { createInMemorySessionIssuanceLog } from "@/agents/llm/session-issuance-log";
import type { D1DatabaseLike, D1Value } from "@/platform/cloudflare-env";
import { describeSessionIssuanceLog } from "./session-issuance-log.contract";
import { sqlite, sqliteD1 } from "./sqlite-d1";

describeSessionIssuanceLog("in-memory log", createInMemorySessionIssuanceLog);

describe("createInMemorySessionIssuanceLog", () => {
  it("keeps every issuance as a frozen copy", async () => {
    const log = createInMemorySessionIssuanceLog();
    const issuance = { sessionId: "s", ipHmac: "h".repeat(64), at: 1 };
    await log.issue(issuance, { perWindow: 5, windowMs: 3_600_000 });
    issuance.ipHmac = "changed";
    expect(log.issuances()).toEqual([{ sessionId: "s", ipHmac: "h".repeat(64), at: 1 }]);
    expect(Object.isFrozen(log.issuances()[0])).toBe(true);
  });
});

describe.skipIf(!sqlite)("D1 log on SQLite with 0002_ai_turns.sql", () => {
  describeSessionIssuanceLog("D1 log", () => createD1SessionIssuanceLog(sqliteD1().db));

  it("stores the session id, the IP's HMAC and the time, and nothing else", async () => {
    const { db, all } = sqliteD1();
    await createD1SessionIssuanceLog(db).issue({ sessionId: "s1", ipHmac: "c".repeat(64), at: 42 }, { perWindow: 5, windowMs: 1000 });
    expect(all("SELECT * FROM ai_session_issuances")).toEqual([{ seq: 1, session_id: "s1", ip_hmac: "c".repeat(64), issued_at: 42 }]);
  });

  it("refuses UPDATE and DELETE (append-only)", async () => {
    const { db, exec, all } = sqliteD1();
    await createD1SessionIssuanceLog(db).issue({ sessionId: "s1", ipHmac: "c".repeat(64), at: 42 }, { perWindow: 5, windowMs: 1000 });
    expect(() => exec("UPDATE ai_session_issuances SET issued_at = 0")).toThrow(/append-only/);
    expect(() => exec("DELETE FROM ai_session_issuances")).toThrow(/append-only/);
    expect(all("SELECT issued_at FROM ai_session_issuances")).toEqual([{ issued_at: 42 }]);
  });

  it("refuses a duplicate session id", async () => {
    const { db } = sqliteD1();
    const log = createD1SessionIssuanceLog(db);
    await log.issue({ sessionId: "s1", ipHmac: "c".repeat(64), at: 1 }, { perWindow: 5, windowMs: 1000 });
    await expect(log.issue({ sessionId: "s1", ipHmac: "d".repeat(64), at: 2 }, { perWindow: 5, windowMs: 1000 })).rejects.toThrow(/UNIQUE/);
  });
});

describe("D1 log, mock-first", () => {
  it("checks and appends in one statement, binding in the order its SQL numbers them", async () => {
    const calls: { sql: string; values: D1Value[] }[] = [];
    const db: D1DatabaseLike = {
      prepare: (sql) => ({
        bind: (...values: D1Value[]) => {
          calls.push({ sql, values });
          return { bind: () => { throw new Error("bound twice"); }, run: async () => ({ meta: { changes: 0 } }) };
        },
        run: async () => {
          throw new Error("run without bind");
        },
      }),
    };
    const outcome = await createD1SessionIssuanceLog(db).issue({ sessionId: "s1", ipHmac: "h", at: 5_000_000 }, { perWindow: 5, windowMs: 3_600_000 });
    expect(outcome).toBe("ip_limited");
    expect(calls).toEqual([{ sql: ISSUE_SESSION_SQL, values: ["s1", "h", 5_000_000, 1_400_000, 5] }]);
    expect(ISSUE_SESSION_SQL).toMatch(/^INSERT INTO ai_session_issuances[\s\S]*SELECT[\s\S]*WHERE \(\s*SELECT COUNT\(\*\)/);
  });
});
