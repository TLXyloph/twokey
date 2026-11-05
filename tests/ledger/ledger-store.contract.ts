/**
 * Behaviour every LedgerStore must have, run over the in-memory table and the D1 table (on real
 * SQLite with the real migrations). Not a test file itself: the two suites import it.
 */
import { describe, expect, it, vi } from "vitest";
import { verifyChain } from "@/ledger/chain";
import { createLedgerStore, type SessionOpener } from "@/ledger/ledger-store";
import type { LedgerTable } from "@/ledger/ledger-table";
import { orderCreated, paymentCaptured, payoutRequested, payoutSent, SEED, sequentialIds, steppingClock, T0 } from "./fixtures";

const options = () => ({ seedHash: async () => SEED, now: steppingClock(), newId: sequentialIds() });

function countingOpener() {
  const open = vi.fn<SessionOpener["open"]>(async (sessionId, append) => {
    await append({ type: "session.opened", payload: { seedVersion: "test-seed", seedHash: SEED }, idempotencyKey: `open:${sessionId}` });
    await append({ ...orderCreated("SEED-ORDER", 1), idempotencyKey: "seed:order" });
  });
  const opener: SessionOpener = {
    isOpen: (events) => events.some((e) => e.type === "session.opened") && events.some((e) => e.type === "order.created"),
    open,
  };
  return { opener, open };
}

export function describeLedgerStore(name: string, makeTable: () => LedgerTable): void {
  describe(`${name}: append`, () => {
    it("starts a session's chain at seq 1, linked to the seed hash, with the server's time and a fresh id", async () => {
      const store = createLedgerStore(makeTable(), options());
      const { outcome, event } = await store.append("s1", orderCreated("O-1"));
      expect(outcome).toBe("stored");
      expect(event).toMatchObject({ sessionId: "s1", seq: 1, prevHash: SEED, eventId: "evt-1", occurredAt: new Date(T0).toISOString() });
      expect(event.hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("links each event to the one before it, and reads them back exactly as appended", async () => {
      const store = createLedgerStore(makeTable(), options());
      const first = (await store.append("s1", orderCreated("O-1"))).event;
      const second = (await store.append("s1", paymentCaptured("O-1", "CAP-1"))).event;
      expect(second).toMatchObject({ seq: 2, prevHash: first.hash });
      expect(await store.read("s1")).toEqual([first, second]);
      expect(await verifyChain(await store.read("s1"), SEED)).toEqual({ ok: true, length: 2, head: second.hash });
    });

    it("keeps sessions apart", async () => {
      const store = createLedgerStore(makeTable(), options());
      await store.append("s1", orderCreated("O-1"));
      const other = (await store.append("s2", orderCreated("O-2"))).event;
      expect(other).toMatchObject({ seq: 1, prevHash: SEED });
      expect((await store.read("s1")).map((e) => e.seq)).toEqual([1]);
    });

    it("is idempotent by key within a session: the second append returns the stored event as a duplicate", async () => {
      const store = createLedgerStore(makeTable(), options());
      const stored = await store.append("s1", paymentCaptured("O-1", "CAP-1"));
      const again = await store.append("s1", paymentCaptured("O-1", "CAP-1", 9999));
      expect(again).toEqual({ outcome: "duplicate", event: stored.event });
      expect(await store.read("s1")).toHaveLength(1);
      expect((await store.append("s2", paymentCaptured("O-1", "CAP-1"))).outcome).toBe("stored");
    });

    it("lands concurrent appends with gapless seqs and an unbroken chain", async () => {
      const store = createLedgerStore(makeTable(), options());
      const results = await Promise.all(["A", "B", "C", "D"].map((id) => store.append("s1", orderCreated(`O-${id}`))));
      expect(results.every((r) => r.outcome === "stored")).toBe(true);
      const events = await store.read("s1");
      expect(events.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
      expect(await verifyChain(events, SEED)).toMatchObject({ ok: true, length: 4 });
    });

    it("stores one event when concurrent appends carry the same key", async () => {
      const store = createLedgerStore(makeTable(), options());
      const results = await Promise.all([1, 2, 3].map(() => store.append("s1", paymentCaptured("O-1", "CAP-1"))));
      expect(results.filter((r) => r.outcome === "stored")).toHaveLength(1);
      expect(new Set(results.map((r) => r.event.eventId)).size).toBe(1);
      expect(await store.read("s1")).toHaveLength(1);
    });
  });

  describe(`${name}: opening a session`, () => {
    it("runs the opener on the first read only", async () => {
      const { opener, open } = countingOpener();
      const store = createLedgerStore(makeTable(), { ...options(), opener });
      const events = await store.read("s1");
      expect(events.map((e) => e.type)).toEqual(["session.opened", "order.created"]);
      await store.read("s1");
      expect(open).toHaveBeenCalledTimes(1);
    });

    it("opens a session once when two first reads race", async () => {
      const { opener } = countingOpener();
      const store = createLedgerStore(makeTable(), { ...options(), opener });
      const [a, b] = await Promise.all([store.read("s1"), store.read("s1")]);
      expect(a.map((e) => e.type)).toEqual(["session.opened", "order.created"]);
      expect(b).toEqual(a);
    });

    it("opens the session before a first append, so session.opened is always seq 1", async () => {
      const { opener } = countingOpener();
      const store = createLedgerStore(makeTable(), { ...options(), opener });
      const { event } = await store.append("s1", orderCreated("O-1"));
      expect(event.seq).toBe(3);
      expect((await store.read("s1"))[0]?.type).toBe("session.opened");
    });
  });

  describe(`${name}: lookups`, () => {
    it("finds the session that created an order", async () => {
      const store = createLedgerStore(makeTable(), options());
      await store.append("s1", orderCreated("O-1"));
      expect(await store.findSessionByOrderId("O-1")).toBe("s1");
      expect(await store.findSessionByOrderId("O-404")).toBeNull();
    });

    it("finds a request by its sender_batch_id (the request hash), before and after it is sent", async () => {
      const store = createLedgerStore(makeTable(), options());
      const hash = "b2".repeat(32);
      await store.append("s1", payoutRequested({ requestId: "req-9", requestHash: hash }));
      expect(await store.findSessionBySenderBatchId(hash)).toEqual({ sessionId: "s1", requestId: "req-9" });
      await store.append("s1", payoutSent("req-9", hash, "BATCH-9"));
      expect(await store.findSessionBySenderBatchId(hash)).toEqual({ sessionId: "s1", requestId: "req-9" });
      expect(await store.findSessionByPayoutBatchId("BATCH-9")).toEqual({ sessionId: "s1", requestId: "req-9" });
      expect(await store.findSessionBySenderBatchId("c3".repeat(32))).toBeNull();
      expect(await store.findSessionByPayoutBatchId("BATCH-404")).toBeNull();
    });

    it("sums the requested amounts of payouts sent since a time, across sessions", async () => {
      const store = createLedgerStore(makeTable(), options());
      const h1 = "d1".repeat(32);
      const h2 = "d2".repeat(32);
      const h3 = "d3".repeat(32);
      await store.append("s1", payoutRequested({ requestId: "r1", requestHash: h1, amountCents: 4200 }));
      await store.append("s2", payoutRequested({ requestId: "r1", requestHash: h2, amountCents: 3650 }));
      await store.append("s2", payoutRequested({ requestId: "r2", requestHash: h3, amountCents: 100 }));
      const sinceAll = new Date(T0).toISOString();
      expect(await store.sentPayoutCentsSince(sinceAll)).toBe(0);
      await store.append("s1", payoutSent("r1", h1));
      const afterFirst = new Date(T0 + 3_500).toISOString();
      await store.append("s2", payoutSent("r1", h2));
      expect(await store.sentPayoutCentsSince(sinceAll)).toBe(7850);
      expect(await store.sentPayoutCentsSince(afterFirst)).toBe(3650);
    });
  });
}
