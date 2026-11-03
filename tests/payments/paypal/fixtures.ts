/**
 * Shared fixtures for the PayPal webhook tests. Every id, email and credential is fictional.
 * Event shapes follow docs/research/R3-webhook-receiver.md (capture from PayPal's samples;
 * payout batch and item from the payouts schema, since PayPal publishes no full samples).
 */
import type { FetchLike } from "@/payments/paypal/client";

export const SANDBOX = "https://api-m.sandbox.paypal.com";
export const FAKE_CLIENT_ID = "test-client-id-not-real";
export const FAKE_CLIENT_SECRET = "test-client-secret-not-real";
export const FAKE_TOKEN = "test-access-token-not-real";
export const FAKE_WEBHOOK_ID = "WEBHOOKTEST0000000000001";
export const PAYEE_EMAIL = "vendor-fictional@example.test";

/** The five PayPal transmission headers, with fictional values within PayPal's length limits. */
export const TRANSMISSION_HEADERS = {
  "paypal-auth-algo": "SHA256withRSA",
  "paypal-cert-url": "https://api-m.sandbox.paypal.com/v1/notifications/certs/CERT-TEST-0000-FICTIONAL",
  "paypal-transmission-id": "0d6e4d40-0000-4000-8000-00000000test",
  "paypal-transmission-sig": "VEVTVC1TSUdOQVRVUkUtTk9ULVJFQUwtVEVTVC1TSUdOQVRVUkUtTk9ULVJFQUw=",
  "paypal-transmission-time": "2026-11-03T20:00:00Z",
} as const;
export type TransmissionHeaderName = keyof typeof TRANSMISSION_HEADERS;

export const captureCompletedEvent = {
  id: "WH-TEST0001-CAPTURE",
  event_version: "1.0",
  create_time: "2026-11-03T20:00:00.000Z",
  resource_type: "capture",
  resource_version: "2.0",
  event_type: "PAYMENT.CAPTURE.COMPLETED",
  summary: "Payment completed for $ 500.00 USD",
  resource: {
    id: "CAPTURE-TEST-0001",
    status: "COMPLETED",
    amount: { value: "500.00", currency_code: "USD" },
    final_capture: true,
    payee: { email_address: PAYEE_EMAIL, merchant_id: "MERCHANTTEST01" },
    create_time: "2026-11-03T19:59:58Z",
  },
  links: [{ href: "https://api-m.sandbox.paypal.com/v1/notifications/webhooks-events/WH-TEST0001-CAPTURE", rel: "self", method: "GET" }],
};

export const payoutsBatchSuccessEvent = {
  id: "WH-TEST0002-PAYOUTSBATCH",
  event_version: "1.0",
  create_time: "2026-11-03T20:01:00.000Z",
  resource_type: "payouts",
  event_type: "PAYMENT.PAYOUTSBATCH.SUCCESS",
  summary: "Payouts batch completed successfully.",
  resource: {
    batch_header: {
      payout_batch_id: "BATCHTEST0001",
      batch_status: "SUCCESS",
      time_created: "2026-11-03T20:00:40Z",
      time_completed: "2026-11-03T20:00:57Z",
      sender_batch_header: { sender_batch_id: "twokey-test-0001" },
      amount: { currency: "USD", value: "1.00" },
      fees: { currency: "USD", value: "0.25" },
      payments: 1,
    },
  },
};

export const payoutsItemSucceededEvent = {
  id: "WH-TEST0003-PAYOUTSITEM",
  event_version: "1.0",
  create_time: "2026-11-03T20:01:05.000Z",
  resource_type: "payouts_item",
  event_type: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
  summary: "A payout item has succeeded",
  resource: {
    payout_item_id: "ITEMTEST0001",
    transaction_id: "TXNTEST0001",
    transaction_status: "SUCCESS",
    payout_batch_id: "BATCHTEST0001",
    payout_item_fee: { currency: "USD", value: "0.25" },
    payout_item: {
      recipient_type: "EMAIL",
      amount: { currency: "USD", value: "1.00" },
      receiver: PAYEE_EMAIL,
      sender_item_id: "item-1",
    },
    time_processed: "2026-11-03T20:00:57Z",
  },
};

/**
 * A body a parse-and-restringify would change: odd spacing and newlines, a non-ASCII name,
 * escaped unicode, a `/` escape, trailing-zero and exponent numbers, a nested key that looks
 * like a verify field, and duplicate keys.
 */
export const AWKWARD_RAW_EVENT =
  '{ "id" : "WH-TEST0004-AWKWARD",\n\t"event_type":"PAYMENT.CAPTURE.COMPLETED", "resource_type":"capture",\r\n' +
  ' "summary": "Café \\u00e9 \\/ \u{1F511}", "resource": {"id":"CAPTURE-TEST-0004","status":"COMPLETED",' +
  '"amount":{"value":"12.50","currency_code":"USD"},"ratio":1.10,"big":1e2,"webhook_id":"nested-not-top-level"},' +
  ' "dup":1, "dup":2 }\n';

export const rawEvent = (event: object): string => JSON.stringify(event);

export interface FakeCall {
  url: string;
  method: string;
  headers: Headers;
  body: string;
}

export interface FakePaypal {
  fetch: FetchLike;
  calls: FakeCall[];
  tokenCalls: () => FakeCall[];
  verifyCalls: () => FakeCall[];
}

export interface FakePaypalOptions {
  verification?: "SUCCESS" | "FAILURE";
  tokenStatus?: number;
  verifyStatus?: number;
  expiresIn?: number;
  token?: string;
  verifyBody?: unknown;
  networkError?: boolean;
}

/** A fake PayPal sandbox behind a `fetch`: token and verify endpoints only. No network. */
export function fakePaypal(options: FakePaypalOptions = {}): FakePaypal {
  const calls: FakeCall[] = [];
  const fetch: FetchLike = async (input, init) => {
    const call: FakeCall = {
      url: String(input),
      method: init.method ?? "GET",
      headers: new Headers(init.headers),
      body: typeof init.body === "string" ? init.body : "",
    };
    calls.push(call);
    if (options.networkError) throw new TypeError("fetch failed");
    if (call.url === `${SANDBOX}/v1/oauth2/token`) {
      const status = options.tokenStatus ?? 200;
      const body =
        status === 200
          ? { scope: "https://uri.paypal.com/services/payments/payouts", access_token: options.token ?? FAKE_TOKEN, token_type: "Bearer", expires_in: options.expiresIn ?? 32_400 }
          : { error: "invalid_client", error_description: "Client Authentication failed" };
      return Response.json(body, { status });
    }
    if (call.url === `${SANDBOX}/v1/notifications/verify-webhook-signature`) {
      const status = options.verifyStatus ?? 200;
      const body = options.verifyBody ?? (status === 200 ? { verification_status: options.verification ?? "SUCCESS" } : { name: "VALIDATION_ERROR" });
      return Response.json(body, { status });
    }
    return Response.json({ name: "NOT_FOUND" }, { status: 404 });
  };
  const byPath = (path: string) => () => calls.filter((call) => call.url === `${SANDBOX}${path}`);
  return { fetch, calls, tokenCalls: byPath("/v1/oauth2/token"), verifyCalls: byPath("/v1/notifications/verify-webhook-signature") };
}

export interface WebhookRequestOptions {
  body?: string | Uint8Array;
  headers?: Partial<Record<TransmissionHeaderName, string>>;
  omit?: TransmissionHeaderName[];
  contentLength?: string;
}

/** A POST like PayPal's delivery: the five transmission headers plus a JSON body. */
export function webhookRequest(options: WebhookRequestOptions = {}): Request {
  const headers = new Headers({ "content-type": "application/json", ...TRANSMISSION_HEADERS, ...options.headers });
  for (const name of options.omit ?? []) headers.delete(name);
  if (options.contentLength !== undefined) headers.set("content-length", options.contentLength);
  const body = options.body ?? rawEvent(payoutsBatchSuccessEvent);
  return new Request("https://twokey.example.test/api/paypal/webhook", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : new Blob([body as BlobPart]),
  });
}
