/**
 * The ledger's storage port: the few reads and the one conditional insert the append algorithm in
 * ./ledger-store.ts needs. Implemented on D1 (./d1-ledger-table.ts, migration 0003) and in memory
 * (below, for tests and plain `next dev`); the shared contract suite runs the store over both.
 */
import type { LedgerEvent, LedgerEventPayloads, LedgerEventType } from "./contracts";

export interface LedgerHead {
  seq: number;
  hash: string;
}

/** Lookup columns copied from a payload at append time (see migration 0003). */
export interface LedgerIndex {
  orderId: string | null;
  senderBatchId: string | null;
  payoutBatchId: string | null;
  requestId: string | null;
  amountCents: number | null;
}

export interface RequestRef {
  sessionId: string;
  requestId: string;
}

export interface LedgerTable {
  head(sessionId: string): Promise<LedgerHead | null>;
  /** The session's events in seq order. */
  events(sessionId: string): Promise<LedgerEvent[]>;
  findByIdempotencyKey(sessionId: string, key: string): Promise<LedgerEvent | null>;
  /** Inserts unless the (session, seq) or the (session, idempotency key) is taken; false then. */
  insert(event: LedgerEvent, idempotencyKey: string | null): Promise<boolean>;
  sessionByOrderId(orderId: string): Promise<string | null>;
  requestBySenderBatchId(senderBatchId: string): Promise<RequestRef | null>;
  requestByPayoutBatchId(payoutBatchId: string): Promise<RequestRef | null>;
  /** Sum of the requested amounts of every payout.sent at or after `sinceIso`, across sessions. */
  sentPayoutCentsSince(sinceIso: string): Promise<number>;
}

type AnyPayload = LedgerEventPayloads[LedgerEventType];
const field = (payload: AnyPayload, key: string): unknown => (payload as unknown as Record<string, unknown>)[key];
const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
const integer = (value: unknown): number | null => (Number.isSafeInteger(value) ? (value as number) : null);

export function indexOf(type: LedgerEventType, payload: AnyPayload): LedgerIndex {
  const index: LedgerIndex = { orderId: null, senderBatchId: null, payoutBatchId: null, requestId: null, amountCents: null };
  if (type === "order.created" || type === "payment.captured") {
    index.orderId = text(field(payload, "orderId"));
    index.amountCents = integer(field(payload, "amountCents"));
  }
  if (type.startsWith("payout.") || type.startsWith("approval.") || type === "risk.assessed") {
    index.requestId = text(field(payload, "requestId"));
  }
  if (type === "payout.requested") {
    index.senderBatchId = text(field(payload, "requestHash"));
    index.amountCents = integer(field(payload, "amountCents"));
  }
  if (type === "payout.sent") index.senderBatchId = text(field(payload, "senderBatchId"));
  if (type === "payout.sent" || type === "payout.confirmed") index.payoutBatchId = text(field(payload, "payoutBatchId"));
  return index;
}

interface MemoryRow {
  event: LedgerEvent;
  idempotencyKey: string | null;
  index: LedgerIndex;
}

export interface InMemoryLedgerTable extends LedgerTable {
  /** Every stored event across sessions, in insert order, as frozen copies. */
  all(): readonly LedgerEvent[];
}

const copy = (event: LedgerEvent): LedgerEvent => JSON.parse(JSON.stringify(event)) as LedgerEvent;
const tick = () => Promise.resolve();

/**
 * Same semantics as the D1 table, including its chain trigger. Every method awaits once before it
 * reads, so concurrent appends interleave the way they would against D1.
 */
export function createInMemoryLedgerTable(): InMemoryLedgerTable {
  const rows: MemoryRow[] = [];
  const ofSession = (sessionId: string) => rows.filter((row) => row.event.sessionId === sessionId);
  const ref = (row: MemoryRow | undefined): RequestRef | null =>
    row?.index.requestId ? { sessionId: row.event.sessionId, requestId: row.index.requestId } : null;

  return {
    async head(sessionId) {
      await tick();
      const last = ofSession(sessionId).at(-1);
      return last ? { seq: last.event.seq, hash: last.event.hash } : null;
    },
    async events(sessionId) {
      await tick();
      return ofSession(sessionId).map((row) => copy(row.event));
    },
    async findByIdempotencyKey(sessionId, key) {
      await tick();
      const row = ofSession(sessionId).find((candidate) => candidate.idempotencyKey === key);
      return row ? copy(row.event) : null;
    },
    async insert(event, idempotencyKey) {
      await tick();
      const session = ofSession(event.sessionId);
      if (session.some((row) => row.event.seq === event.seq)) return false;
      if (idempotencyKey !== null && session.some((row) => row.idempotencyKey === idempotencyKey)) return false;
      if (rows.some((row) => row.event.eventId === event.eventId)) throw new Error("ledger_events: duplicate event id");
      const previous = session.find((row) => row.event.seq === event.seq - 1);
      if (event.seq > 1 && previous?.event.hash !== event.prevHash) throw new Error("ledger_events: an event must link to the one before it");
      rows.push({ event: Object.freeze(copy(event)), idempotencyKey, index: indexOf(event.type, event.payload) });
      return true;
    },
    async sessionByOrderId(orderId) {
      await tick();
      return rows.find((row) => row.index.orderId === orderId)?.event.sessionId ?? null;
    },
    async requestBySenderBatchId(senderBatchId) {
      await tick();
      return ref(rows.find((row) => row.index.senderBatchId === senderBatchId && row.index.requestId));
    },
    async requestByPayoutBatchId(payoutBatchId) {
      await tick();
      return ref(rows.find((row) => row.index.payoutBatchId === payoutBatchId && row.index.requestId));
    },
    async sentPayoutCentsSince(sinceIso) {
      await tick();
      let total = 0;
      for (const sent of rows.filter((row) => row.event.type === "payout.sent" && row.event.occurredAt >= sinceIso)) {
        const requested = rows.find(
          (row) =>
            row.event.type === "payout.requested" &&
            row.event.sessionId === sent.event.sessionId &&
            row.index.requestId === sent.index.requestId,
        );
        total += requested?.index.amountCents ?? 0;
      }
      return total;
    },
    all: () => rows.map((row) => row.event),
  };
}
