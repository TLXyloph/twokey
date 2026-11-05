/**
 * `POST /api/collections/orders` (CreateOrderBody -> 201 { orderId }): a parent asks for tickets,
 * the server prices them, creates an Orders v2 CAPTURE order at PayPal and records `order.created`
 * in this session's ledger. The browser sends the event and the quantity, never an amount.
 *
 * After the shared checks (./http.ts):
 *   body not { eventId: "banquet", quantity: 1..4 }       -> 400 bad_request
 *   the session's ledger can't be opened or written       -> 500 ledger_error
 *   PayPal unreachable or erroring                        -> 502 paypal_unavailable / paypal_error
 *   created and recorded                                  -> 201 { orderId }
 *
 * The ledger is read first, so a session's first event is always `session.opened` (the store opens
 * it on first read) and a session that can't be recorded never gets a PayPal order. If PayPal
 * creates the order but the append fails, the order stays unrecorded and so can't be captured
 * here: the capture route only captures orders this session's ledger holds.
 */
import { z } from "zod";
import { MAX_TICKETS_PER_ORDER, type CreateOrderBody } from "@/ledger/contracts";
import { createPaypalOrder, PaypalOrderError } from "@/payments/paypal/orders";
import { findCollectionEvent, priceOrder } from "./events";
import { admit, errorResponse, jsonResponse, logLine, parseJson, type CollectionsHandlerDeps } from "./http";

const ROUTE = "orders";

export const createOrderBodySchema = z.strictObject({
  eventId: z.literal("banquet"),
  quantity: z.number().int().min(1).max(MAX_TICKETS_PER_ORDER),
}) satisfies z.ZodType<CreateOrderBody>;

/**
 * The order's `custom_id`: a one-way, non-secret reference to the session (SHA-256 of a labelled
 * session id, first 16 hex digits). PayPal echoes it on the capture and its webhooks; the session
 * id itself never leaves this server.
 */
export async function orderReference(sessionId: string, eventId: string = "banquet"): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`twokey-order-ref-v1:${sessionId}`));
  const hex = Array.from(new Uint8Array(digest).slice(0, 8), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `twokey-${eventId}-${hex}`;
}

export async function handleCreateOrder(request: Request, deps: CollectionsHandlerDeps): Promise<Response> {
  const log = deps.log ?? ((line: string) => console.info(line));
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const admitted = await admit(request, deps, ROUTE);
  if (!admitted.ok) return admitted.response;
  const { sessionId, store, client } = admitted;

  const body = createOrderBodySchema.safeParse(parseJson(admitted.bodyText));
  const event = body.success ? findCollectionEvent(body.data.eventId) : undefined;
  if (!body.success || !event) {
    log(logLine(ROUTE, "bad_request", { status: 400, sessionId, detail: "validation" }));
    return errorResponse(400, "bad_request", `Choose from 1 to ${MAX_TICKETS_PER_ORDER} banquet tickets.`);
  }
  const priced = priceOrder(event, body.data.quantity);

  try {
    await store.read(sessionId);
  } catch {
    log(logLine(ROUTE, "ledger_error", { status: 500, sessionId, detail: "read" }));
    return errorResponse(500, "ledger_error");
  }

  let orderId: string;
  try {
    const order = await createPaypalOrder(client, {
      amountCents: priced.amountCents,
      unitAmountCents: priced.unitAmountCents,
      quantity: priced.quantity,
      currency: priced.currency,
      description: priced.description,
      itemName: priced.itemName,
      referenceId: priced.eventId,
      customId: await orderReference(sessionId, priced.eventId),
      requestId: newId(),
    });
    orderId = order.orderId;
  } catch (error) {
    const kind = error instanceof PaypalOrderError ? error.kind : "unexpected";
    log(logLine(ROUTE, "paypal_error", { status: 502, sessionId, detail: `create:${kind}` }));
    return errorResponse(502, kind === "unavailable" ? "paypal_unavailable" : "paypal_error");
  }

  try {
    await store.append(sessionId, {
      type: "order.created",
      payload: { orderId, eventId: priced.eventId, quantity: priced.quantity, amountCents: priced.amountCents, currency: priced.currency },
      idempotencyKey: `order:${orderId}`,
    });
  } catch {
    log(logLine(ROUTE, "ledger_error", { status: 500, sessionId, orderId, detail: "append" }));
    return errorResponse(500, "ledger_error");
  }
  log(logLine(ROUTE, "created", { status: 201, sessionId, orderId }));
  return jsonResponse(201, { orderId });
}
