/**
 * Validates a PayPal webhook event's envelope and extracts the summary columns stored beside it.
 *
 * Only `id` and `event_type` are required. The summary is read from the resource's *shape*,
 * not from `resource_type` (PayPal doesn't document the payout events' values):
 * - payout batch: `resource.batch_header.{payout_batch_id, batch_status, amount{currency, value}}`
 * - payout item:  `resource.{payout_item_id, transaction_status, payout_item.amount{currency, value}}`
 * - otherwise (e.g. a capture): `resource.{id, status, amount{currency_code, value}}`
 * A summary field that is missing or of the wrong type becomes null; it never rejects the event.
 */
import { z } from "zod";

export interface PaypalEventSummary {
  eventId: string;
  eventType: string;
  resourceType: string | null;
  resourceId: string | null;
  resourceStatus: string | null;
  amountValue: string | null;
  amountCurrency: string | null;
  eventCreatedAt: string | null;
}

export type SummaryReason = "invalid_json" | "not_an_object" | "invalid_envelope";
export type SummaryResult = { ok: true; value: PaypalEventSummary } | { ok: false; reason: SummaryReason };

export const MAX_FIELD_LENGTH = 255;

const envelopeSchema = z.looseObject({
  id: z.string().min(1).max(MAX_FIELD_LENGTH),
  event_type: z.string().min(1).max(MAX_FIELD_LENGTH),
});

type JsonObject = Record<string, unknown>;

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 && value.length <= MAX_FIELD_LENGTH ? value : null;

const child = (value: unknown, key: string): unknown => (isObject(value) ? value[key] : undefined);

/** Captures use `currency_code`, payouts use `currency`. */
function amountOf(value: unknown): { amountValue: string | null; amountCurrency: string | null } {
  return {
    amountValue: text(child(value, "value")),
    amountCurrency: text(child(value, "currency_code")) ?? text(child(value, "currency")),
  };
}

function resourceSummary(resource: unknown) {
  const batchHeader = child(resource, "batch_header");
  if (isObject(batchHeader)) {
    return {
      resourceId: text(batchHeader.payout_batch_id),
      resourceStatus: text(batchHeader.batch_status),
      ...amountOf(batchHeader.amount),
    };
  }
  if (child(resource, "payout_item_id") !== undefined) {
    return {
      resourceId: text(child(resource, "payout_item_id")),
      resourceStatus: text(child(resource, "transaction_status")),
      ...amountOf(child(child(resource, "payout_item"), "amount")),
    };
  }
  return {
    resourceId: text(child(resource, "id")),
    resourceStatus: text(child(resource, "status")),
    ...amountOf(child(resource, "amount")),
  };
}

export function summarizePaypalEvent(raw: string): SummaryResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
  if (!isObject(parsed)) return { ok: false, reason: "not_an_object" };
  const envelope = envelopeSchema.safeParse(parsed);
  if (!envelope.success) return { ok: false, reason: "invalid_envelope" };
  return {
    ok: true,
    value: {
      eventId: envelope.data.id,
      eventType: envelope.data.event_type,
      resourceType: text(parsed.resource_type),
      ...resourceSummary(parsed.resource),
      eventCreatedAt: text(parsed.create_time),
    },
  };
}
