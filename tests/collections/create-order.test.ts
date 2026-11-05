import { describe, expect, it } from "vitest";
import { handleCreateOrder, orderReference } from "@/collections/create-order";
import { API } from "@/ledger/contracts";
import {
  FAKE_CLIENT_SECRET,
  harness,
  json,
  ORDER_ID,
  paypalReply,
  post,
  SECRET,
  sessionCookie,
  type Harness,
} from "./helpers";

const created = paypalReply(201, { id: ORDER_ID, status: "CREATED" });
const createRequest = (body: unknown, init: Parameters<typeof post>[2] = {}) => post(API.orders, body, init);

async function ready(): Promise<Harness & { cookie: string; sessionId: string }> {
  const h = harness();
  return { ...h, ...(await sessionCookie()) };
}

describe("POST /api/collections/orders (handleCreateOrder)", () => {
  it("prices the order on the server, creates it at PayPal, records order.created and answers 201 { orderId }", async () => {
    const h = await ready();
    h.paypal.postJson.mockResolvedValueOnce(created);

    const response = await handleCreateOrder(createRequest({ eventId: "banquet", quantity: 3 }, { cookie: h.cookie }), h.deps);
    expect(await json(response)).toEqual({ status: 201, body: { orderId: ORDER_ID } });
    expect(response.headers.get("cache-control")).toBe("no-store");

    const [path, body, , headers] = h.paypal.postJson.mock.calls[0]!;
    expect(path).toBe("/v2/checkout/orders");
    const unit = JSON.parse(body).purchase_units[0];
    expect(unit.amount.value).toBe("45.00");
    expect(unit.description).toBe("End-of-season banquet × 3");
    expect(unit.custom_id).toBe(await orderReference(h.sessionId));
    expect(headers).toEqual({ "PayPal-Request-Id": "test-id-1" });

    const events = h.ledger.events(h.sessionId);
    expect(events.map((event) => event.type)).toEqual(["session.opened", "order.created"]);
    expect(events[1]?.payload).toEqual({ orderId: ORDER_ID, eventId: "banquet", quantity: 3, amountCents: 4_500, currency: "USD" });
    expect(h.ledger.append).toHaveBeenCalledWith(h.sessionId, expect.objectContaining({ idempotencyKey: `order:${ORDER_ID}` }));
    expect(h.logs.at(-1)).toMatch(/^\[collections\/orders\] outcome=created status=201 session=\S{8} order=5O190127TN364715T/);
  });

  it("opens the session's ledger before it creates anything at PayPal", async () => {
    const h = await ready();
    h.paypal.postJson.mockResolvedValueOnce(created);
    await handleCreateOrder(createRequest({ eventId: "banquet", quantity: 1 }, { cookie: h.cookie }), h.deps);
    const readOrder = (h.ledger.read as unknown as { mock: { invocationCallOrder: number[] } }).mock.invocationCallOrder[0]!;
    expect(readOrder).toBeLessThan(h.paypal.postJson.mock.invocationCallOrder[0]!);
  });

  it("uses a one-way, non-secret order reference that differs per session", async () => {
    const a = await orderReference("AAAAAAAAAAAAAAAAAAAAAA");
    expect(a).toMatch(/^twokey-banquet-[0-9a-f]{16}$/);
    expect(a).not.toContain("AAAA");
    expect(await orderReference("AAAAAAAAAAAAAAAAAAAAAA")).toBe(a);
    expect(await orderReference("BBBBBBBBBBBBBBBBBBBBBB")).not.toBe(a);
  });

  it.each([
    [{ eventId: "banquet", quantity: 0 }],
    [{ eventId: "banquet", quantity: 5 }],
    [{ eventId: "banquet", quantity: 1.5 }],
    [{ eventId: "banquet", quantity: "2" }],
    [{ eventId: "car-wash", quantity: 1 }],
    [{ eventId: "banquet" }],
    [{ eventId: "banquet", quantity: 1, amountCents: 1 }],
    [[]],
    ["not json"],
    [""],
  ])("answers 400 to %j and calls nobody", async (body) => {
    const h = await ready();
    const { status, body: answer } = await json(await handleCreateOrder(createRequest(body, { cookie: h.cookie }), h.deps));
    expect(status).toBe(400);
    expect(answer).toMatchObject({ error: { code: "bad_request" } });
    expect(h.paypal.postJson).not.toHaveBeenCalled();
    expect(h.ledger.append).not.toHaveBeenCalled();
  });

  it("answers 400 to a body over 8 KB", async () => {
    const h = await ready();
    const big = JSON.stringify({ eventId: "banquet", quantity: 1, pad: "x".repeat(8 * 1024) });
    expect((await handleCreateOrder(createRequest(big, { cookie: h.cookie }), h.deps)).status).toBe(400);
    expect(h.paypal.postJson).not.toHaveBeenCalled();
  });

  it("answers 401 no_session without a valid judge-session cookie", async () => {
    const h = await ready();
    for (const cookie of [undefined, "__Host-twokey_session=v1.forged.1.sig"]) {
      const { status, body } = await json(await handleCreateOrder(createRequest({ eventId: "banquet", quantity: 1 }, { cookie }), h.deps));
      expect(status).toBe(401);
      expect(body).toMatchObject({ error: { code: "no_session" } });
    }
    expect(h.paypal.postJson).not.toHaveBeenCalled();
  });

  it("answers 403 to another site, before reading the session or the body", async () => {
    const h = await ready();
    const cases = [
      { origin: "https://evil.example" },
      { origin: "" },
      { headers: { "sec-fetch-site": "cross-site" } },
    ];
    for (const init of cases) {
      const response = await handleCreateOrder(createRequest({ eventId: "banquet", quantity: 1 }, { cookie: h.cookie, ...init }), h.deps);
      expect(await json(response)).toMatchObject({ status: 403, body: { error: { code: "forbidden" } } });
    }
    expect(h.ledger.read).not.toHaveBeenCalled();
  });

  it("admits a loopback origin in development only", async () => {
    const local = { origin: "http://localhost:3003" };
    const prod = await ready();
    prod.paypal.postJson.mockResolvedValue(created);
    expect((await handleCreateOrder(createRequest({ eventId: "banquet", quantity: 1 }, { cookie: prod.cookie, ...local }), prod.deps)).status).toBe(403);
    const dev = harness({ development: true });
    dev.paypal.postJson.mockResolvedValue(created);
    dev.deps.env = { ...dev.deps.env, TWOKEY_SITE_ORIGIN: undefined };
    const { cookie } = await sessionCookie();
    expect((await handleCreateOrder(createRequest({ eventId: "banquet", quantity: 1 }, { cookie, ...local }), dev.deps)).status).toBe(201);
  });

  it.each([
    ["TWOKEY_SESSION_SECRET", { TWOKEY_SESSION_SECRET: undefined }],
    ["a short session secret", { TWOKEY_SESSION_SECRET: "short" }],
    ["TWOKEY_SITE_ORIGIN", { TWOKEY_SITE_ORIGIN: undefined }],
    ["PAYPAL_CLIENT_ID", { PAYPAL_CLIENT_ID: undefined }],
    ["PAYPAL_CLIENT_SECRET", { PAYPAL_CLIENT_SECRET: " " }],
    ["a live PayPal API base", { PAYPAL_API_BASE: "https://api-m.paypal.com" }],
  ])("answers 503 misconfigured without %s, naming no value", async (_label, overrides) => {
    const h = await ready();
    h.deps.env = { ...h.deps.env, ...overrides };
    const { status, body } = await json(await handleCreateOrder(createRequest({ eventId: "banquet", quantity: 1 }, { cookie: h.cookie }), h.deps));
    expect(status).toBe(503);
    expect(body).toMatchObject({ error: { code: "misconfigured" } });
    const logged = h.logs.join("\n");
    expect(logged).not.toContain(SECRET);
    expect(logged).not.toContain(FAKE_CLIENT_SECRET);
  });

  it("answers 503 misconfigured while the ledger store isn't wired", async () => {
    const h = await ready();
    h.deps.store = undefined;
    const response = await handleCreateOrder(createRequest({ eventId: "banquet", quantity: 1 }, { cookie: h.cookie }), h.deps);
    expect(await json(response)).toMatchObject({ status: 503, body: { error: { code: "misconfigured" } } });
    expect(h.paypal.postJson).not.toHaveBeenCalled();
  });

  it("answers 502 in plain words when PayPal doesn't answer, and records nothing", async () => {
    const h = await ready();
    h.paypal.postJson.mockResolvedValueOnce(paypalReply(503, { name: "SERVICE_UNAVAILABLE", debug_id: "dbg-secretish" }));
    const { status, body } = await json(await handleCreateOrder(createRequest({ eventId: "banquet", quantity: 2 }, { cookie: h.cookie }), h.deps));
    expect(status).toBe(502);
    expect(body).toMatchObject({ error: { code: "paypal_unavailable" } });
    expect(JSON.stringify(body)).not.toContain("dbg-secretish");
    expect(h.ledger.events(h.sessionId).map((event) => event.type)).toEqual(["session.opened"]);
  });

  it("answers 500 when the ledger can't be read or written, without leaking the error", async () => {
    for (const method of ["read", "append"] as const) {
      const h = await ready();
      h.paypal.postJson.mockResolvedValue(created);
      h.ledger.failNext(method);
      const { status, body } = await json(await handleCreateOrder(createRequest({ eventId: "banquet", quantity: 1 }, { cookie: h.cookie }), h.deps));
      expect(status).toBe(500);
      expect(body).toMatchObject({ error: { code: "ledger_error" } });
      expect(JSON.stringify(body)).not.toContain("fake ledger");
    }
  });
});
