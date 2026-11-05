import { describe, expect, it } from "vitest";
import { createLedgerStore, LedgerConflictError, MAX_APPEND_RETRIES } from "@/ledger/ledger-store";
import { createInMemoryLedgerTable, indexOf, type LedgerTable } from "@/ledger/ledger-table";
import { orderCreated, requestedPayload, SEED, sequentialIds, steppingClock } from "./fixtures";
import { describeLedgerStore } from "./ledger-store.contract";

describeLedgerStore("in-memory table", createInMemoryLedgerTable);

describe("createLedgerStore", () => {
  it("gives up with LedgerConflictError after the initial try and 3 retries", async () => {
    const table = createInMemoryLedgerTable();
    let inserts = 0;
    const alwaysTaken: LedgerTable = { ...table, insert: async () => (inserts++, false) };
    const store = createLedgerStore(alwaysTaken, { seedHash: async () => SEED, now: steppingClock(), newId: sequentialIds() });
    await expect(store.append("s1", orderCreated("O-1"))).rejects.toBeInstanceOf(LedgerConflictError);
    expect(inserts).toBe(MAX_APPEND_RETRIES + 1);
  });

  it("stores a copy of the payload, so a caller changing its object later changes nothing", async () => {
    const table = createInMemoryLedgerTable();
    const store = createLedgerStore(table, { seedHash: async () => SEED });
    const input = orderCreated("O-1");
    await store.append("s1", input);
    input.payload.quantity = 99;
    expect((await store.read("s1"))[0]?.payload).toMatchObject({ quantity: 2 });
    expect(Object.isFrozen(table.all()[0])).toBe(true);
  });
});

describe("indexOf", () => {
  it("copies the lookup columns out of each payload type", () => {
    expect(indexOf("order.created", orderCreated("O-1").payload)).toMatchObject({ orderId: "O-1", amountCents: 3000 });
    const requested = requestedPayload({ requestId: "r1", requestHash: "h" });
    expect(indexOf("payout.requested", requested)).toEqual({ orderId: null, senderBatchId: "h", payoutBatchId: null, requestId: "r1", amountCents: 4200 });
    expect(
      indexOf("payout.sent", { requestId: "r1", requestHash: "h", senderBatchId: "h", payoutBatchId: "B", batchStatus: "PENDING" }),
    ).toMatchObject({ senderBatchId: "h", payoutBatchId: "B", requestId: "r1", amountCents: null });
    expect(indexOf("session.opened", { seedVersion: "v", seedHash: "s" })).toEqual({
      orderId: null,
      senderBatchId: null,
      payoutBatchId: null,
      requestId: null,
      amountCents: null,
    });
  });
});
