import { describe, expect, it } from "vitest";
import { handleCaptureOrder } from "@/collections/capture-order";
import { API } from "@/ledger/contracts";
import { CAPTURE_ID, harness, json, ORDER_ID, paypalReply, post, sessionCookie, type Harness } from "./helpers";

const captured = (captureStatus = "COMPLETED", value = "30.00", source: Record<string, unknown> = { paypal: {} }) =>
  paypalReply(201, {
    id: ORDER_ID,
    status: "COMPLETED",
    payment_source: source,
    purchase_units: [{ payments: { captures: [{ id: CAPTURE_ID, status: captureStatus, amount: { currency_code: "USD", value } }] } }],
  });
const declined = paypalReply(422, { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "INSTRUMENT_DECLINED" }], debug_id: "dbg-x" });

const captureRequest = (orderId: string, body: unknown, cookie?: string) => post(API.capture(orderId), body, { cookie });

/** A session whose ledger holds `order.created` for ORDER_ID (2 tickets, $30). */
async function withOrder(): Promise<Harness & { cookie: string; sessionId: string }> {
  const h = harness();
  const session = await sessionCookie();
  await h.ledger.append(session.sessionId, {
    type: "order.created",
    payload: { orderId: ORDER_ID, eventId: "banquet", quantity: 2, amountCents: 3_000, currency: "USD" },
    idempotencyKey: `order:${ORDER_ID}`,
  });
  return { ...h, ...session };
}

describe("POST /api/collections/orders/:orderId/capture (handleCaptureOrder)", () => {
  it("captures this session's order, records payment.captured keyed by the capture id, and answers 200 CaptureResult", async () => {
    const h = await withOrder();
    h.paypal.postJson.mockResolvedValueOnce(captured());

    const response = await handleCaptureOrder(captureRequest(ORDER_ID, { method: "paypal" }, h.cookie), ORDER_ID, h.deps);
    expect(await json(response)).toEqual({ status: 200, body: { captureId: CAPTURE_ID, status: "COMPLETED", amountCents: 3_000 } });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(h.paypal.postJson.mock.calls[0]?.[0]).toBe(`/v2/checkout/orders/${ORDER_ID}/capture`);

    const last = h.ledger.events(h.sessionId).at(-1);
    expect(last?.type).toBe("payment.captured");
    expect(last?.payload).toEqual({
      orderId: ORDER_ID,
      captureId: CAPTURE_ID,
      eventId: "banquet",
      amountCents: 3_000,
      currency: "USD",
      status: "COMPLETED",
      method: "paypal",
    });
    expect(h.ledger.append).toHaveBeenLastCalledWith(h.sessionId, expect.objectContaining({ idempotencyKey: CAPTURE_ID }));
    expect(h.logs.at(-1)).toMatch(/outcome=captured status=200 .*order=5O190127TN364715T capture=3C679366HH908993F/);
  });

  it("takes the method from PayPal's payment source when it names one, else from the validated body", async () => {
    const venmo = await withOrder();
    venmo.paypal.postJson.mockResolvedValueOnce(captured("COMPLETED", "30.00", { venmo: {} }));
    await handleCaptureOrder(captureRequest(ORDER_ID, { method: "paypal" }, venmo.cookie), ORDER_ID, venmo.deps);
    expect(venmo.ledger.events(venmo.sessionId).at(-1)?.payload).toMatchObject({ method: "venmo" });

    const unnamed = await withOrder();
    unnamed.paypal.postJson.mockResolvedValueOnce(captured("COMPLETED", "30.00", {}));
    await handleCaptureOrder(captureRequest(ORDER_ID, { method: "venmo" }, unnamed.cookie), ORDER_ID, unnamed.deps);
    expect(unnamed.ledger.events(unnamed.sessionId).at(-1)?.payload).toMatchObject({ method: "venmo" });

    const empty = await withOrder();
    empty.paypal.postJson.mockResolvedValueOnce(captured("COMPLETED", "30.00", {}));
    expect((await handleCaptureOrder(captureRequest(ORDER_ID, "", empty.cookie), ORDER_ID, empty.deps)).status).toBe(200);
    expect(empty.ledger.events(empty.sessionId).at(-1)?.payload).toMatchObject({ method: "paypal" });
  });

  it("is idempotent: a second capture of a recorded order answers from the ledger without calling PayPal", async () => {
    const h = await withOrder();
    h.paypal.postJson.mockResolvedValueOnce(captured());
    const first = await json(await handleCaptureOrder(captureRequest(ORDER_ID, {}, h.cookie), ORDER_ID, h.deps));
    const second = await json(await handleCaptureOrder(captureRequest(ORDER_ID, {}, h.cookie), ORDER_ID, h.deps));
    expect(second).toEqual(first);
    expect(h.paypal.postJson).toHaveBeenCalledTimes(1);
    expect(h.ledger.events(h.sessionId).filter((event) => event.type === "payment.captured")).toHaveLength(1);
  });

  it("records a PENDING capture as PayPal reports it", async () => {
    const h = await withOrder();
    h.paypal.postJson.mockResolvedValueOnce(captured("PENDING"));
    const { status, body } = await json(await handleCaptureOrder(captureRequest(ORDER_ID, {}, h.cookie), ORDER_ID, h.deps));
    expect(status).toBe(200);
    expect(body).toEqual({ captureId: CAPTURE_ID, status: "PENDING", amountCents: 3_000 });
  });

  it("records PayPal's captured amount even if it differs from the order, and logs the mismatch", async () => {
    const h = await withOrder();
    h.paypal.postJson.mockResolvedValueOnce(captured("COMPLETED", "15.00"));
    const { body } = await json(await handleCaptureOrder(captureRequest(ORDER_ID, {}, h.cookie), ORDER_ID, h.deps));
    expect(body).toMatchObject({ amountCents: 1_500 });
    expect(h.logs.join("\n")).toContain("detail=amount_mismatch");
  });

  it("answers 404 unknown_order for another session's order, an unknown order or a malformed id, and never calls PayPal", async () => {
    const h = await withOrder();
    const other = await sessionCookie(9);
    const cases: [string, string][] = [
      [ORDER_ID, other.cookie],
      ["9ZZ99999ZZ999999Z", h.cookie],
      ["..%2F..%2Fv1", h.cookie],
      ["a".repeat(65), h.cookie],
    ];
    for (const [orderId, cookie] of cases) {
      const { status, body } = await json(await handleCaptureOrder(captureRequest(orderId, {}, cookie), orderId, h.deps));
      expect(status).toBe(404);
      expect(body).toMatchObject({ error: { code: "unknown_order" } });
    }
    expect(h.paypal.postJson).not.toHaveBeenCalled();
  });

  it.each([[{ method: "card" }], [{ method: "paypal", amountCents: 1 }], [[]], ["{"]])("answers 400 to the body %j", async (body) => {
    const h = await withOrder();
    expect((await handleCaptureOrder(captureRequest(ORDER_ID, body, h.cookie), ORDER_ID, h.deps)).status).toBe(400);
    expect(h.paypal.postJson).not.toHaveBeenCalled();
  });

  it.each([
    [declined, 422, "payment_declined"],
    [paypalReply(422, { details: [{ issue: "ORDER_NOT_APPROVED" }] }), 409, "not_approved"],
    [paypalReply(422, { details: [{ issue: "ORDER_ALREADY_CAPTURED" }] }), 409, "already_captured"],
    [paypalReply(404, undefined), 404, "unknown_order"],
    [paypalReply(500, undefined), 502, "paypal_unavailable"],
    [paypalReply(400, { details: [{ issue: "INVALID_PARAMETER_VALUE" }] }), 502, "paypal_error"],
    [paypalReply(201, { id: ORDER_ID }), 502, "paypal_error"],
  ] as const)("maps PayPal's %j to %i %s and records nothing", async (reply, status, code) => {
    const h = await withOrder();
    h.paypal.postJson.mockResolvedValueOnce(reply);
    const answer = await json(await handleCaptureOrder(captureRequest(ORDER_ID, {}, h.cookie), ORDER_ID, h.deps));
    expect(answer).toMatchObject({ status, body: { error: { code } } });
    expect(JSON.stringify(answer.body)).not.toContain("dbg-x");
    expect(h.ledger.events(h.sessionId).some((event) => event.type === "payment.captured")).toBe(false);
  });

  it.each(["DECLINED", "FAILED"])("answers 422 payment_declined to a %s capture and records nothing", async (captureStatus) => {
    const h = await withOrder();
    h.paypal.postJson.mockResolvedValueOnce(captured(captureStatus));
    const answer = await json(await handleCaptureOrder(captureRequest(ORDER_ID, {}, h.cookie), ORDER_ID, h.deps));
    expect(answer).toMatchObject({ status: 422, body: { error: { code: "payment_declined" } } });
    expect(h.ledger.events(h.sessionId).some((event) => event.type === "payment.captured")).toBe(false);
  });

  it("answers 500 ledger_error when the capture can't be recorded, saying PayPal took the money", async () => {
    const h = await withOrder();
    h.paypal.postJson.mockResolvedValueOnce(captured());
    h.ledger.failNext("append");
    const { status, body } = await json(await handleCaptureOrder(captureRequest(ORDER_ID, {}, h.cookie), ORDER_ID, h.deps));
    expect(status).toBe(500);
    expect(body).toMatchObject({ error: { code: "ledger_error" } });
    expect(String((body.error as { message: string }).message)).toMatch(/PayPal took the payment/);
    expect(h.logs.at(-1)).toContain(`capture=${CAPTURE_ID}`);
  });

  it("answers 500 when the order lookup fails", async () => {
    const h = await withOrder();
    h.ledger.failNext("findSessionByOrderId");
    expect((await handleCaptureOrder(captureRequest(ORDER_ID, {}, h.cookie), ORDER_ID, h.deps)).status).toBe(500);
  });

  it("shares the create route's checks: 401 without a session, 403 cross-site, 503 unwired", async () => {
    const h = await withOrder();
    expect((await handleCaptureOrder(captureRequest(ORDER_ID, {}), ORDER_ID, h.deps)).status).toBe(401);
    const crossSite = post(API.capture(ORDER_ID), {}, { cookie: h.cookie, origin: "https://evil.example" });
    expect((await handleCaptureOrder(crossSite, ORDER_ID, h.deps)).status).toBe(403);
    h.deps.store = undefined;
    expect((await handleCaptureOrder(captureRequest(ORDER_ID, {}, h.cookie), ORDER_ID, h.deps)).status).toBe(503);
    expect(h.paypal.postJson).not.toHaveBeenCalled();
  });
});
