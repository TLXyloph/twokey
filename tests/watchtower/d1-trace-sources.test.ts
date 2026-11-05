import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createD1LedgerTable } from "@/ledger/d1-ledger-table";
import { createD1PaypalEventStore, type PaypalEventRecord } from "@/ledger/event-store";
import { createLedgerStore } from "@/ledger/ledger-store";
import { createD1TraceSources, PAYOUT_BATCH_FOR_TRANSACTION_SQL, TRANSACTION_ID_EXPRESSION } from "@/watchtower/d1-trace-sources";
import { sqlite, sqliteD1 } from "../agents/llm/sqlite-d1";
import { payoutsBatchSuccessEvent, payoutsItemSucceededEvent } from "../payments/paypal/fixtures";
import { payoutRequested, SEED, sequentialIds, steppingClock } from "../ledger/fixtures";

const run = sqlite ? describe : describe.skip;

const record = (eventId: string, eventType: string, payload: string): PaypalEventRecord => ({
  eventId,
  eventType,
  resourceType: null,
  resourceId: null,
  resourceStatus: null,
  amountValue: null,
  amountCurrency: null,
  eventCreatedAt: null,
  receivedAt: "2026-11-05T15:00:00.000Z",
  payload,
});

const sent = (requestId: string, payoutBatchId: string) => ({
  type: "payout.sent" as const,
  payload: { requestId, requestHash: `${requestId}-hash`, senderBatchId: `${requestId}-hash`, payoutBatchId, batchStatus: "PENDING" },
});

run("D1 trace sources (real SQLite, real migrations)", () => {
  it("finds a payout item's batch id by the T0001's transaction id", async () => {
    const d1 = sqliteD1();
    const events = createD1PaypalEventStore(d1.db);
    await events.append(record("WH-BATCH", "PAYMENT.PAYOUTSBATCH.SUCCESS", JSON.stringify(payoutsBatchSuccessEvent)));
    await events.append(record("WH-ITEM", "PAYMENT.PAYOUTS-ITEM.SUCCEEDED", JSON.stringify(payoutsItemSucceededEvent)));
    const sources = createD1TraceSources(d1.db);
    expect(await sources.payoutBatchIdForTransaction("TXNTEST0001")).toBe("BATCHTEST0001");
    expect(await sources.payoutBatchIdForTransaction("NO-SUCH-TXN")).toBeNull();
  });

  it("ignores an event of another type that happens to carry the same transaction id", async () => {
    const d1 = sqliteD1();
    const payload = JSON.stringify({ id: "WH-X", event_type: "CUSTOMER.DISPUTE.CREATED", resource: { transaction_id: "T1", payout_batch_id: "B" } });
    await createD1PaypalEventStore(d1.db).append(record("WH-X", "CUSTOMER.DISPUTE.CREATED", payload));
    expect(await createD1TraceSources(d1.db).payoutBatchIdForTransaction("T1")).toBeNull();
  });

  it("uses migration 0004's expression index for that lookup", () => {
    const d1 = sqliteD1();
    const plan = d1.all(`EXPLAIN QUERY PLAN ${PAYOUT_BATCH_FOR_TRANSACTION_SQL.replace("?1", "'T1'")}`) as { detail: string }[];
    expect(plan.map((step) => step.detail).join("\n")).toMatch(/USING INDEX paypal_events_resource_transaction_id/);
    const migration = readFileSync(new URL("../../config/d1/migrations/0004_watchtower.sql", import.meta.url), "utf8");
    expect(migration).toContain(`ON paypal_events ${TRANSACTION_ID_EXPRESSION};`);
  });

  it("still stores a webhook payload SQLite can't parse (the index reads it as NULL)", async () => {
    const d1 = sqliteD1();
    const deep = `${"[".repeat(2000)}${"]".repeat(2000)}`;
    expect(await createD1PaypalEventStore(d1.db).append(record("WH-DEEP", "PAYMENT.PAYOUTS-ITEM.SUCCEEDED", deep))).toBe("stored");
    expect(await createD1TraceSources(d1.db).payoutBatchIdForTransaction("T1")).toBeNull();
  });

  it("finds the sessions that sent a request id, and reads the ledger without opening sessions", async () => {
    const d1 = sqliteD1();
    const store = createLedgerStore(createD1LedgerTable(d1.db), { seedHash: async () => SEED, now: steppingClock(), newId: sequentialIds() });
    for (const session of ["s2", "s1"]) {
      await store.append(session, payoutRequested({ requestId: "L14" }));
      await store.append(session, sent("L14", `BATCH-${session}`));
    }
    await store.append("s3", payoutRequested({ requestId: "L14" }));
    const sources = createD1TraceSources(d1.db);
    expect(await sources.sessionsThatSent("L14")).toEqual(["s1", "s2"]);
    expect(await sources.sessionsThatSent("L15")).toEqual([]);
    expect(await sources.requestByPayoutBatchId("BATCH-s2")).toEqual({ sessionId: "s2", requestId: "L14" });
    expect((await sources.events("s1")).map((e) => e.type)).toEqual(["payout.requested", "payout.sent"]);
    expect(await sources.events("never-opened")).toEqual([]);
  });
});
