/**
 * The ledger table on D1 (schema: config/d1/migrations/0003_ledger_events.sql). Same semantics as
 * the in-memory table in ./ledger-table.ts; the shared contract suite runs the store over both.
 *
 * The insert is `INSERT ... ON CONFLICT DO NOTHING`: a taken (session, seq) or (session,
 * idempotency key) changes no row, and the store re-reads and retries. The chain trigger refuses
 * an event that doesn't link to its predecessor, so a bug can't write a broken chain either.
 */
import type { D1DatabaseLike, D1PreparedStatementLike, D1Value } from "@/platform/cloudflare-env";
import type { LedgerEvent } from "./contracts";
import { canonicalJson } from "./canonical";
import { indexOf, type LedgerTable, type RequestRef } from "./ledger-table";

const COLUMNS = "session_id, seq, event_id, type, payload, occurred_at, prev_hash, hash";

export const INSERT_LEDGER_EVENT_SQL =
  `INSERT INTO ledger_events (${COLUMNS}, idempotency_key, order_id, sender_batch_id, payout_batch_id, request_id, amount_cents) ` +
  "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING";
export const LEDGER_HEAD_SQL = "SELECT seq, hash FROM ledger_events WHERE session_id = ?1 ORDER BY seq DESC LIMIT 1";
export const LEDGER_EVENTS_SQL = `SELECT ${COLUMNS} FROM ledger_events WHERE session_id = ?1 ORDER BY seq`;
export const LEDGER_BY_KEY_SQL = `SELECT ${COLUMNS} FROM ledger_events WHERE session_id = ?1 AND idempotency_key = ?2`;
export const SESSION_BY_ORDER_SQL = "SELECT session_id FROM ledger_events WHERE order_id = ?1 ORDER BY occurred_at LIMIT 1";
export const REQUEST_BY_SENDER_BATCH_SQL =
  "SELECT session_id, request_id FROM ledger_events WHERE sender_batch_id = ?1 AND request_id IS NOT NULL LIMIT 1";
export const REQUEST_BY_PAYOUT_BATCH_SQL =
  "SELECT session_id, request_id FROM ledger_events WHERE payout_batch_id = ?1 AND request_id IS NOT NULL LIMIT 1";
export const SENT_PAYOUT_CENTS_SINCE_SQL = `SELECT COALESCE(SUM(r.amount_cents), 0) AS n
FROM ledger_events s
JOIN ledger_events r ON r.session_id = s.session_id AND r.request_id = s.request_id AND r.type = 'payout.requested'
WHERE s.type = 'payout.sent' AND s.occurred_at >= ?1`;

interface EventRow {
  session_id: string;
  seq: number;
  event_id: string;
  type: string;
  payload: string;
  occurred_at: string;
  prev_hash: string;
  hash: string;
}

async function rows<Row>(statement: D1PreparedStatementLike): Promise<Row[]> {
  if (!statement.all) throw new Error("D1 statement has no all(): cannot read rows");
  const { results } = await statement.all<Row>();
  if (!Array.isArray(results)) throw new Error("D1 all() returned no results array");
  return results;
}

const query = <Row>(db: D1DatabaseLike, sql: string, ...values: D1Value[]) => rows<Row>(db.prepare(sql).bind(...values));

function toEvent(row: EventRow): LedgerEvent {
  return {
    sessionId: row.session_id,
    seq: Number(row.seq),
    eventId: row.event_id,
    type: row.type as LedgerEvent["type"],
    payload: JSON.parse(row.payload) as LedgerEvent["payload"],
    occurredAt: row.occurred_at,
    prevHash: row.prev_hash,
    hash: row.hash,
  };
}

const toRef = (row: { session_id: string; request_id: string } | undefined): RequestRef | null =>
  row ? { sessionId: row.session_id, requestId: row.request_id } : null;

export function createD1LedgerTable(db: D1DatabaseLike): LedgerTable {
  return {
    async head(sessionId) {
      const [row] = await query<{ seq: number; hash: string }>(db, LEDGER_HEAD_SQL, sessionId);
      return row ? { seq: Number(row.seq), hash: row.hash } : null;
    },
    async events(sessionId) {
      return (await query<EventRow>(db, LEDGER_EVENTS_SQL, sessionId)).map(toEvent);
    },
    async findByIdempotencyKey(sessionId, key) {
      const [row] = await query<EventRow>(db, LEDGER_BY_KEY_SQL, sessionId, key);
      return row ? toEvent(row) : null;
    },
    async insert(event, idempotencyKey) {
      const index = indexOf(event.type, event.payload);
      const result = await db
        .prepare(INSERT_LEDGER_EVENT_SQL)
        .bind(
          event.sessionId,
          event.seq,
          event.eventId,
          event.type,
          canonicalJson(event.payload),
          event.occurredAt,
          event.prevHash,
          event.hash,
          idempotencyKey,
          index.orderId,
          index.senderBatchId,
          index.payoutBatchId,
          index.requestId,
          index.amountCents,
        )
        .run();
      const changes = result.meta.changes;
      if (changes === 1) return true;
      if (changes === 0) return false;
      throw new Error(`ledger_events insert: unexpected change count ${String(changes)}`);
    },
    async sessionByOrderId(orderId) {
      const [row] = await query<{ session_id: string }>(db, SESSION_BY_ORDER_SQL, orderId);
      return row?.session_id ?? null;
    },
    async requestBySenderBatchId(senderBatchId) {
      return toRef((await query<{ session_id: string; request_id: string }>(db, REQUEST_BY_SENDER_BATCH_SQL, senderBatchId))[0]);
    },
    async requestByPayoutBatchId(payoutBatchId) {
      return toRef((await query<{ session_id: string; request_id: string }>(db, REQUEST_BY_PAYOUT_BATCH_SQL, payoutBatchId))[0]);
    },
    async sentPayoutCentsSince(sinceIso) {
      const [row] = await query<{ n: unknown }>(db, SENT_PAYOUT_CENTS_SINCE_SQL, sinceIso);
      const n = Number(row?.n);
      if (!Number.isFinite(n)) throw new Error("D1 aggregate returned no number");
      return n;
    },
  };
}
