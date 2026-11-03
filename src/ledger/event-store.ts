/**
 * The append-only store of verified PayPal webhook events: the first event source of TwoKey's
 * ledger. One row per PayPal event id; appending an id that is already stored is a no-op that
 * reports "duplicate" (PayPal redelivers until it gets a 2xx). Schema:
 * config/d1/migrations/0001_paypal_events.sql, whose triggers refuse UPDATE and DELETE.
 */
import type { D1DatabaseLike } from "@/platform/cloudflare-env";

export interface PaypalEventRecord {
  /** PayPal's event id (`WH-...`): the dedupe key. */
  eventId: string;
  eventType: string;
  resourceType: string | null;
  resourceId: string | null;
  resourceStatus: string | null;
  /** A decimal string as PayPal sends it, e.g. "500.00". */
  amountValue: string | null;
  amountCurrency: string | null;
  /** The event's `create_time`. */
  eventCreatedAt: string | null;
  /** ISO 8601: when TwoKey stored the event. */
  receivedAt: string;
  /** The event text exactly as received. */
  payload: string;
}

export type AppendOutcome = "stored" | "duplicate";

export interface PaypalEventStore {
  append(record: PaypalEventRecord): Promise<AppendOutcome>;
}

export const INSERT_PAYPAL_EVENT_SQL =
  "INSERT INTO paypal_events (event_id, event_type, resource_type, resource_id, resource_status, " +
  "amount_value, amount_currency, event_created_at, received_at, payload) " +
  "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (event_id) DO NOTHING";

export function createD1PaypalEventStore(db: D1DatabaseLike): PaypalEventStore {
  return {
    async append(record) {
      const result = await db
        .prepare(INSERT_PAYPAL_EVENT_SQL)
        .bind(
          record.eventId,
          record.eventType,
          record.resourceType,
          record.resourceId,
          record.resourceStatus,
          record.amountValue,
          record.amountCurrency,
          record.eventCreatedAt,
          record.receivedAt,
          record.payload,
        )
        .run();
      const changes = result.meta.changes;
      if (changes === 1) return "stored";
      if (changes === 0) return "duplicate";
      throw new Error(`paypal_events insert: unexpected change count ${String(changes)}`);
    },
  };
}

export interface InMemoryPaypalEventStore extends PaypalEventStore {
  /** Stored rows in append order, as frozen copies. */
  records(): readonly PaypalEventRecord[];
}

/** For tests and local runs: the same semantics as the D1 store, in memory. */
export function createInMemoryPaypalEventStore(): InMemoryPaypalEventStore {
  const rows = new Map<string, Readonly<PaypalEventRecord>>();
  return {
    async append(record) {
      if (rows.has(record.eventId)) return "duplicate";
      rows.set(record.eventId, Object.freeze({ ...record }));
      return "stored";
    },
    records: () => [...rows.values()],
  };
}
