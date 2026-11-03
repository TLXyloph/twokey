/**
 * PayPal webhook signature verification by postback (POST /v1/notifications/verify-webhook-signature).
 *
 * PayPal requires the event "posted back exactly as it was received", so the raw body text is
 * spliced into the request unchanged, never parsed and re-stringified. The transmission headers
 * are length-checked (PayPal's documented maxima) before any PayPal call, so a forged request
 * with oversized headers never costs a verify call.
 */
import { z } from "zod";
import { PaypalApiError, type PaypalClient } from "./client";

export const VERIFY_WEBHOOK_PATH = "/v1/notifications/verify-webhook-signature";
export const WEBHOOK_ID_MAX_LENGTH = 50;

/** Verify-request field, the header PayPal sends it in, and its documented maximum length. */
export const TRANSMISSION_FIELDS = [
  { field: "auth_algo", header: "paypal-auth-algo", max: 100 },
  { field: "cert_url", header: "paypal-cert-url", max: 500 },
  { field: "transmission_id", header: "paypal-transmission-id", max: 50 },
  { field: "transmission_sig", header: "paypal-transmission-sig", max: 500 },
  { field: "transmission_time", header: "paypal-transmission-time", max: 100 },
] as const;

export type TransmissionField = (typeof TRANSMISSION_FIELDS)[number]["field"];
export type Transmission = Record<TransmissionField, string>;

/** `reason` names the header only (`missing:<header>` or `too_long:<header>`), never its value. */
export type TransmissionCheck = { ok: true; value: Transmission } | { ok: false; reason: string };

export function readTransmission(headers: Headers): TransmissionCheck {
  const value: Partial<Transmission> = {};
  for (const { field, header, max } of TRANSMISSION_FIELDS) {
    const text = headers.get(header);
    if (!text) return { ok: false, reason: `missing:${header}` };
    if (text.length > max) return { ok: false, reason: `too_long:${header}` };
    value[field] = text;
  }
  return { ok: true, value: value as Transmission };
}

function isJsonObjectText(raw: string): boolean {
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

/**
 * The verify request body: the six fields as JSON, then `"webhook_event":` and the raw event
 * text unchanged. `rawEvent` must be one JSON object (checked here), so it can't change the
 * request's shape.
 */
export function buildVerifyRequestBody(transmission: Transmission, webhookId: string, rawEvent: string): string {
  if (!isJsonObjectText(rawEvent)) throw new Error("The webhook event must be a single JSON object.");
  const fields = {
    auth_algo: transmission.auth_algo,
    cert_url: transmission.cert_url,
    transmission_id: transmission.transmission_id,
    transmission_sig: transmission.transmission_sig,
    transmission_time: transmission.transmission_time,
    webhook_id: webhookId,
  };
  return JSON.stringify(fields).slice(0, -1) + ',"webhook_event":' + rawEvent + "}";
}

export interface WebhookVerifier {
  /** True for SUCCESS, false for FAILURE. Throws `PaypalApiError` when PayPal can't answer. */
  verify(transmission: Transmission, rawEvent: string): Promise<boolean>;
}

const verifyResponseSchema = z.object({ verification_status: z.string() });

export function createWebhookVerifier(client: PaypalClient, webhookId: string): WebhookVerifier {
  return {
    async verify(transmission, rawEvent) {
      const body = buildVerifyRequestBody(transmission, webhookId, rawEvent);
      const response = await client.postJson(VERIFY_WEBHOOK_PATH, body, "verify");
      if (response.status !== 200) throw new PaypalApiError("verify", response.status, `HTTP ${response.status}`);
      const parsed = verifyResponseSchema.safeParse(response.body);
      if (!parsed.success) throw new PaypalApiError("verify", response.status, "unexpected verify response");
      return parsed.data.verification_status === "SUCCESS";
    },
  };
}
