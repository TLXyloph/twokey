/**
 * PayPal Orders v2 (sandbox): create a CAPTURE order and capture it, for the Collections context.
 *
 *   POST /v2/checkout/orders                 one purchase unit, priced by our server
 *   POST /v2/checkout/orders/{id}/capture    empty JSON body
 *
 * Both send a `PayPal-Request-Id` so a retried call returns PayPal's first answer instead of a new
 * order or a 422 ORDER_ALREADY_CAPTURED. The header rides on `postJson`'s optional fourth argument;
 * a client without it (the original client.ts) ignores it and the calls still work, just without
 * that idempotency.
 *
 * Responses are parsed with zod. Captures report `amount.currency_code`. Errors are
 * `PaypalOrderError`s in plain words, with a `kind` the caller maps to a status; they never carry a
 * response body, PayPal's debug id, a token or a credential.
 */
import { z } from "zod";
import { PaypalApiError, type PaypalClient, type PaypalJsonResponse } from "./client";

/** What the orders calls need from the REST client. `PaypalClient` satisfies it. */
export interface OrdersClient {
  postJson(path: string, jsonBody: string, operation: string, headers?: Record<string, string>): Promise<PaypalJsonResponse>;
}
// Compile-time proof that the existing client fits.
const _clientFits: (client: PaypalClient) => OrdersClient = (client) => client;
void _clientFits;

export type PaypalOrderErrorKind =
  /** PayPal declined the buyer's funding (INSTRUMENT_DECLINED): they can try another way to pay. */
  | "declined"
  | "already_captured"
  /** The buyer hasn't approved the order yet (or must act again). */
  | "not_approved"
  | "not_found"
  /** PayPal refused our request as invalid. */
  | "rejected"
  /** No answer, a refused token, rate limiting or a PayPal server error. */
  | "unavailable"
  /** A 2xx we couldn't read. */
  | "unexpected";

const PLAIN_WORDS: Record<PaypalOrderErrorKind, string> = {
  declined: "PayPal declined the payment method.",
  already_captured: "the order was already paid.",
  not_approved: "the buyer hasn't approved the payment yet.",
  not_found: "PayPal doesn't know that order.",
  rejected: "PayPal refused the request.",
  unavailable: "PayPal didn't answer.",
  unexpected: "PayPal's answer couldn't be read.",
};

export class PaypalOrderError extends Error {
  readonly kind: PaypalOrderErrorKind;
  readonly operation: string;
  /** The HTTP status, or 0 when no response arrived. */
  readonly status: number;
  /** PayPal's issue code (e.g. INSTRUMENT_DECLINED), when it gave one. Not secret. */
  readonly issue: string | undefined;

  constructor(operation: string, kind: PaypalOrderErrorKind, status: number, issue?: string) {
    super(`PayPal ${operation} failed: ${PLAIN_WORDS[kind]}`);
    this.name = "PaypalOrderError";
    this.operation = operation;
    this.kind = kind;
    this.status = status;
    this.issue = issue;
  }
}

const CREATE = "create order";
const CAPTURE = "capture order";
/** PayPal order ids are short upper-case alphanumerics; anything else never reaches a URL path. */
const ORDER_ID = /^[A-Za-z0-9]{1,64}$/;
const MAX_TEXT = 127;

/** 1500 -> "15.00", PayPal's amount `value`. Integer arithmetic only. */
export function formatPaypalValue(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new RangeError("cents must be a non-negative whole number");
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

const VALUE = /^(\d{1,9})(?:\.(\d{1,2}))?$/;

/** "15.00" -> 1500. Undefined for anything but a plain non-negative amount with at most 2 decimals. */
export function parsePaypalValue(value: string): number | undefined {
  const match = VALUE.exec(value);
  if (!match) return undefined;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

export interface CreatePaypalOrderInput {
  amountCents: number;
  unitAmountCents: number;
  quantity: number;
  currency: "USD";
  /** Shown to the buyer on PayPal: "End-of-season banquet × 2". */
  description: string;
  itemName: string;
  /** Our event id. */
  referenceId: string;
  /** A non-secret reference PayPal echoes on the capture and its webhooks. */
  customId: string;
  /** PayPal-Request-Id: makes a retried create return the same order. */
  requestId: string;
}

export interface CreatedPaypalOrder {
  orderId: string;
  status: string;
}

export interface CapturedPaypalOrder {
  orderId: string;
  orderStatus: string;
  captureId: string;
  /** "COMPLETED", "PENDING", "DECLINED", ... as PayPal reports it. */
  captureStatus: string;
  amountCents: number;
  currency: "USD";
  /** The wallet the buyer paid with, when PayPal names it. */
  fundingSource: "paypal" | "venmo" | null;
}

const createdSchema = z.object({ id: z.string().regex(ORDER_ID), status: z.string().min(1) });

const capturedSchema = z.object({
  id: z.string().regex(ORDER_ID),
  status: z.string().min(1),
  payment_source: z.object({ paypal: z.unknown().optional(), venmo: z.unknown().optional() }).optional(),
  purchase_units: z
    .array(
      z.object({
        payments: z.object({
          captures: z
            .array(
              z.object({
                id: z.string().min(1).max(64),
                status: z.string().min(1).max(64),
                amount: z.object({ currency_code: z.literal("USD"), value: z.string() }),
              }),
            )
            .min(1),
        }),
      }),
    )
    .min(1),
});

const errorSchema = z.object({ details: z.array(z.object({ issue: z.string() })).optional() });

function issueOf(body: unknown): string | undefined {
  const parsed = errorSchema.safeParse(body);
  const issue = parsed.success ? parsed.data.details?.[0]?.issue : undefined;
  return issue !== undefined && /^[A-Z0-9_]{1,64}$/.test(issue) ? issue : undefined;
}

function kindForStatus(status: number, issue: string | undefined): PaypalOrderErrorKind {
  if (issue === "INSTRUMENT_DECLINED") return "declined";
  if (issue === "ORDER_ALREADY_CAPTURED") return "already_captured";
  if (issue === "ORDER_NOT_APPROVED" || issue === "PAYER_ACTION_REQUIRED") return "not_approved";
  if (status === 404) return "not_found";
  if (status === 0 || status === 401 || status === 403 || status === 429 || status >= 500) return "unavailable";
  return "rejected";
}

async function send(client: OrdersClient, operation: string, path: string, body: string, requestId: string): Promise<PaypalJsonResponse> {
  let response: PaypalJsonResponse;
  try {
    response = await client.postJson(path, body, operation, { "PayPal-Request-Id": requestId });
  } catch (error) {
    // PaypalApiError: no response, or the token was refused. Anything else is still "no answer".
    throw new PaypalOrderError(operation, "unavailable", error instanceof PaypalApiError ? error.status : 0);
  }
  if (response.status !== 200 && response.status !== 201) {
    const issue = issueOf(response.body);
    throw new PaypalOrderError(operation, kindForStatus(response.status, issue), response.status, issue);
  }
  return response;
}

function checkText(name: string, value: string): void {
  if (value.length === 0 || value.length > MAX_TEXT) throw new RangeError(`${name} must be 1 to ${MAX_TEXT} characters`);
}

export async function createPaypalOrder(client: OrdersClient, input: CreatePaypalOrderInput): Promise<CreatedPaypalOrder> {
  if (input.amountCents !== input.unitAmountCents * input.quantity) throw new RangeError("amount must equal unit amount × quantity");
  checkText("description", input.description);
  checkText("customId", input.customId);
  checkText("itemName", input.itemName);
  const money = (cents: number) => ({ currency_code: input.currency, value: formatPaypalValue(cents) });
  const body = JSON.stringify({
    intent: "CAPTURE",
    purchase_units: [
      {
        reference_id: input.referenceId,
        custom_id: input.customId,
        description: input.description,
        amount: { ...money(input.amountCents), breakdown: { item_total: money(input.amountCents) } },
        items: [{ name: input.itemName, quantity: String(input.quantity), unit_amount: money(input.unitAmountCents) }],
      },
    ],
  });
  const response = await send(client, CREATE, "/v2/checkout/orders", body, input.requestId);
  const parsed = createdSchema.safeParse(response.body);
  if (!parsed.success) throw new PaypalOrderError(CREATE, "unexpected", response.status);
  return { orderId: parsed.data.id, status: parsed.data.status };
}

export async function capturePaypalOrder(client: OrdersClient, orderId: string): Promise<CapturedPaypalOrder> {
  if (!ORDER_ID.test(orderId)) throw new PaypalOrderError(CAPTURE, "rejected", 0);
  const response = await send(client, CAPTURE, `/v2/checkout/orders/${orderId}/capture`, "{}", `twokey-capture-${orderId}`);
  const parsed = capturedSchema.safeParse(response.body);
  const capture = parsed.success ? parsed.data.purchase_units[0]?.payments.captures[0] : undefined;
  const amountCents = capture ? parsePaypalValue(capture.amount.value) : undefined;
  if (!parsed.success || !capture || amountCents === undefined) throw new PaypalOrderError(CAPTURE, "unexpected", response.status);
  const source = parsed.data.payment_source;
  return {
    orderId: parsed.data.id,
    orderStatus: parsed.data.status,
    captureId: capture.id,
    captureStatus: capture.status,
    amountCents,
    currency: "USD",
    fundingSource: source?.venmo !== undefined ? "venmo" : source?.paypal !== undefined ? "paypal" : null,
  };
}
