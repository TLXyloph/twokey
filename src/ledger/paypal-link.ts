/**
 * Links a verified PayPal webhook event to the judge session it belongs to (spec §2), after the
 * webhook handler has stored it in `paypal_events`. Idempotent by PayPal's event id.
 *
 *   PAYMENT.CAPTURE.COMPLETED      order id (resource.supplementary_data.related_ids.order_id)
 *                                  -> the session that created the order -> payment.confirmed
 *   PAYMENT.PAYOUTSBATCH.* /       sender_batch_id (the request hash; batch events carry it in
 *   PAYMENT.PAYOUTS-ITEM.*         batch_header.sender_batch_header, items may carry it at the top),
 *                                  else payout_batch_id -> the request -> payout.confirmed on a
 *                                  success (SUCCESS / SUCCEEDED); PROCESSING and PENDING are ignored.
 * Shapes: docs/research/R3-webhook-receiver.md (measured: resource_type payouts / payouts_item).
 */
import type { LedgerAppendResult } from "./contracts";
import type { TwoKeyLedgerStore } from "./ledger-store";
import type { RequestRef } from "./ledger-table";

export type LinkOutcome =
  | { kind: "linked"; type: "payment.confirmed" | "payout.confirmed"; sessionId: string; outcome: LedgerAppendResult["outcome"] }
  | { kind: "unlinked"; reason: "no_order_id" | "no_session" | "no_batch_id" }
  | { kind: "ignored"; reason: "unreadable" | "event_type" | "not_success" };

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const obj = (value: unknown): Json => (isObject(value) ? value : {});
const text = (value: unknown): string | null => (typeof value === "string" && value !== "" && value.length <= 255 ? value : null);

function parse(raw: string): Json | null {
  try {
    const value: unknown = JSON.parse(raw);
    return isObject(value) && text(value.id) && text(value.event_type) ? value : null;
  } catch {
    return null;
  }
}

const SUCCESS = /\.(SUCCESS|SUCCEEDED)$/;

async function linkCapture(store: TwoKeyLedgerStore, event: Json): Promise<LinkOutcome> {
  const resource = obj(event.resource);
  const orderId = text(obj(obj(resource.supplementary_data).related_ids).order_id);
  if (!orderId) return { kind: "unlinked", reason: "no_order_id" };
  const sessionId = await store.findSessionByOrderId(orderId);
  if (!sessionId) return { kind: "unlinked", reason: "no_session" };
  const eventId = text(event.id)!;
  const eventType = text(event.event_type)!;
  const { outcome } = await store.append(sessionId, {
    type: "payment.confirmed",
    payload: { captureId: text(resource.id) ?? "", paypalEventId: eventId, eventType, paypalCreatedAt: text(event.create_time) },
    idempotencyKey: eventId,
  });
  return { kind: "linked", type: "payment.confirmed", sessionId, outcome };
}

async function linkPayout(store: TwoKeyLedgerStore, event: Json): Promise<LinkOutcome> {
  const eventId = text(event.id)!;
  const eventType = text(event.event_type)!;
  const resource = obj(event.resource);
  const header = obj(resource.batch_header);
  const status = text(header.batch_status) ?? text(resource.transaction_status) ?? "";
  if (!SUCCESS.test(eventType) && status !== "SUCCESS") return { kind: "ignored", reason: "not_success" };
  const senderBatchId =
    text(obj(header.sender_batch_header).sender_batch_id) ??
    text(header.sender_batch_id) ??
    text(resource.sender_batch_id) ??
    text(obj(resource.sender_batch_header).sender_batch_id);
  const payoutBatchId = text(header.payout_batch_id) ?? text(resource.payout_batch_id);
  if (!senderBatchId && !payoutBatchId) return { kind: "unlinked", reason: "no_batch_id" };
  // A sender_batch_id we never issued means the batch isn't ours; the batch id is only a fallback
  // for an item event that doesn't carry one.
  const ref: RequestRef | null = senderBatchId
    ? await store.findSessionBySenderBatchId(senderBatchId)
    : await store.findSessionByPayoutBatchId(payoutBatchId!);
  if (!ref) return { kind: "unlinked", reason: "no_session" };
  const { outcome } = await store.append(ref.sessionId, {
    type: "payout.confirmed",
    payload: {
      requestId: ref.requestId,
      payoutBatchId: payoutBatchId ?? "",
      payoutItemId: text(resource.payout_item_id),
      status: status || "SUCCESS",
      paypalEventId: eventId,
      eventType,
      paypalCreatedAt: text(event.create_time),
    },
    idempotencyKey: eventId,
  });
  return { kind: "linked", type: "payout.confirmed", sessionId: ref.sessionId, outcome };
}

export async function linkPaypalEvent(store: TwoKeyLedgerStore, raw: string): Promise<LinkOutcome> {
  const event = parse(raw);
  if (!event) return { kind: "ignored", reason: "unreadable" };
  const eventType = text(event.event_type)!;
  if (eventType === "PAYMENT.CAPTURE.COMPLETED") return linkCapture(store, event);
  if (eventType.startsWith("PAYMENT.PAYOUTSBATCH.") || eventType.startsWith("PAYMENT.PAYOUTS-ITEM.")) return linkPayout(store, event);
  return { kind: "ignored", reason: "event_type" };
}
