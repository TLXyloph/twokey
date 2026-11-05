import { describe, expect, it } from "vitest";
import { canonicalJson, sha256Hex } from "@/ledger/canonical";
import { eventHash, verifyChain } from "@/ledger/chain";
import type { LedgerEvent } from "@/ledger/contracts";
import { riverbend } from "@/demo/riverbend";
import { SEEDED_REQUESTS } from "@/disbursements/seed-requests";
import { SEED_VERSION, seedHash } from "@/ledger/seed";

async function chainOf(count: number, seed: string): Promise<LedgerEvent[]> {
  const events: LedgerEvent[] = [];
  for (let seq = 1; seq <= count; seq++) {
    const prevHash = events.at(-1)?.hash ?? seed;
    const fields = {
      sessionId: "s1",
      seq,
      type: "order.created" as const,
      payload: { orderId: `O-${seq}`, eventId: "banquet", quantity: 1, amountCents: 1500, currency: "USD" as const },
      occurredAt: `2026-11-05T12:00:0${seq}.000Z`,
      prevHash,
    };
    events.push({ ...fields, eventId: `e${seq}`, hash: await eventHash(fields) });
  }
  return events;
}

describe("the seed hash", () => {
  it("is SHA-256 of the canonical seed: version, club data and the seeded requests", async () => {
    const expected = await sha256Hex(canonicalJson({ seedVersion: SEED_VERSION, club: riverbend, requests: SEEDED_REQUESTS }));
    expect(await seedHash()).toBe(expected);
  });
});

describe("eventHash", () => {
  it("is SHA-256 of the canonical {sessionId, seq, type, payload, occurredAt, prevHash}", async () => {
    const fields = { sessionId: "s", seq: 1, type: "session.opened" as const, payload: { seedVersion: "v", seedHash: "h" }, occurredAt: "t", prevHash: "p" };
    expect(await eventHash(fields)).toBe(await sha256Hex(canonicalJson(fields)));
  });

  it("ignores everything else on the event (the event id is not hashed)", async () => {
    const fields = { sessionId: "s", seq: 1, type: "session.opened" as const, payload: { seedVersion: "v", seedHash: "h" }, occurredAt: "t", prevHash: "p" };
    expect(await eventHash({ ...fields, eventId: "x", hash: "y" } as never)).toBe(await eventHash(fields));
  });
});

describe("verifyChain", () => {
  it("accepts an unbroken chain from the seed hash and reports its length and head", async () => {
    const events = await chainOf(3, "seed");
    expect(await verifyChain(events, "seed")).toEqual({ ok: true, length: 3, head: events[2]!.hash });
  });

  it("accepts an empty chain, whose head is the seed hash", async () => {
    expect(await verifyChain([], "seed")).toEqual({ ok: true, length: 0, head: "seed" });
  });

  it("names the first event whose payload was changed after it was hashed", async () => {
    const events = await chainOf(3, "seed");
    const tampered = events.map((e) => (e.seq === 2 ? { ...e, payload: { ...e.payload, quantity: 4 } } : e)) as LedgerEvent[];
    expect(await verifyChain(tampered, "seed")).toEqual({ ok: false, badSeq: 2, reason: "Event 2's contents don't match its hash." });
  });

  it("names a broken link, a gap in the sequence, and a chain that doesn't start at the seed", async () => {
    const events = await chainOf(3, "seed");
    expect(await verifyChain(events, "another seed")).toMatchObject({ ok: false, badSeq: 1 });
    expect(await verifyChain([events[0]!, events[2]!], "seed")).toMatchObject({ ok: false, badSeq: 3, reason: "Event 2 is missing." });
    const relinked = [events[0]!, { ...events[1]!, prevHash: "0".repeat(64) }];
    expect(await verifyChain(relinked, "seed")).toMatchObject({ ok: false, badSeq: 2, reason: "Event 2 doesn't follow event 1." });
  });

  it("checks each signature with the verifier it is given", async () => {
    const events = await chainOf(2, "seed");
    const result = await verifyChain(events, "seed", { checkEvent: async (event) => (event.seq === 2 ? "Its signature doesn't verify." : null) });
    expect(result).toEqual({ ok: false, badSeq: 2, reason: "Event 2: Its signature doesn't verify." });
  });
});
