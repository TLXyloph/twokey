import { describe, expect, it, vi } from "vitest";
import type { AppendOutcome, PaypalEventRecord, PaypalEventStore } from "@/ledger/event-store";
import { PaypalApiError } from "@/payments/paypal/client";
import type { Transmission, WebhookVerifier } from "@/payments/paypal/verify-webhook";
import {
  handlePaypalWebhook,
  MAX_BODY_BYTES,
  resolveWebhookConfig,
  type PaypalWebhookConfig,
  type PaypalWebhookEnv,
  type WebhookHandlerDeps,
} from "@/payments/paypal/webhook-handler";
import {
  AWKWARD_RAW_EVENT,
  FAKE_CLIENT_ID,
  FAKE_CLIENT_SECRET,
  FAKE_TOKEN,
  FAKE_WEBHOOK_ID,
  PAYEE_EMAIL,
  payoutsBatchSuccessEvent,
  payoutsItemSucceededEvent,
  rawEvent,
  SANDBOX,
  TRANSMISSION_HEADERS,
  webhookRequest,
} from "./fixtures";

const ENV: PaypalWebhookEnv = {
  PAYPAL_CLIENT_ID: FAKE_CLIENT_ID,
  PAYPAL_CLIENT_SECRET: FAKE_CLIENT_SECRET,
  PAYPAL_WEBHOOK_ID: FAKE_WEBHOOK_ID,
};
const CONFIG: PaypalWebhookConfig = { clientId: FAKE_CLIENT_ID, clientSecret: FAKE_CLIENT_SECRET, webhookId: FAKE_WEBHOOK_ID, apiBase: SANDBOX };
const RECEIVED_AT = "2026-11-03T20:00:05.000Z";

interface Harness {
  deps: WebhookHandlerDeps;
  verify: ReturnType<typeof vi.fn<WebhookVerifier["verify"]>>;
  verifierFor: ReturnType<typeof vi.fn<WebhookHandlerDeps["verifierFor"]>>;
  append: ReturnType<typeof vi.fn<PaypalEventStore["append"]>>;
  lines: string[];
}

function harness(
  over: {
    env?: PaypalWebhookEnv;
    store?: "none";
    verified?: boolean;
    verifyError?: unknown;
    appendResult?: AppendOutcome | Error;
    linker?: WebhookHandlerDeps["linker"];
  } = {},
): Harness {
  const verify = vi.fn<WebhookVerifier["verify"]>(async () => {
    if (over.verifyError) throw over.verifyError;
    return over.verified ?? true;
  });
  const verifierFor = vi.fn<WebhookHandlerDeps["verifierFor"]>(() => ({ verify }));
  const append = vi.fn<PaypalEventStore["append"]>(async () => {
    const result = over.appendResult ?? "stored";
    if (result instanceof Error) throw result;
    return result;
  });
  const lines: string[] = [];
  const deps: WebhookHandlerDeps = {
    env: over.env ?? ENV,
    store: over.store === "none" ? undefined : { append },
    verifierFor,
    now: () => new Date(RECEIVED_AT),
    log: (line) => lines.push(line),
    ...(over.linker && { linker: over.linker }),
  };
  return { deps, verify, verifierFor, append, lines };
}

const run = async (h: Harness, request: Request = webhookRequest()) => {
  const response = await handlePaypalWebhook(request, h.deps);
  return { response, json: (await response.json()) as Record<string, unknown> };
};

const noPaypalCall = (h: Harness) => {
  expect(h.verifierFor).not.toHaveBeenCalled();
  expect(h.verify).not.toHaveBeenCalled();
  expect(h.append).not.toHaveBeenCalled();
};

describe("resolveWebhookConfig", () => {
  it("trims the values and defaults the API base to the sandbox", () => {
    expect(resolveWebhookConfig({ PAYPAL_CLIENT_ID: ` ${FAKE_CLIENT_ID}\n`, PAYPAL_CLIENT_SECRET: FAKE_CLIENT_SECRET, PAYPAL_WEBHOOK_ID: FAKE_WEBHOOK_ID })).toEqual({
      ok: true,
      value: CONFIG,
    });
  });

  it("names every problem, by variable name only", () => {
    expect(resolveWebhookConfig({ PAYPAL_CLIENT_SECRET: "  ", PAYPAL_WEBHOOK_ID: "W".repeat(51), PAYPAL_API_BASE: "https://api-m.paypal.com" })).toEqual({
      ok: false,
      problems: ["PAYPAL_CLIENT_ID:unset", "PAYPAL_CLIENT_SECRET:unset", "PAYPAL_WEBHOOK_ID:too_long", "PAYPAL_API_BASE:not_sandbox"],
    });
  });
});

describe("handlePaypalWebhook", () => {
  it("verifies, stores and answers 200 for a new event", async () => {
    const h = harness();
    const raw = rawEvent(payoutsBatchSuccessEvent);
    const { response, json } = await run(h, webhookRequest({ body: raw }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(json).toEqual({ ok: true, outcome: "stored" });
    expect(h.verifierFor).toHaveBeenCalledWith(CONFIG);
    const transmission: Transmission = {
      auth_algo: TRANSMISSION_HEADERS["paypal-auth-algo"],
      cert_url: TRANSMISSION_HEADERS["paypal-cert-url"],
      transmission_id: TRANSMISSION_HEADERS["paypal-transmission-id"],
      transmission_sig: TRANSMISSION_HEADERS["paypal-transmission-sig"],
      transmission_time: TRANSMISSION_HEADERS["paypal-transmission-time"],
    };
    expect(h.verify).toHaveBeenCalledWith(transmission, raw);
    const record: PaypalEventRecord = {
      eventId: "WH-TEST0002-PAYOUTSBATCH",
      eventType: "PAYMENT.PAYOUTSBATCH.SUCCESS",
      resourceType: "payouts",
      resourceId: "BATCHTEST0001",
      resourceStatus: "SUCCESS",
      amountValue: "1.00",
      amountCurrency: "USD",
      eventCreatedAt: "2026-11-03T20:01:00.000Z",
      receivedAt: RECEIVED_AT,
      payload: raw,
    };
    expect(h.append).toHaveBeenCalledWith(record);
    expect(h.verify.mock.invocationCallOrder[0]).toBeLessThan(h.append.mock.invocationCallOrder[0] ?? 0);
  });

  it("answers 200 for a duplicate, so PayPal stops retrying", async () => {
    const h = harness({ appendResult: "duplicate" });
    const { response, json } = await run(h);
    expect(response.status).toBe(200);
    expect(json).toEqual({ ok: true, outcome: "duplicate" });
    expect(h.lines[0]).toMatch(/outcome=duplicate status=200/);
  });

  describe("linking to the ledger, after the event is stored", () => {
    const linked = vi.fn<NonNullable<WebhookHandlerDeps["linker"]>>(async () => ({
      kind: "linked",
      type: "payout.confirmed",
      sessionId: "sessionAbcdefghijklmnop",
      outcome: "stored",
    }));

    it("hands the linker the raw event and logs what it linked on a second line", async () => {
      const h = harness({ linker: linked });
      const raw = rawEvent(payoutsBatchSuccessEvent);
      const { response } = await run(h, webhookRequest({ body: raw }));
      expect(response.status).toBe(200);
      expect(linked).toHaveBeenCalledWith(raw);
      expect(h.append.mock.invocationCallOrder[0]).toBeLessThan(linked.mock.invocationCallOrder.at(-1) ?? 0);
      expect(h.lines[1]).toBe("[paypal/webhook] link=payout.confirmed outcome=stored session=sessionA event_id=WH-TEST0002-PAYOUTSBATCH");
    });

    it("links a redelivery too (linking is idempotent by PayPal's event id)", async () => {
      const linker = vi.fn<NonNullable<WebhookHandlerDeps["linker"]>>(async () => ({ kind: "unlinked", reason: "no_session" }));
      const h = harness({ appendResult: "duplicate", linker });
      expect((await run(h)).response.status).toBe(200);
      expect(linker).toHaveBeenCalledTimes(1);
      expect(h.lines).toHaveLength(1);
    });

    it("still answers 200 when linking fails, and logs one line without the error's text", async () => {
      const linker = vi.fn<NonNullable<WebhookHandlerDeps["linker"]>>(async () => {
        throw new Error(`D1_ERROR near ${PAYEE_EMAIL}`);
      });
      const h = harness({ linker });
      const { response, json } = await run(h);
      expect(response.status).toBe(200);
      expect(json).toEqual({ ok: true, outcome: "stored" });
      expect(h.lines[1]).toBe("[paypal/webhook] link=error event_id=WH-TEST0002-PAYOUTSBATCH detail=link_failed");
    });

    it("never links an event that wasn't verified and stored", async () => {
      const linker = vi.fn<NonNullable<WebhookHandlerDeps["linker"]>>();
      await run(harness({ verified: false, linker }));
      await run(harness({ appendResult: new Error("D1 down"), linker }));
      expect(linker).not.toHaveBeenCalled();
    });
  });

  it("hands the verifier and the store the received bytes unchanged", async () => {
    const h = harness();
    const bytes = new TextEncoder().encode(AWKWARD_RAW_EVENT);
    await run(h, webhookRequest({ body: bytes }));
    const raw = h.verify.mock.calls[0]?.[1] ?? "";
    expect(raw).toBe(AWKWARD_RAW_EVENT);
    expect(new TextEncoder().encode(raw)).toEqual(bytes);
    expect(h.append.mock.calls[0]?.[0].payload).toBe(AWKWARD_RAW_EVENT);
  });

  describe("413: body over 64 KB", () => {
    const padded = (bytes: number) => {
      const base = rawEvent({ ...payoutsBatchSuccessEvent, pad: "" });
      return base.replace('"pad":""', `"pad":"${"x".repeat(bytes - base.length)}"`);
    };

    it("refuses a declared Content-Length over the limit before reading the body", async () => {
      const h = harness();
      const { response } = await run(h, webhookRequest({ contentLength: String(MAX_BODY_BYTES + 1) }));
      expect(response.status).toBe(413);
      noPaypalCall(h);
      expect(h.lines[0]).toMatch(/outcome=too_large status=413/);
    });

    it("refuses a streamed body over the limit and accepts one exactly at it", async () => {
      expect(MAX_BODY_BYTES).toBe(65_536);
      const over = harness();
      expect((await run(over, webhookRequest({ body: padded(MAX_BODY_BYTES + 1) }))).response.status).toBe(413);
      noPaypalCall(over);
      const atLimit = harness();
      expect((await run(atLimit, webhookRequest({ body: padded(MAX_BODY_BYTES) }))).response.status).toBe(200);
    });
  });

  describe("503: configuration or binding missing", () => {
    it.each([
      ["PAYPAL_CLIENT_ID unset", { ...ENV, PAYPAL_CLIENT_ID: undefined }, "PAYPAL_CLIENT_ID:unset"],
      ["PAYPAL_CLIENT_SECRET blank", { ...ENV, PAYPAL_CLIENT_SECRET: " " }, "PAYPAL_CLIENT_SECRET:unset"],
      ["PAYPAL_WEBHOOK_ID unset", { ...ENV, PAYPAL_WEBHOOK_ID: undefined }, "PAYPAL_WEBHOOK_ID:unset"],
      ["PAYPAL_WEBHOOK_ID over 50 characters", { ...ENV, PAYPAL_WEBHOOK_ID: "W".repeat(51) }, "PAYPAL_WEBHOOK_ID:too_long"],
      ["PAYPAL_API_BASE set to live", { ...ENV, PAYPAL_API_BASE: "https://api-m.paypal.com" }, "PAYPAL_API_BASE:not_sandbox"],
    ])("%s", async (_label, env, problem) => {
      const h = harness({ env });
      const { response, json } = await run(h);
      expect(response.status).toBe(503);
      expect(json).toEqual({ error: { code: "misconfigured", message: expect.any(String) } });
      noPaypalCall(h);
      expect(h.lines).toHaveLength(1);
      expect(h.lines[0]).toContain(`detail=${problem}`);
    });

    it("DB binding missing", async () => {
      const h = harness({ store: "none" });
      expect((await run(h)).response.status).toBe(503);
      noPaypalCall(h);
      expect(h.lines[0]).toContain("detail=DB:unbound");
    });

    it("lists every problem at once", async () => {
      const h = harness({ env: {}, store: "none" });
      await run(h);
      expect(h.lines[0]).toContain("detail=PAYPAL_CLIENT_ID:unset,PAYPAL_CLIENT_SECRET:unset,PAYPAL_WEBHOOK_ID:unset,DB:unbound");
    });
  });

  describe("400: transmission headers, checked before any PayPal call", () => {
    it.each(Object.keys(TRANSMISSION_HEADERS) as (keyof typeof TRANSMISSION_HEADERS)[])("missing %s", async (header) => {
      const h = harness();
      const { response, json } = await run(h, webhookRequest({ omit: [header] }));
      expect(response.status).toBe(400);
      expect(json).toEqual({ error: { code: "bad_request", message: expect.any(String) } });
      noPaypalCall(h);
      expect(h.lines[0]).toContain(`detail=missing:${header}`);
    });

    it.each([
      ["paypal-auth-algo", 100],
      ["paypal-cert-url", 500],
      ["paypal-transmission-id", 50],
      ["paypal-transmission-sig", 500],
      ["paypal-transmission-time", 100],
    ] as const)("%s over %i characters", async (header, max) => {
      const h = harness();
      const { response } = await run(h, webhookRequest({ headers: { [header]: "x".repeat(max + 1) } }));
      expect(response.status).toBe(400);
      noPaypalCall(h);
      expect(h.lines[0]).toContain(`detail=too_long:${header}`);
    });
  });

  describe("400: body", () => {
    it("refuses invalid UTF-8 instead of replacing it", async () => {
      const h = harness();
      const bytes = new Uint8Array([...new TextEncoder().encode('{"id":"WH-1","event_type":"X","s":"'), 0xff, 0xfe, ...new TextEncoder().encode('"}')]);
      const { response } = await run(h, webhookRequest({ body: bytes }));
      expect(response.status).toBe(400);
      noPaypalCall(h);
      expect(h.lines[0]).toContain("detail=invalid_utf8");
    });

    it("keeps a byte-order mark rather than silently dropping it, so the body is refused", async () => {
      const h = harness();
      const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(rawEvent(payoutsBatchSuccessEvent))]);
      expect((await run(h, webhookRequest({ body: bytes }))).response.status).toBe(400);
      noPaypalCall(h);
    });

    it.each([
      ["empty", "", "invalid_json"],
      ["not JSON", "id=WH-1", "invalid_json"],
      ["a JSON array", "[]", "not_an_object"],
      ["an object without event_type", '{"id":"WH-1"}', "invalid_envelope"],
    ])("refuses a body that is %s", async (_label, body, detail) => {
      const h = harness();
      expect((await run(h, webhookRequest({ body }))).response.status).toBe(400);
      noPaypalCall(h);
      expect(h.lines[0]).toContain(`detail=${detail}`);
    });
  });

  it("400 for a failed verification, storing nothing", async () => {
    const h = harness({ verified: false });
    const { response, json } = await run(h);
    expect(response.status).toBe(400);
    expect(json).toEqual({ error: { code: "verification_failed", message: expect.any(String) } });
    expect(h.verify).toHaveBeenCalledTimes(1);
    expect(h.append).not.toHaveBeenCalled();
    expect(h.lines[0]).toMatch(/outcome=verification_failed status=400 event_id=WH-TEST0002-PAYOUTSBATCH/);
  });

  describe("500: PayPal or D1 error", () => {
    it.each([
      [new PaypalApiError("verify", 503, "HTTP 503"), "verify_http_503"],
      [new PaypalApiError("verify", 400, "HTTP 400"), "verify_http_400"],
      [new PaypalApiError("token", 401, "HTTP 401"), "token_http_401"],
      [new PaypalApiError("verify", 0, "no response"), "verify_no_response"],
      [new Error("surprise"), "verify_unexpected"],
    ])("%s", async (error, detail) => {
      const h = harness({ verifyError: error });
      const { response, json } = await run(h);
      expect(response.status).toBe(500);
      expect(json).toEqual({ error: { code: "paypal_error", message: expect.any(String) } });
      expect(h.append).not.toHaveBeenCalled();
      expect(h.lines[0]).toContain(`detail=${detail}`);
    });

    it.each([
      ["D1_ERROR: no such table: paypal_events: SQLITE_ERROR", "no_such_table"],
      ["D1_ERROR: paypal_events is append-only: SQLITE_CONSTRAINT", "append_only"],
      ["D1_ERROR: Network connection lost.", "d1_error"],
    ])("store throws %s", async (message, detail) => {
      const h = harness({ appendResult: new Error(message) });
      const { response, json } = await run(h);
      expect(response.status).toBe(500);
      expect(json).toEqual({ error: { code: "store_error", message: expect.any(String) } });
      expect(h.lines[0]).toContain(`detail=${detail}`);
    });

    it("an unexpected failure building the verifier", async () => {
      const h = harness();
      h.verifierFor.mockImplementation(() => {
        throw new Error("boom");
      });
      const { response, json } = await run(h);
      expect(response.status).toBe(500);
      expect(json).toEqual({ error: { code: "internal_error", message: expect.any(String) } });
      expect(h.lines).toHaveLength(1);
    });
  });

  describe("the log line", () => {
    const SENSITIVE = [
      ...Object.values(TRANSMISSION_HEADERS),
      PAYEE_EMAIL,
      FAKE_TOKEN,
      FAKE_CLIENT_SECRET,
      FAKE_CLIENT_ID,
      FAKE_WEBHOOK_ID,
      "TXNTEST0001",
      "A payout item has succeeded",
    ];

    it("is one line with the outcome and the event's ids, and nothing else from the request", async () => {
      const h = harness();
      await run(h, webhookRequest({ body: rawEvent(payoutsItemSucceededEvent) }));
      expect(h.lines).toEqual([
        "[paypal/webhook] outcome=stored status=200 event_id=WH-TEST0003-PAYOUTSITEM event_type=PAYMENT.PAYOUTS-ITEM.SUCCEEDED resource_type=payouts_item resource_id=ITEMTEST0001",
      ]);
    });

    it.each([
      ["stored", {}],
      ["verification_failed", { verified: false }],
      ["paypal_error", { verifyError: new PaypalApiError("verify", 500, "HTTP 500") }],
      ["store_error", { appendResult: new Error(`D1_ERROR: ${PAYEE_EMAIL}`) }],
    ] as const)("never contains the body, headers, emails, tokens or secrets (%s)", async (_outcome, over) => {
      const h = harness(over);
      const raw = rawEvent(payoutsItemSucceededEvent);
      await run(h, webhookRequest({ body: raw }));
      expect(h.lines).toHaveLength(1);
      const line = h.lines[0] ?? "";
      expect(line).not.toContain("\n");
      expect(line).not.toContain(raw);
      expect(SENSITIVE.filter((value) => line.includes(value))).toEqual([]);
      expect(line).not.toMatch(/@/);
    });

    it("redacts event fields that aren't plain identifiers (an unverified body can hold anything)", async () => {
      const h = harness({ verified: false });
      const forged = { id: `${PAYEE_EMAIL}`, event_type: "X\n[paypal/webhook] outcome=stored", resource_type: "a b", resource: { id: FAKE_TOKEN.replace(/-/g, " ") } };
      await run(h, webhookRequest({ body: JSON.stringify(forged) }));
      expect(h.lines).toEqual([
        "[paypal/webhook] outcome=verification_failed status=400 event_id=(redacted) event_type=(redacted) resource_type=(redacted) resource_id=(redacted)",
      ]);
    });
  });
});
