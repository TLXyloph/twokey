/**
 * The trace's sources on D1 (./trace.ts): the stored webhooks (`paypal_events`, migration 0001)
 * and the ledger (`ledger_events`, migration 0003), read only.
 *
 * The webhook lookup uses migration 0004's expression index; the query repeats its expression
 * exactly (`TRANSACTION_ID_EXPRESSION`), or SQLite can't use the index.
 */
import { createD1LedgerTable } from "@/ledger/d1-ledger-table";
import type { D1DatabaseLike, D1Value } from "@/platform/cloudflare-env";
import type { TraceSources } from "./trace";

/** The indexed expression of migration 0004 (paypal_events_resource_transaction_id). */
export const TRANSACTION_ID_EXPRESSION = "(CASE WHEN json_valid(payload) THEN json_extract(payload, '$.resource.transaction_id') END)";

export const PAYOUT_BATCH_FOR_TRANSACTION_SQL =
  "SELECT json_extract(payload, '$.resource.payout_batch_id') AS payout_batch_id FROM paypal_events " +
  `WHERE ${TRANSACTION_ID_EXPRESSION} = ?1 AND event_type LIKE 'PAYMENT.PAYOUTS-ITEM.%' ` +
  "AND json_extract(payload, '$.resource.payout_batch_id') IS NOT NULL ORDER BY received_at LIMIT 1";

/** Seeded request ids repeat in every session; a payout can only have been sent by one of them. */
export const SESSIONS_THAT_SENT_SQL =
  "SELECT DISTINCT session_id FROM ledger_events WHERE type = 'payout.sent' AND request_id = ?1 ORDER BY session_id LIMIT 50";

async function rows<Row>(db: D1DatabaseLike, sql: string, ...values: D1Value[]): Promise<Row[]> {
  const statement = db.prepare(sql).bind(...values);
  if (!statement.all) throw new Error("D1 statement has no all(): cannot read rows");
  const { results } = await statement.all<Row>();
  if (!Array.isArray(results)) throw new Error("D1 all() returned no results array");
  return results;
}

export function createD1TraceSources(db: D1DatabaseLike): TraceSources {
  const ledger = createD1LedgerTable(db);
  return {
    async payoutBatchIdForTransaction(transactionId) {
      const [row] = await rows<{ payout_batch_id: unknown }>(db, PAYOUT_BATCH_FOR_TRANSACTION_SQL, transactionId);
      return typeof row?.payout_batch_id === "string" && row.payout_batch_id !== "" ? row.payout_batch_id : null;
    },
    requestByPayoutBatchId: (payoutBatchId) => ledger.requestByPayoutBatchId(payoutBatchId),
    async sessionsThatSent(requestId) {
      return (await rows<{ session_id: string }>(db, SESSIONS_THAT_SENT_SQL, requestId)).map((row) => row.session_id);
    },
    events: (sessionId) => ledger.events(sessionId),
  };
}
