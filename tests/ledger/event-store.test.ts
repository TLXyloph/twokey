import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  createD1PaypalEventStore,
  createInMemoryPaypalEventStore,
  INSERT_PAYPAL_EVENT_SQL,
  type PaypalEventRecord,
} from "@/ledger/event-store";
import type { D1DatabaseLike, D1Value } from "@/platform/cloudflare-env";

const record = (over: Partial<PaypalEventRecord> = {}): PaypalEventRecord => ({
  eventId: "WH-TEST0001-CAPTURE",
  eventType: "PAYMENT.CAPTURE.COMPLETED",
  resourceType: "capture",
  resourceId: "CAPTURE-TEST-0001",
  resourceStatus: "COMPLETED",
  amountValue: "500.00",
  amountCurrency: "USD",
  eventCreatedAt: "2026-11-03T20:00:00.000Z",
  receivedAt: "2026-11-03T20:00:05.000Z",
  payload: '{"id":"WH-TEST0001-CAPTURE"}',
  ...over,
});

/** A mock D1: records every prepare/bind and answers `run()` with the queued `changes` values. */
function mockD1(changes: number[] | Error) {
  const calls: { sql: string; values: D1Value[] }[] = [];
  const db: D1DatabaseLike = {
    prepare: vi.fn((sql: string) => ({
      bind: (...values: D1Value[]) => {
        calls.push({ sql, values });
        return {
          bind: () => {
            throw new Error("bind called twice");
          },
          run: async () => {
            if (changes instanceof Error) throw changes;
            const next = changes.shift();
            if (next === undefined) throw new Error("no queued result");
            return { meta: { changes: next } };
          },
        };
      },
      run: async () => {
        throw new Error("run called without bind");
      },
    })),
  };
  return { db, calls };
}

describe("createD1PaypalEventStore", () => {
  it("inserts with ON CONFLICT DO NOTHING and binds every column in schema order", async () => {
    const { db, calls } = mockD1([1]);
    const outcome = await createD1PaypalEventStore(db).append(record());
    expect(outcome).toBe("stored");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.sql).toBe(INSERT_PAYPAL_EVENT_SQL);
    expect(INSERT_PAYPAL_EVENT_SQL).toMatch(/ON CONFLICT \(event_id\) DO NOTHING/);
    expect(calls[0]?.values).toEqual([
      "WH-TEST0001-CAPTURE",
      "PAYMENT.CAPTURE.COMPLETED",
      "capture",
      "CAPTURE-TEST-0001",
      "COMPLETED",
      "500.00",
      "USD",
      "2026-11-03T20:00:00.000Z",
      "2026-11-03T20:00:05.000Z",
      '{"id":"WH-TEST0001-CAPTURE"}',
    ]);
  });

  it("binds NULL for absent summary fields", async () => {
    const { db, calls } = mockD1([1]);
    await createD1PaypalEventStore(db).append(
      record({ resourceType: null, resourceId: null, resourceStatus: null, amountValue: null, amountCurrency: null, eventCreatedAt: null }),
    );
    expect(calls[0]?.values.slice(2, 8)).toEqual([null, null, null, null, null, null]);
  });

  it("reports a duplicate when the insert changed no row", async () => {
    const { db } = mockD1([0]);
    expect(await createD1PaypalEventStore(db).append(record())).toBe("duplicate");
  });

  it("propagates a D1 error instead of guessing an outcome", async () => {
    const { db } = mockD1(new Error("D1_ERROR: no such table: paypal_events"));
    await expect(createD1PaypalEventStore(db).append(record())).rejects.toThrow(/no such table/);
  });

  it("refuses an impossible change count", async () => {
    const { db } = mockD1([2]);
    await expect(createD1PaypalEventStore(db).append(record())).rejects.toThrow(/unexpected change count/);
  });
});

describe("createInMemoryPaypalEventStore", () => {
  it("stores the first copy of an event id and reports later copies as duplicates", async () => {
    const store = createInMemoryPaypalEventStore();
    expect(await store.append(record())).toBe("stored");
    expect(await store.append(record({ payload: "{}" }))).toBe("duplicate");
    expect(await store.append(record({ eventId: "WH-TEST0002-PAYOUTSBATCH" }))).toBe("stored");
    expect(store.records().map((row) => row.eventId)).toEqual(["WH-TEST0001-CAPTURE", "WH-TEST0002-PAYOUTSBATCH"]);
    expect(store.records()[0]?.payload).toBe('{"id":"WH-TEST0001-CAPTURE"}');
  });

  it("hands out frozen copies, so a caller cannot rewrite history", async () => {
    const store = createInMemoryPaypalEventStore();
    const original = record();
    await store.append(original);
    original.payload = "changed after append";
    const [stored] = store.records();
    expect(stored?.payload).toBe('{"id":"WH-TEST0001-CAPTURE"}');
    expect(Object.isFrozen(stored)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// The real migration file against real SQLite (node:sqlite), through a D1-shaped adapter.
// ---------------------------------------------------------------------------------------------

const migrationPath = fileURLToPath(new URL("../../config/d1/migrations/0001_paypal_events.sql", import.meta.url));
const sqlite = await import("node:sqlite").catch(() => undefined);

function sqliteD1(): { db: D1DatabaseLike; exec: (sql: string) => void; all: (sql: string) => unknown[] } {
  if (!sqlite) throw new Error("node:sqlite unavailable");
  const database = new sqlite.DatabaseSync(":memory:");
  database.exec(readFileSync(migrationPath, "utf8"));
  const db: D1DatabaseLike = {
    prepare: (sql) => {
      const statement = (values: D1Value[]) => ({
        bind: (...more: D1Value[]) => statement([...values, ...more]),
        run: async () => ({ meta: { changes: Number(database.prepare(sql).run(...values).changes) } }),
      });
      return statement([]);
    },
  };
  return { db, exec: (sql) => database.exec(sql), all: (sql) => database.prepare(sql).all() };
}

describe.skipIf(!sqlite)("0001_paypal_events.sql on SQLite", () => {
  it("creates the table the D1 store writes to, and dedupes on event_id", async () => {
    const { db, all } = sqliteD1();
    const store = createD1PaypalEventStore(db);
    expect(await store.append(record())).toBe("stored");
    expect(await store.append(record({ payload: "a different body" }))).toBe("duplicate");
    expect(await store.append(record({ eventId: "WH-TEST0003-PAYOUTSITEM", resourceType: null, amountValue: null }))).toBe("stored");
    const rows = all("SELECT event_id, resource_type, amount_value, payload FROM paypal_events ORDER BY event_id");
    expect(rows).toEqual([
      { event_id: "WH-TEST0001-CAPTURE", resource_type: "capture", amount_value: "500.00", payload: '{"id":"WH-TEST0001-CAPTURE"}' },
      { event_id: "WH-TEST0003-PAYOUTSITEM", resource_type: null, amount_value: null, payload: '{"id":"WH-TEST0001-CAPTURE"}' },
    ]);
  });

  it("refuses UPDATE and DELETE (append-only)", async () => {
    const { db, exec, all } = sqliteD1();
    await createD1PaypalEventStore(db).append(record());
    expect(() => exec("UPDATE paypal_events SET resource_status = 'REFUNDED'")).toThrow(/append-only/);
    expect(() => exec("DELETE FROM paypal_events")).toThrow(/append-only/);
    expect(all("SELECT resource_status FROM paypal_events")).toEqual([{ resource_status: "COMPLETED" }]);
  });

  it("requires event_type, received_at and payload", () => {
    const { exec } = sqliteD1();
    expect(() => exec("INSERT INTO paypal_events (event_id, received_at, payload) VALUES ('WH-X', 't', '{}')")).toThrow(/NOT NULL/);
    expect(() => exec("INSERT INTO paypal_events (event_id, event_type, payload) VALUES ('WH-X', 'T', '{}')")).toThrow(/NOT NULL/);
    expect(() => exec("INSERT INTO paypal_events (event_id, event_type, received_at) VALUES ('WH-X', 'T', 't')")).toThrow(/NOT NULL/);
  });
});
