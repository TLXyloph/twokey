/**
 * `POST /api/collections/orders/:orderId/capture` ({ method? } -> 200 CaptureResult): after the
 * buyer approves in PayPal's window, capture the order and record `payment.captured` in this
 * session's ledger, idempotent by PayPal's capture id.
 *
 * After the shared checks (./http.ts):
 *   order id malformed, unknown, or another session's    -> 404 unknown_order (PayPal not called)
 *   body not {} / { method: "paypal" | "venmo" }         -> 400 bad_request
 *   already recorded in this session's ledger            -> 200 from the ledger (PayPal not called)
 *   PayPal: INSTRUMENT_DECLINED, or a DECLINED/FAILED capture -> 422 payment_declined
 *           ORDER_NOT_APPROVED / PAYER_ACTION_REQUIRED   -> 409 not_approved
 *           ORDER_ALREADY_CAPTURED (not in our ledger)   -> 409 already_captured
 *           404                                          -> 404 unknown_order
 *           unreachable / 5xx                            -> 502 paypal_unavailable
 *           anything else                                -> 502 paypal_error
 *   ledger lookup or append fails                        -> 500 ledger_error
 *   captured (COMPLETED or PENDING) and recorded         -> 200 { captureId, status, amountCents }
 *
 * Ownership comes from the ledger (`findSessionByOrderId`), never from the browser. The method is
 * the wallet PayPal reports on the capture when it names one, else the body's validated `method`.
 * The amount recorded is the amount PayPal captured; a difference from the order is logged.
 */
import { z } from "zod";
import type { CaptureResult, LedgerEvent, LedgerEventPayloads } from "@/ledger/contracts";
import { capturePaypalOrder, PaypalOrderError, type CapturedPaypalOrder, type PaypalOrderErrorKind } from "@/payments/paypal/orders";
import { admit, errorResponse, jsonResponse, logLine, parseJson, type CollectionsErrorCode, type CollectionsHandlerDeps } from "./http";

const ROUTE = "capture";
const ORDER_ID = /^[A-Za-z0-9]{1,64}$/;
/** Capture statuses that mean the money moved (or will): recorded. Anything else is a decline. */
const RECORDED_STATUSES = new Set(["COMPLETED", "PENDING"]);

export const captureBodySchema = z.strictObject({ method: z.enum(["paypal", "venmo"]).optional() });

const ERRORS: Record<PaypalOrderErrorKind, { status: number; code: CollectionsErrorCode; message?: string }> = {
  declined: { status: 422, code: "payment_declined" },
  not_approved: { status: 409, code: "not_approved" },
  already_captured: { status: 409, code: "already_captured" },
  not_found: { status: 404, code: "unknown_order" },
  unavailable: { status: 502, code: "paypal_unavailable" },
  rejected: { status: 502, code: "paypal_error" },
  unexpected: {
    status: 502,
    code: "paypal_error",
    message: "PayPal's reply couldn't be read, so this payment may or may not have gone through. Check the board before paying again.",
  },
};

type OrderCreated = LedgerEvent<"order.created">;
type PaymentCaptured = LedgerEvent<"payment.captured">;

const isOrderCreated = (event: LedgerEvent, orderId: string): event is OrderCreated =>
  event.type === "order.created" && (event.payload as LedgerEventPayloads["order.created"]).orderId === orderId;
const isCaptured = (event: LedgerEvent, orderId: string): event is PaymentCaptured =>
  event.type === "payment.captured" && (event.payload as LedgerEventPayloads["payment.captured"]).orderId === orderId;

const resultOf = (payload: LedgerEventPayloads["payment.captured"]): CaptureResult => ({
  captureId: payload.captureId,
  status: payload.status,
  amountCents: payload.amountCents,
});

export async function handleCaptureOrder(request: Request, orderId: string, deps: CollectionsHandlerDeps): Promise<Response> {
  const log = deps.log ?? ((line: string) => console.info(line));
  const admitted = await admit(request, deps, ROUTE);
  if (!admitted.ok) return admitted.response;
  const { sessionId, store, client } = admitted;
  const refuse = (status: number, code: CollectionsErrorCode, detail: string, message?: string) => {
    log(logLine(ROUTE, code, { status, sessionId, orderId: ORDER_ID.test(orderId) ? orderId : undefined, detail }));
    return errorResponse(status, code, message);
  };

  if (!ORDER_ID.test(orderId)) return refuse(404, "unknown_order", "order_id");
  const body = captureBodySchema.safeParse(admitted.bodyText.trim() === "" ? {} : parseJson(admitted.bodyText));
  if (!body.success) return refuse(400, "bad_request", "validation");

  let order: OrderCreated | undefined;
  let recorded: PaymentCaptured | undefined;
  try {
    if ((await store.findSessionByOrderId(orderId)) !== sessionId) return refuse(404, "unknown_order", "not_this_session");
    const events = await store.read(sessionId);
    order = events.find((event): event is OrderCreated => isOrderCreated(event, orderId));
    recorded = events.find((event): event is PaymentCaptured => isCaptured(event, orderId));
  } catch {
    return refuse(500, "ledger_error", "lookup");
  }
  if (!order) return refuse(404, "unknown_order", "no_order_event");
  if (recorded) {
    log(logLine(ROUTE, "already_recorded", { status: 200, sessionId, orderId, captureId: recorded.payload.captureId }));
    return jsonResponse(200, resultOf(recorded.payload));
  }

  let capture: CapturedPaypalOrder;
  try {
    capture = await capturePaypalOrder(client, orderId);
  } catch (error) {
    const kind = error instanceof PaypalOrderError ? error.kind : "unexpected";
    const mapped = ERRORS[kind];
    return refuse(mapped.status, mapped.code, `paypal:${kind}`, mapped.message);
  }
  if (!RECORDED_STATUSES.has(capture.captureStatus)) return refuse(422, "payment_declined", "capture_status");

  const payload: LedgerEventPayloads["payment.captured"] = {
    orderId,
    captureId: capture.captureId,
    eventId: order.payload.eventId,
    amountCents: capture.amountCents,
    currency: capture.currency,
    status: capture.captureStatus,
    method: capture.fundingSource ?? body.data.method ?? "paypal",
  };
  let stored: LedgerEventPayloads["payment.captured"];
  try {
    const result = await store.append(sessionId, { type: "payment.captured", payload, idempotencyKey: capture.captureId });
    stored = result.event.payload;
  } catch {
    log(logLine(ROUTE, "ledger_error", { status: 500, sessionId, orderId, captureId: capture.captureId, detail: "append" }));
    return errorResponse(500, "ledger_error", "PayPal took the payment, but the club's ledger couldn't record it yet. Don't pay again.");
  }
  const mismatch = capture.amountCents !== order.payload.amountCents ? "amount_mismatch" : undefined;
  log(logLine(ROUTE, "captured", { status: 200, sessionId, orderId, captureId: capture.captureId, detail: mismatch }));
  return jsonResponse(200, resultOf(stored));
}
