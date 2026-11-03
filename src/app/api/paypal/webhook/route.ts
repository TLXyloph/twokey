/**
 * POST /api/paypal/webhook: PayPal (sandbox) webhook deliveries. Glue only: the Worker env and
 * the D1 binding come from OpenNext's `getCloudflareContext()`; the receiver itself is
 * `handlePaypalWebhook` (src/payments/paypal/webhook-handler.ts), which documents the statuses.
 *
 * Reads PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_WEBHOOK_ID (Worker secrets), optional
 * PAYPAL_API_BASE (sandbox only), and the D1 binding DB. Anything missing answers 503.
 */
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createD1PaypalEventStore } from "@/ledger/event-store";
import { createPaypalClient } from "@/payments/paypal/client";
import { createWebhookVerifier, type WebhookVerifier } from "@/payments/paypal/verify-webhook";
import { handlePaypalWebhook, type PaypalWebhookConfig } from "@/payments/paypal/webhook-handler";
import type {} from "@/platform/cloudflare-env"; // the CloudflareEnv bindings (DB, PAYPAL_*)

export const runtime = "nodejs";

// Per isolate: the PayPal client, and so its cached token, is reused while the config is the same.
let cached: { key: string; verifier: WebhookVerifier } | undefined;

function verifierFor(config: PaypalWebhookConfig): WebhookVerifier {
  const key = JSON.stringify([config.apiBase, config.clientId, config.clientSecret, config.webhookId]);
  if (cached?.key !== key) {
    const client = createPaypalClient({ clientId: config.clientId, clientSecret: config.clientSecret, apiBase: config.apiBase });
    cached = { key, verifier: createWebhookVerifier(client, config.webhookId) };
  }
  return cached.verifier;
}

function cloudflareEnv(): CloudflareEnv {
  try {
    return getCloudflareContext().env;
  } catch {
    // No Cloudflare context (e.g. plain `next dev`): every binding reads as missing, so 503.
    return {};
  }
}

export async function POST(request: Request): Promise<Response> {
  const env = cloudflareEnv();
  return handlePaypalWebhook(request, {
    env: {
      PAYPAL_CLIENT_ID: env.PAYPAL_CLIENT_ID,
      PAYPAL_CLIENT_SECRET: env.PAYPAL_CLIENT_SECRET,
      PAYPAL_WEBHOOK_ID: env.PAYPAL_WEBHOOK_ID,
      PAYPAL_API_BASE: env.PAYPAL_API_BASE,
    },
    store: env.DB ? createD1PaypalEventStore(env.DB) : undefined,
    verifierFor,
  });
}
