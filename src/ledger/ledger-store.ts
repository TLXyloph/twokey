/**
 * The Ledger context's store (the `LedgerStore` port in ./contracts.ts) over a `LedgerTable`:
 * one append algorithm, whichever table holds the rows.
 *
 * Append (spec §2): optimistic. If the input has an idempotency key that the session already holds,
 * return that event as "duplicate". Otherwise read the head, hash the event as seq + 1 linked to
 * the head (seq 1 links to the seed hash) and insert it; when another append took that seq (or the
 * key) first, re-read and retry, at most 3 times, then give up with `LedgerConflictError`.
 *
 * Opening: a session's first read (or first append) runs the injected `SessionOpener`, which
 * appends `session.opened` and the seeded requests with fixed idempotency keys, so two requests
 * racing to open the same session both end with exactly one copy of each.
 */
import type { LedgerAppendInput, LedgerAppendResult, LedgerEvent, LedgerEventType, LedgerStore } from "./contracts";
import { eventHash } from "./chain";
import type { LedgerTable, RequestRef } from "./ledger-table";
import { seedHash as defaultSeedHash } from "./seed";

export const MAX_APPEND_RETRIES = 3;

export class LedgerConflictError extends Error {
  constructor(sessionId: string) {
    super(`ledger append for session ${sessionId.slice(0, 8)} kept conflicting; gave up after ${MAX_APPEND_RETRIES} retries`);
    this.name = "LedgerConflictError";
  }
}

export type AppendFn = <T extends LedgerEventType>(input: LedgerAppendInput<T>) => Promise<LedgerAppendResult<T>>;

/** Starts a session's chain: implemented by the Disbursements context (it signs the seeded requests). */
export interface SessionOpener {
  /** True when every opening event is already in the session. */
  isOpen(events: readonly LedgerEvent[]): boolean;
  /** Appends the missing opening events, each with a fixed idempotency key. */
  open(sessionId: string, append: AppendFn, now: Date): Promise<void>;
}

export interface LedgerStoreOptions {
  /** Without one (the webhook route), sessions are never opened here; linking only finds open ones. */
  opener?: SessionOpener;
  seedHash?: () => Promise<string>;
  now?: () => Date;
  newId?: () => string;
}

/** The contract's store, plus the lookup webhook linking needs when an item event has no sender_batch_id. */
export interface TwoKeyLedgerStore extends LedgerStore {
  findSessionByPayoutBatchId(payoutBatchId: string): Promise<RequestRef | null>;
}

/** The payload as stored and read back: a JSON round trip drops `undefined`, as the hash does. */
const asStored = <T>(payload: T): T => JSON.parse(JSON.stringify(payload)) as T;

export function createLedgerStore(table: LedgerTable, options: LedgerStoreOptions = {}): TwoKeyLedgerStore {
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? (() => crypto.randomUUID());
  const getSeedHash = options.seedHash ?? defaultSeedHash;

  async function appendRaw<T extends LedgerEventType>(sessionId: string, input: LedgerAppendInput<T>): Promise<LedgerAppendResult<T>> {
    const key = input.idempotencyKey ?? null;
    const payload = asStored(input.payload);
    for (let attempt = 0; attempt <= MAX_APPEND_RETRIES; attempt++) {
      if (key !== null) {
        const existing = await table.findByIdempotencyKey(sessionId, key);
        if (existing) return { outcome: "duplicate", event: existing as LedgerEvent<T> };
      }
      const head = await table.head(sessionId);
      const fields = {
        sessionId,
        seq: (head?.seq ?? 0) + 1,
        type: input.type,
        payload,
        occurredAt: now().toISOString(),
        prevHash: head?.hash ?? (await getSeedHash()),
      };
      const event: LedgerEvent<T> = { ...fields, eventId: newId(), hash: await eventHash(fields) };
      if (await table.insert(event, key)) return { outcome: "stored", event };
    }
    throw new LedgerConflictError(sessionId);
  }

  async function read(sessionId: string): Promise<LedgerEvent[]> {
    const events = await table.events(sessionId);
    const { opener } = options;
    if (!opener || opener.isOpen(events)) return events;
    await opener.open(sessionId, (input) => appendRaw(sessionId, input), now());
    return table.events(sessionId);
  }

  return {
    read,
    async append(sessionId, input) {
      if (options.opener && input.type !== "session.opened" && !(await table.head(sessionId))) await read(sessionId);
      return appendRaw(sessionId, input);
    },
    findSessionByOrderId: (orderId) => table.sessionByOrderId(orderId),
    findSessionBySenderBatchId: (senderBatchId) => table.requestBySenderBatchId(senderBatchId),
    findSessionByPayoutBatchId: (payoutBatchId) => table.requestByPayoutBatchId(payoutBatchId),
    sentPayoutCentsSince: (sinceIso) => table.sentPayoutCentsSince(sinceIso),
  };
}
