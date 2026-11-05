import { describe, expect, it } from "vitest";
import { createD1LedgerTable } from "@/ledger/d1-ledger-table";
import { createLedgerStore } from "@/ledger/ledger-store";
import { sqlite, sqliteD1 } from "../agents/llm/sqlite-d1";
import { orderCreated, SEED, sequentialIds, steppingClock } from "./fixtures";
import { describeLedgerStore } from "./ledger-store.contract";

const run = sqlite ? describe : describe.skip;

run("D1 ledger table (real SQLite, real migrations)", () => {
  describeLedgerStore("D1 table", () => createD1LedgerTable(sqliteD1().db));

  async function seeded() {
    const d1 = sqliteD1();
    const store = createLedgerStore(createD1LedgerTable(d1.db), { seedHash: async () => SEED, now: steppingClock(), newId: sequentialIds() });
    await store.append("s1", orderCreated("O-1"));
    await store.append("s1", orderCreated("O-2"));
    return d1;
  }

  it("refuses every UPDATE and DELETE (append-only)", async () => {
    const d1 = await seeded();
    expect(() => d1.exec("UPDATE ledger_events SET payload = '{}' WHERE seq = 1")).toThrow(/append-only/);
    expect(() => d1.exec("DELETE FROM ledger_events WHERE seq = 2")).toThrow(/append-only/);
    expect(d1.all("SELECT seq FROM ledger_events")).toHaveLength(2);
  });

  it("refuses an event that doesn't link to the one before it", async () => {
    const d1 = await seeded();
    expect(() =>
      d1.exec(
        "INSERT INTO ledger_events (session_id, seq, event_id, type, payload, occurred_at, prev_hash, hash) " +
          "VALUES ('s1', 3, 'forged', 'order.created', '{}', '2026-11-05T15:00:09.000Z', 'not-the-head', 'x')",
      ),
    ).toThrow(/link to the one before it/);
  });

  it("refuses an unknown event type", async () => {
    const d1 = sqliteD1();
    expect(() =>
      d1.exec(
        "INSERT INTO ledger_events (session_id, seq, event_id, type, payload, occurred_at, prev_hash, hash) " +
          "VALUES ('s1', 1, 'e', 'money.vanished', '{}', 't', 'p', 'h')",
      ),
    ).toThrow(/CHECK constraint failed/);
  });

  it("stores the payload as canonical JSON with the lookup columns beside it", async () => {
    const d1 = await seeded();
    const [row] = d1.all("SELECT payload, order_id, amount_cents FROM ledger_events WHERE seq = 1") as {
      payload: string;
      order_id: string;
      amount_cents: number;
    }[];
    expect(row).toEqual({
      payload: '{"amountCents":3000,"currency":"USD","eventId":"banquet","orderId":"O-1","quantity":2}',
      order_id: "O-1",
      amount_cents: 3000,
    });
  });
});
