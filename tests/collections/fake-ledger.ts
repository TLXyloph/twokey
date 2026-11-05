/**
 * An in-memory `LedgerStore` for the Collections tests: enough of the contract (append-only,
 * gapless seq per session, idempotency keys, order lookup) to drive the handlers. No hashing: the
 * chain belongs to the Ledger context and is tested there.
 */
import { vi } from "vitest";
import type {
  LedgerAppendInput,
  LedgerAppendResult,
  LedgerEvent,
  LedgerEventType,
  LedgerStore,
} from "@/ledger/contracts";

export interface FakeLedger extends LedgerStore {
  events(sessionId: string): LedgerEvent[];
  /** Makes the next call to `method` throw. */
  failNext(method: "read" | "append" | "findSessionByOrderId"): void;
}

export function fakeLedger(): FakeLedger {
  const bySession = new Map<string, LedgerEvent[]>();
  const byKey = new Map<string, LedgerEvent>();
  const failing = new Set<string>();
  let counter = 0;

  const trip = (method: string) => {
    if (failing.delete(method)) throw new Error(`fake ledger: ${method} failed`);
  };
  const streamOf = (sessionId: string): LedgerEvent[] => {
    let stream = bySession.get(sessionId);
    if (!stream) {
      stream = [];
      bySession.set(sessionId, stream);
      stream.push(make(sessionId, stream, { type: "session.opened", payload: { seedVersion: "test", seedHash: "seed" } }));
    }
    return stream;
  };
  function make<T extends LedgerEventType>(sessionId: string, stream: LedgerEvent[], input: LedgerAppendInput<T>): LedgerEvent<T> {
    counter += 1;
    return {
      sessionId,
      seq: stream.length + 1,
      eventId: `evt-${counter}`,
      type: input.type,
      payload: input.payload,
      occurredAt: new Date(Date.UTC(2026, 10, 5, 15, 0, counter)).toISOString(),
      prevHash: stream.at(-1)?.hash ?? "seed",
      hash: `hash-${counter}`,
    };
  }

  async function append<T extends LedgerEventType>(sessionId: string, input: LedgerAppendInput<T>): Promise<LedgerAppendResult<T>> {
    trip("append");
    if (input.idempotencyKey !== undefined) {
      const existing = byKey.get(input.idempotencyKey);
      if (existing) return { outcome: "duplicate", event: existing as LedgerEvent<T> };
    }
    const stream = streamOf(sessionId);
    const event = make(sessionId, stream, input);
    stream.push(event);
    if (input.idempotencyKey !== undefined) byKey.set(input.idempotencyKey, event);
    return { outcome: "stored", event };
  }

  const store: FakeLedger = {
    read: vi.fn(async (sessionId: string) => {
      trip("read");
      return [...streamOf(sessionId)];
    }),
    append: vi.fn(append) as unknown as LedgerStore["append"],
    findSessionByOrderId: vi.fn(async (orderId: string) => {
      trip("findSessionByOrderId");
      for (const [sessionId, stream] of bySession) {
        if (stream.some((event) => event.type === "order.created" && (event.payload as { orderId: string }).orderId === orderId)) {
          return sessionId;
        }
      }
      return null;
    }),
    findSessionBySenderBatchId: vi.fn(async () => null),
    sentPayoutCentsSince: vi.fn(async () => 0),
    events: (sessionId) => [...(bySession.get(sessionId) ?? [])],
    failNext: (method) => {
      failing.add(method);
    },
  };
  return store;
}
