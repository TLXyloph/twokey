/**
 * PayPal Payouts (sandbox) for the two-key executor: one payout per request.
 *
 * `POST /v1/payments/payouts` with `sender_batch_id` = the request hash and the header
 * `PayPal-Request-Id` = the request hash, one EMAIL item (`sender_item_id` = the request id).
 * PayPal keeps both for 30 days: a repeat with the same Request-Id returns the original answer,
 * and a repeat with only the same sender_batch_id is a 400 "already exists" (measured, R1 §5).
 * That 400 means the payout exists, so it resolves to the existing batch instead of failing.
 *
 * Failure reasons are plain sentences picked from a fixed list, never PayPal's body.
 */
import { PaypalApiError, type PaypalClient } from "./client";

export const PAYOUTS_PATH = "/v1/payments/payouts";

export interface PayoutOrder {
  /** The request hash: the batch's dedupe key. */
  senderBatchId: string;
  requestId: string;
  receiverEmail: string;
  amountCents: number;
  currency: "USD";
  note: string;
  emailSubject: string;
}

export type PayoutResult =
  | { ok: true; payoutBatchId: string; batchStatus: string; existing: boolean }
  | { ok: false; httpStatus: number; reason: string };

export interface SendPayoutOptions {
  /** Finds the batch id an earlier attempt recorded for this sender_batch_id (the ledger knows it). */
  findExistingBatchId?(senderBatchId: string): Promise<string | null>;
}

export const formatAmount = (cents: number): string => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;

export function payoutBody(order: PayoutOrder): string {
  return JSON.stringify({
    sender_batch_header: { sender_batch_id: order.senderBatchId, email_subject: order.emailSubject },
    items: [
      {
        recipient_type: "EMAIL",
        amount: { value: formatAmount(order.amountCents), currency: order.currency },
        note: order.note,
        sender_item_id: order.requestId,
        receiver: order.receiverEmail,
      },
    ],
  });
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string => (typeof value === "string" ? value : "");

function batchHeader(body: unknown): { payoutBatchId: string; batchStatus: string } | null {
  const header = isObject(body) && isObject(body.batch_header) ? body.batch_header : null;
  if (!header) return null;
  return { payoutBatchId: str(header.payout_batch_id), batchStatus: str(header.batch_status) || "UNKNOWN" };
}

/** PayPal's 400 for a sender_batch_id it has seen in the last 30 days. */
export function isAlreadyExists(status: number, body: unknown): boolean {
  if (status !== 400 || !isObject(body)) return false;
  const details = Array.isArray(body.details) ? body.details.filter(isObject) : [];
  const texts = [str(body.name), str(body.message), ...details.flatMap((d) => [str(d.issue), str(d.description)])];
  return texts.some((text) => /already exists?/i.test(text));
}

const REASON_BY_NAME: Record<string, string> = {
  INSUFFICIENT_FUNDS: "The club's PayPal balance is too low for this payout.",
  AUTHORIZATION_ERROR: "PayPal didn't allow this app to send the payout.",
  RATE_LIMIT_REACHED: "PayPal is limiting payouts right now, so this one wasn't taken.",
};

function reasonFor(status: number, body: unknown): string {
  const named = isObject(body) ? REASON_BY_NAME[str(body.name)] : undefined;
  if (named) return named;
  if (status === 401 || status === 403) return REASON_BY_NAME.AUTHORIZATION_ERROR!;
  if (status === 429) return REASON_BY_NAME.RATE_LIMIT_REACHED!;
  if (status >= 500) return `PayPal had a problem on its side (HTTP ${status}) and didn't take the payout.`;
  return `PayPal refused the payout (HTTP ${status}).`;
}

export const NO_ANSWER_REASON =
  "PayPal didn't answer in time. If the payout went through anyway, PayPal's confirmation will still show here.";

export async function getPayoutBatch(client: PaypalClient, payoutBatchId: string): Promise<{ payoutBatchId: string; batchStatus: string } | null> {
  try {
    const response = await client.getJson(`${PAYOUTS_PATH}/${encodeURIComponent(payoutBatchId)}`, "payout_get");
    if (response.status !== 200) return null;
    const header = batchHeader(response.body);
    return header ? { payoutBatchId: header.payoutBatchId || payoutBatchId, batchStatus: header.batchStatus } : null;
  } catch {
    return null;
  }
}

export async function sendPayout(client: PaypalClient, order: PayoutOrder, options: SendPayoutOptions = {}): Promise<PayoutResult> {
  let response;
  try {
    response = await client.postJson(PAYOUTS_PATH, payoutBody(order), "payout", { "PayPal-Request-Id": order.senderBatchId });
  } catch (error) {
    const status = error instanceof PaypalApiError ? error.status : 0;
    return { ok: false, httpStatus: status, reason: status === 0 ? NO_ANSWER_REASON : reasonFor(status, undefined) };
  }
  if (response.status === 200 || response.status === 201) {
    const header = batchHeader(response.body);
    return { ok: true, payoutBatchId: header?.payoutBatchId ?? "", batchStatus: header?.batchStatus ?? "UNKNOWN", existing: false };
  }
  if (isAlreadyExists(response.status, response.body)) {
    const knownId = (await options.findExistingBatchId?.(order.senderBatchId).catch(() => null)) ?? null;
    const batch = knownId ? await getPayoutBatch(client, knownId) : null;
    return { ok: true, payoutBatchId: batch?.payoutBatchId ?? knownId ?? "", batchStatus: batch?.batchStatus ?? "EXISTING", existing: true };
  }
  return { ok: false, httpStatus: response.status, reason: reasonFor(response.status, response.body) };
}
