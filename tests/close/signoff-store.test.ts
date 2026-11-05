import { describe, expect, it } from "vitest";
import { createD1SignoffStore, type StoredSignoff } from "@/close/signoff-store";
import { sqlite, sqliteD1 } from "../agents/llm/sqlite-d1";

const run = sqlite ? describe : describe.skip;

const row = (over: Partial<StoredSignoff> = {}): StoredSignoff => ({
  sessionId: "session-1",
  month: "2026-10",
  closeHash: "a".repeat(64),
  role: "reviewer",
  keyId: "1a2b3c4d",
  signature: "c2lnbmF0dXJl",
  signedAt: "2026-11-05T17:42:05.000Z",
  ...over,
});

run("D1 close sign-offs (real SQLite, real migrations)", () => {
  it("stores one sign-off per session and month, and reads it back exactly", async () => {
    const store = createD1SignoffStore(sqliteD1().db);
    expect(await store.find("session-1", "2026-10")).toBeNull();
    expect(await store.insert(row())).toBe("stored");
    expect(await store.insert(row({ signature: "b3RoZXI", signedAt: "2026-11-05T18:00:00.000Z" }))).toBe("duplicate");
    expect(await store.find("session-1", "2026-10")).toEqual(row());
    expect(await store.insert(row({ sessionId: "session-2" }))).toBe("stored");
    expect(await store.find("session-2", "2026-10")).toEqual(row({ sessionId: "session-2" }));
  });

  it("is append-only: every UPDATE and DELETE is refused", async () => {
    const d1 = sqliteD1();
    await createD1SignoffStore(d1.db).insert(row());
    expect(() => d1.exec("UPDATE close_signoffs SET close_hash = 'x'")).toThrow(/append-only/);
    expect(() => d1.exec("DELETE FROM close_signoffs")).toThrow(/append-only/);
    expect(d1.all("SELECT session_id FROM close_signoffs")).toHaveLength(1);
  });

  it("holds only the Reviewer's sign-offs, with a full hash, an 8-character key id and a month", async () => {
    const store = createD1SignoffStore(sqliteD1().db);
    await expect(store.insert({ ...row(), role: "treasurer" as "reviewer" })).rejects.toThrow(/CHECK/);
    await expect(store.insert(row({ closeHash: "short" }))).rejects.toThrow(/CHECK/);
    await expect(store.insert(row({ keyId: "unset" }))).rejects.toThrow(/CHECK/);
    await expect(store.insert(row({ month: "October" as "2026-10" }))).rejects.toThrow(/CHECK/);
  });
});
