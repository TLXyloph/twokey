import { describe, expect, it } from "vitest";
import { createPaypalClient, PaypalApiError } from "@/payments/paypal/client";
import {
  buildVerifyRequestBody,
  createWebhookVerifier,
  readTransmission,
  TRANSMISSION_FIELDS,
  VERIFY_WEBHOOK_PATH,
  type Transmission,
} from "@/payments/paypal/verify-webhook";
import {
  AWKWARD_RAW_EVENT,
  FAKE_CLIENT_ID,
  FAKE_CLIENT_SECRET,
  FAKE_WEBHOOK_ID,
  fakePaypal,
  payoutsBatchSuccessEvent,
  rawEvent,
  TRANSMISSION_HEADERS,
  type FakePaypalOptions,
} from "./fixtures";

const transmission: Transmission = {
  auth_algo: TRANSMISSION_HEADERS["paypal-auth-algo"],
  cert_url: TRANSMISSION_HEADERS["paypal-cert-url"],
  transmission_id: TRANSMISSION_HEADERS["paypal-transmission-id"],
  transmission_sig: TRANSMISSION_HEADERS["paypal-transmission-sig"],
  transmission_time: TRANSMISSION_HEADERS["paypal-transmission-time"],
};

describe("readTransmission", () => {
  it("reads the five PayPal headers into the verify fields", () => {
    expect(readTransmission(new Headers(TRANSMISSION_HEADERS))).toEqual({ ok: true, value: transmission });
  });

  it("uses PayPal's documented maximum lengths", () => {
    expect(TRANSMISSION_FIELDS.map(({ header, max }) => [header, max])).toEqual([
      ["paypal-auth-algo", 100],
      ["paypal-cert-url", 500],
      ["paypal-transmission-id", 50],
      ["paypal-transmission-sig", 500],
      ["paypal-transmission-time", 100],
    ]);
  });

  it.each(TRANSMISSION_FIELDS.map(({ header }) => header))("refuses a missing or empty %s", (header) => {
    const headers = new Headers(TRANSMISSION_HEADERS);
    headers.delete(header);
    expect(readTransmission(headers)).toEqual({ ok: false, reason: `missing:${header}` });
    headers.set(header, "");
    expect(readTransmission(headers)).toEqual({ ok: false, reason: `missing:${header}` });
  });

  it.each(TRANSMISSION_FIELDS.map(({ header, max }) => [header, max] as const))("accepts %s at %i characters and refuses one more", (header, max) => {
    const headers = new Headers(TRANSMISSION_HEADERS);
    headers.set(header, "x".repeat(max));
    expect(readTransmission(headers).ok).toBe(true);
    headers.set(header, "x".repeat(max + 1));
    expect(readTransmission(headers)).toEqual({ ok: false, reason: `too_long:${header}` });
  });
});

describe("buildVerifyRequestBody", () => {
  it("splices the raw event text in byte for byte after the six verify fields", () => {
    const body = buildVerifyRequestBody(transmission, FAKE_WEBHOOK_ID, AWKWARD_RAW_EVENT);
    const prefix =
      JSON.stringify({ ...transmission, webhook_id: FAKE_WEBHOOK_ID }).slice(0, -1) + ',"webhook_event":';
    expect(body).toBe(`${prefix}${AWKWARD_RAW_EVENT}}`);

    const sent = new TextEncoder().encode(body);
    const received = new TextEncoder().encode(AWKWARD_RAW_EVENT);
    const start = new TextEncoder().encode(prefix).byteLength;
    expect(sent.slice(start, start + received.byteLength)).toEqual(received);
    expect(sent.byteLength).toBe(start + received.byteLength + 1);
  });

  it("produces JSON with exactly the seven documented fields, in order", () => {
    const parsed = JSON.parse(buildVerifyRequestBody(transmission, FAKE_WEBHOOK_ID, AWKWARD_RAW_EVENT)) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual([
      "auth_algo",
      "cert_url",
      "transmission_id",
      "transmission_sig",
      "transmission_time",
      "webhook_id",
      "webhook_event",
    ]);
    expect(parsed.webhook_id).toBe(FAKE_WEBHOOK_ID);
    expect(parsed.webhook_event).toEqual(JSON.parse(AWKWARD_RAW_EVENT));
  });

  it.each([
    ["an array", "[1,2]"],
    ["a string", '"text"'],
    ["null", "null"],
    ["truncated JSON", '{"id":"WH-1"'],
    ["text that would close the request early", '{"id":"WH-1"}, "webhook_id": "attacker"'],
  ])("refuses %s, so the inserted text can never change the request's shape", (_label, raw) => {
    expect(() => buildVerifyRequestBody(transmission, FAKE_WEBHOOK_ID, raw)).toThrow(/JSON object/);
  });
});

describe("createWebhookVerifier", () => {
  const verifier = (options: FakePaypalOptions = {}) => {
    const paypal = fakePaypal(options);
    const client = createPaypalClient({ clientId: FAKE_CLIENT_ID, clientSecret: FAKE_CLIENT_SECRET, fetch: paypal.fetch });
    return { paypal, verifier: createWebhookVerifier(client, FAKE_WEBHOOK_ID) };
  };

  it("posts the spliced body to verify-webhook-signature and accepts SUCCESS", async () => {
    const { paypal, verifier: subject } = verifier();
    const raw = rawEvent(payoutsBatchSuccessEvent);
    expect(VERIFY_WEBHOOK_PATH).toBe("/v1/notifications/verify-webhook-signature");
    expect(await subject.verify(transmission, raw)).toBe(true);
    expect(paypal.verifyCalls()[0]?.body).toBe(buildVerifyRequestBody(transmission, FAKE_WEBHOOK_ID, raw));
  });

  it("returns false for FAILURE", async () => {
    const { verifier: subject } = verifier({ verification: "FAILURE" });
    expect(await subject.verify(transmission, rawEvent(payoutsBatchSuccessEvent))).toBe(false);
  });

  it("throws a PaypalApiError with the HTTP status when PayPal answers non-200", async () => {
    const { verifier: subject } = verifier({ verifyStatus: 400 });
    const error = await subject.verify(transmission, rawEvent(payoutsBatchSuccessEvent)).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PaypalApiError);
    expect(error).toMatchObject({ operation: "verify", status: 400 });
  });

  it("throws on a 200 without a verification_status", async () => {
    const { verifier: subject } = verifier({ verifyBody: { status: "ok" } });
    await expect(subject.verify(transmission, rawEvent(payoutsBatchSuccessEvent))).rejects.toMatchObject({ operation: "verify", status: 200 });
  });

  it("treats any status other than SUCCESS as a failed verification", async () => {
    const { verifier: subject } = verifier({ verifyBody: { verification_status: "success" } });
    expect(await subject.verify(transmission, rawEvent(payoutsBatchSuccessEvent))).toBe(false);
  });
});
