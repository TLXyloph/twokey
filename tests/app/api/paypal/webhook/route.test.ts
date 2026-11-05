import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { D1DatabaseLike, D1Value } from "@/platform/cloudflare-env";
import { buildVerifyRequestBody } from "@/payments/paypal/verify-webhook";
import {
  AWKWARD_RAW_EVENT,
  FAKE_CLIENT_ID,
  FAKE_CLIENT_SECRET,
  FAKE_TOKEN,
  FAKE_WEBHOOK_ID,
  fakePaypal,
  payoutsBatchSuccessEvent,
  rawEvent,
  TRANSMISSION_HEADERS,
  webhookRequest,
  type FakePaypal,
} from "../../../../payments/paypal/fixtures";
import { createD1LedgerTable } from "@/ledger/d1-ledger-table";
import { createLedgerStore } from "@/ledger/ledger-store";
import { sqliteD1 } from "../../../../agents/llm/sqlite-d1";
import { payoutRequested } from "../../../../ledger/fixtures";

// The seams replaced: OpenNext's context (env + D1) and the global fetch. No network.
const context = vi.hoisted(() => ({ env: undefined as CloudflareEnv | undefined }));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => {
    if (!context.env) throw new Error("getCloudflareContext called without a Cloudflare context");
    return { env: context.env, cf: undefined, ctx: {} };
  },
}));

/** A fake D1 that dedupes on the first bound value (event_id), as ON CONFLICT DO NOTHING does. */
function fakeD1() {
  const rows = new Map<string, D1Value[]>();
  const db: D1DatabaseLike = {
    prepare: () => ({
      bind: (...values: D1Value[]) => ({
        bind: () => {
          throw new Error("unexpected second bind");
        },
        run: async () => {
          const id = String(values[0]);
          if (rows.has(id)) return { meta: { changes: 0 } };
          rows.set(id, values);
          return { meta: { changes: 1 } };
        },
        // Ledger linking's lookups: no judge session owns these events.
        all: async <Row,>() => ({ results: [] as Row[] }),
      }),
      run: async () => {
        throw new Error("run without bind");
      },
    }),
  };
  return { db, rows };
}

const secrets = (over: Partial<CloudflareEnv> = {}): CloudflareEnv => ({
  PAYPAL_CLIENT_ID: FAKE_CLIENT_ID,
  PAYPAL_CLIENT_SECRET: FAKE_CLIENT_SECRET,
  PAYPAL_WEBHOOK_ID: FAKE_WEBHOOK_ID,
  ...over,
});

const loadRoute = async () => import("@/app/api/paypal/webhook/route");

let paypal: FakePaypal;
let logs: string[];

const install = (options: Parameters<typeof fakePaypal>[0] = {}) => {
  paypal = fakePaypal(options);
  vi.stubGlobal("fetch", (input: string, init: RequestInit) => paypal.fetch(input, init));
};

beforeEach(() => {
  vi.resetModules();
  context.env = undefined;
  install();
  logs = [];
  vi.spyOn(console, "info").mockImplementation((line: unknown) => {
    logs.push(String(line));
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("POST /api/paypal/webhook", () => {
  it("exports POST only, on the Node.js runtime", async () => {
    const route = await loadRoute();
    expect(Object.keys(route).sort()).toEqual(["POST", "runtime"]);
    expect(route.runtime).toBe("nodejs");
  });

  it("verifies with PayPal, stores the raw event in D1 and answers 200", async () => {
    const d1 = fakeD1();
    context.env = secrets({ DB: d1.db });
    const { POST } = await loadRoute();
    const bytes = new TextEncoder().encode(AWKWARD_RAW_EVENT);
    const response = await POST(webhookRequest({ body: bytes }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, outcome: "stored" });

    const [verify] = paypal.verifyCalls();
    expect(verify?.headers.get("authorization")).toBe(`Bearer ${FAKE_TOKEN}`);
    const transmission = {
      auth_algo: TRANSMISSION_HEADERS["paypal-auth-algo"],
      cert_url: TRANSMISSION_HEADERS["paypal-cert-url"],
      transmission_id: TRANSMISSION_HEADERS["paypal-transmission-id"],
      transmission_sig: TRANSMISSION_HEADERS["paypal-transmission-sig"],
      transmission_time: TRANSMISSION_HEADERS["paypal-transmission-time"],
    };
    expect(verify?.body).toBe(buildVerifyRequestBody(transmission, FAKE_WEBHOOK_ID, AWKWARD_RAW_EVENT));
    expect(verify?.body.endsWith(`,"webhook_event":${AWKWARD_RAW_EVENT}}`)).toBe(true);

    const row = d1.rows.get("WH-TEST0004-AWKWARD");
    expect(row?.[9]).toBe(AWKWARD_RAW_EVENT);
    expect(new TextEncoder().encode(String(row?.[9]))).toEqual(bytes);
    expect(logs).toEqual([
      "[paypal/webhook] outcome=stored status=200 event_id=WH-TEST0004-AWKWARD event_type=PAYMENT.CAPTURE.COMPLETED resource_type=capture resource_id=CAPTURE-TEST-0004",
    ]);
  });

  it("answers 200 to a redelivery without storing it twice, reusing the cached token", async () => {
    const d1 = fakeD1();
    context.env = secrets({ DB: d1.db });
    const { POST } = await loadRoute();
    const body = rawEvent(payoutsBatchSuccessEvent);
    expect((await POST(webhookRequest({ body }))).status).toBe(200);
    const again = await POST(webhookRequest({ body }));
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ ok: true, outcome: "duplicate" });
    expect(d1.rows.size).toBe(1);
    expect(paypal.tokenCalls()).toHaveLength(1);
    expect(paypal.verifyCalls()).toHaveLength(2);
  });

  it("links a payout's success to the judge session that sent it (real SQLite, real migrations)", async () => {
    const d1 = sqliteD1();
    const ledger = createLedgerStore(createD1LedgerTable(d1.db), { seedHash: async () => "5eed".repeat(16) });
    const senderBatchId = payoutsBatchSuccessEvent.resource.batch_header.sender_batch_header.sender_batch_id;
    await ledger.append("judge-session-1", payoutRequested({ requestId: "R-1", requestHash: senderBatchId }));
    context.env = secrets({ DB: d1.db });
    const { POST } = await loadRoute();
    const body = rawEvent(payoutsBatchSuccessEvent);
    expect((await POST(webhookRequest({ body }))).status).toBe(200);
    expect((await POST(webhookRequest({ body }))).status).toBe(200);
    const confirmed = (await ledger.read("judge-session-1")).filter((e) => e.type === "payout.confirmed");
    expect(confirmed.map((e) => e.payload)).toEqual([
      expect.objectContaining({ requestId: "R-1", payoutBatchId: "BATCHTEST0001", status: "SUCCESS", paypalEventId: payoutsBatchSuccessEvent.id }),
    ]);
    expect(logs[1]).toBe(`[paypal/webhook] link=payout.confirmed outcome=stored session=judge-se event_id=${payoutsBatchSuccessEvent.id}`);
  });

  it("builds a new PayPal client when a secret changes", async () => {
    context.env = secrets({ DB: fakeD1().db });
    const { POST } = await loadRoute();
    await POST(webhookRequest());
    context.env = secrets({ DB: fakeD1().db, PAYPAL_CLIENT_SECRET: "test-rotated-secret-not-real" });
    await POST(webhookRequest());
    expect(paypal.tokenCalls()).toHaveLength(2);
  });

  it("answers 503 without a Cloudflare context, and calls nothing", async () => {
    const { POST } = await loadRoute();
    const response = await POST(webhookRequest());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: "misconfigured", message: expect.any(String) } });
    expect(paypal.calls).toHaveLength(0);
    expect(logs).toEqual([
      "[paypal/webhook] outcome=misconfigured status=503 detail=PAYPAL_CLIENT_ID:unset,PAYPAL_CLIENT_SECRET:unset,PAYPAL_WEBHOOK_ID:unset,DB:unbound",
    ]);
  });

  it("answers 503 when the DB binding is missing", async () => {
    context.env = secrets();
    const { POST } = await loadRoute();
    expect((await POST(webhookRequest())).status).toBe(503);
    expect(paypal.calls).toHaveLength(0);
    expect(logs[0]).toContain("detail=DB:unbound");
  });

  it("answers 503 when PAYPAL_WEBHOOK_ID is unset, before calling PayPal", async () => {
    context.env = secrets({ DB: fakeD1().db, PAYPAL_WEBHOOK_ID: undefined });
    const { POST } = await loadRoute();
    expect((await POST(webhookRequest())).status).toBe(503);
    expect(paypal.calls).toHaveLength(0);
    expect(logs[0]).toContain("detail=PAYPAL_WEBHOOK_ID:unset");
  });

  it("refuses a live PayPal base URL with 503 and never calls it", async () => {
    context.env = secrets({ DB: fakeD1().db, PAYPAL_API_BASE: "https://api-m.paypal.com" });
    const { POST } = await loadRoute();
    expect((await POST(webhookRequest())).status).toBe(503);
    expect(paypal.calls).toHaveLength(0);
    expect(logs[0]).toContain("detail=PAYPAL_API_BASE:not_sandbox");
  });

  it("answers 400 to a request without PayPal's headers, before calling PayPal", async () => {
    context.env = secrets({ DB: fakeD1().db });
    const { POST } = await loadRoute();
    const response = await POST(webhookRequest({ omit: ["paypal-transmission-sig"] }));
    expect(response.status).toBe(400);
    expect(paypal.calls).toHaveLength(0);
  });

  it("answers 400 and stores nothing when PayPal says FAILURE", async () => {
    install({ verification: "FAILURE" });
    const d1 = fakeD1();
    context.env = secrets({ DB: d1.db });
    const { POST } = await loadRoute();
    const response = await POST(webhookRequest());
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: "verification_failed", message: expect.any(String) } });
    expect(d1.rows.size).toBe(0);
  });

  it("answers 500 when PayPal's token endpoint fails, and 413 for an oversized body", async () => {
    install({ tokenStatus: 503 });
    context.env = secrets({ DB: fakeD1().db });
    const { POST } = await loadRoute();
    expect((await POST(webhookRequest())).status).toBe(500);
    expect(logs[0]).toContain("detail=token_http_503");
    expect((await POST(webhookRequest({ body: `{"id":"${"x".repeat(70_000)}"}` }))).status).toBe(413);
  });
});
