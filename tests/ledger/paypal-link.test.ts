import { describe, expect, it } from "vitest";
import { createLedgerStore } from "@/ledger/ledger-store";
import { createInMemoryLedgerTable } from "@/ledger/ledger-table";
import { linkPaypalEvent } from "@/ledger/paypal-link";
import { orderCreated, payoutRequested, payoutSent, SEED, sequentialIds, steppingClock } from "./fixtures";

const HASH = "f0".repeat(32);

async function store() {
  const ledger = createLedgerStore(createInMemoryLedgerTable(), { seedHash: async () => SEED, now: steppingClock(), newId: sequentialIds() });
  await ledger.append("s1", orderCreated("ORDER-1", 2));
  await ledger.append("s1", payoutRequested({ requestId: "R-1", requestHash: HASH }));
  await ledger.append("s1", payoutSent("R-1", HASH, "BATCH-1"));
  return ledger;
}

const capture = (orderId?: string) => ({
  id: "WH-CAPTURE-1",
  create_time: "2026-11-05T16:00:00.000Z",
  event_type: "PAYMENT.CAPTURE.COMPLETED",
  resource: {
    id: "CAPTURE-1",
    status: "COMPLETED",
    amount: { value: "30.00", currency_code: "USD" },
    ...(orderId && { supplementary_data: { related_ids: { order_id: orderId } } }),
  },
});

const batch = (status: string, senderBatchId = HASH, id = `WH-BATCH-${status}`) => ({
  id,
  create_time: "2026-11-05T16:01:00.000Z",
  event_type: `PAYMENT.PAYOUTSBATCH.${status}`,
  resource: { batch_header: { payout_batch_id: "BATCH-1", batch_status: status, sender_batch_header: { sender_batch_id: senderBatchId } } },
});

const item = (resource: Record<string, unknown>) => ({
  id: "WH-ITEM-1",
  create_time: "2026-11-05T16:00:50.000Z",
  event_type: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
  resource: { payout_item_id: "ITEM-1", transaction_status: "SUCCESS", payout_batch_id: "BATCH-1", ...resource },
});

const link = async (event: object) => {
  const ledger = await store();
  const outcome = await linkPaypalEvent(ledger, JSON.stringify(event));
  return { outcome, events: await ledger.read("s1") };
};

describe("linkPaypalEvent: captures", () => {
  it("appends payment.confirmed to the session that created the order, keyed by PayPal's event id", async () => {
    const { outcome, events } = await link(capture("ORDER-1"));
    expect(outcome).toEqual({ kind: "linked", type: "payment.confirmed", sessionId: "s1", outcome: "stored" });
    expect(events.at(-1)?.payload).toEqual({
      captureId: "CAPTURE-1",
      paypalEventId: "WH-CAPTURE-1",
      eventType: "PAYMENT.CAPTURE.COMPLETED",
      paypalCreatedAt: "2026-11-05T16:00:00.000Z",
    });
  });

  it("stores a redelivered event once", async () => {
    const ledger = await store();
    await linkPaypalEvent(ledger, JSON.stringify(capture("ORDER-1")));
    expect(await linkPaypalEvent(ledger, JSON.stringify(capture("ORDER-1")))).toMatchObject({ outcome: "duplicate" });
    expect((await ledger.read("s1")).filter((e) => e.type === "payment.confirmed")).toHaveLength(1);
  });

  it("leaves a capture alone when no session made its order, or it names none", async () => {
    expect((await link(capture("ORDER-404"))).outcome).toEqual({ kind: "unlinked", reason: "no_session" });
    expect((await link(capture())).outcome).toEqual({ kind: "unlinked", reason: "no_order_id" });
  });
});

describe("linkPaypalEvent: payouts", () => {
  it("confirms a payout from the batch's sender_batch_id", async () => {
    const { outcome, events } = await link(batch("SUCCESS"));
    expect(outcome).toEqual({ kind: "linked", type: "payout.confirmed", sessionId: "s1", outcome: "stored" });
    expect(events.at(-1)?.payload).toEqual({
      requestId: "R-1",
      payoutBatchId: "BATCH-1",
      payoutItemId: null,
      status: "SUCCESS",
      paypalEventId: "WH-BATCH-SUCCESS",
      eventType: "PAYMENT.PAYOUTSBATCH.SUCCESS",
      paypalCreatedAt: "2026-11-05T16:01:00.000Z",
    });
  });

  it("confirms from an item's own sender_batch_id, or else from its payout_batch_id", async () => {
    expect((await link(item({ sender_batch_id: HASH }))).events.at(-1)?.payload).toMatchObject({ requestId: "R-1", payoutItemId: "ITEM-1", status: "SUCCESS" });
    const byBatch = await link(item({}));
    expect(byBatch.outcome).toMatchObject({ kind: "linked", type: "payout.confirmed" });
    expect(byBatch.events.at(-1)?.payload).toMatchObject({ requestId: "R-1", payoutBatchId: "BATCH-1", payoutItemId: "ITEM-1" });
  });

  it("ignores PROCESSING and PENDING (only a success confirms)", async () => {
    for (const status of ["PROCESSING", "PENDING"]) {
      const { outcome, events } = await link(batch(status));
      expect(outcome, status).toEqual({ kind: "ignored", reason: "not_success" });
      expect(events.some((e) => e.type === "payout.confirmed")).toBe(false);
    }
  });

  it("leaves a payout alone that no session sent (e.g. the spike's own)", async () => {
    expect((await link(batch("SUCCESS", "twokey-spike-0001"))).outcome).toEqual({ kind: "unlinked", reason: "no_session" });
  });
});

describe("linkPaypalEvent: anything else", () => {
  it("ignores other event types and unreadable bodies", async () => {
    expect((await link({ id: "WH-X", event_type: "CHECKOUT.ORDER.APPROVED", resource: {} })).outcome).toEqual({ kind: "ignored", reason: "event_type" });
    expect(await linkPaypalEvent(await store(), "not json")).toEqual({ kind: "ignored", reason: "unreadable" });
  });
});
