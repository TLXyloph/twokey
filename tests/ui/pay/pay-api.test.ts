import { describe, expect, it, vi } from "vitest";
import { createPayApi, PayApiError } from "@/ui/pay/pay-api";

const ORDER_ID = "5O190127TN364715T";
const reply = (status: number, body: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const noSession = () => reply(401, { error: { code: "no_session", message: "Your demo session has ended." } });

function fakeFetch(...responses: Response[]) {
  const fetchFn = vi.fn<(input: string, init: RequestInit) => Promise<Response>>();
  for (const response of responses) fetchFn.mockResolvedValueOnce(response);
  return fetchFn;
}

describe("createPayApi", () => {
  it("creates an order with the event and quantity only, and returns PayPal's order id", async () => {
    const fetchFn = fakeFetch(reply(201, { orderId: ORDER_ID }));
    await expect(createPayApi(fetchFn).createOrder("banquet", 3)).resolves.toEqual({ orderId: ORDER_ID });
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("/api/collections/orders");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    expect(JSON.parse(String(init.body))).toEqual({ eventId: "banquet", quantity: 3 });
  });

  it("captures with the wallet the buyer used and returns the CaptureResult", async () => {
    const result = { captureId: "3C679366HH908993F", status: "COMPLETED", amountCents: 4_500 };
    const fetchFn = fakeFetch(reply(200, result));
    await expect(createPayApi(fetchFn).captureOrder(ORDER_ID, "venmo")).resolves.toEqual(result);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe(`/api/collections/orders/${ORDER_ID}/capture`);
    expect(JSON.parse(String(init.body))).toEqual({ method: "venmo" });
  });

  it("on 401 no_session, asks for a demo session and retries once", async () => {
    const fetchFn = fakeFetch(noSession(), reply(200, { ok: true, session: "issued" }), reply(201, { orderId: ORDER_ID }));
    await expect(createPayApi(fetchFn).createOrder("banquet", 1)).resolves.toEqual({ orderId: ORDER_ID });
    expect(fetchFn.mock.calls.map(([url]) => url)).toEqual(["/api/collections/orders", "/api/ai/session", "/api/collections/orders"]);
    expect(fetchFn.mock.calls[1]?.[1].method).toBe("POST");
  });

  it("retries only once: a second 401 is shown in plain words", async () => {
    const fetchFn = fakeFetch(noSession(), reply(200, { ok: true }), noSession());
    const error = await createPayApi(fetchFn).createOrder("banquet", 1).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PayApiError);
    expect(error).toMatchObject({ code: "no_session", status: 401 });
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("does not retry when the session can't be issued", async () => {
    const fetchFn = fakeFetch(noSession(), reply(429, { error: { code: "rate_limited", message: "Too many new demo sessions." } }));
    await expect(createPayApi(fetchFn).createOrder("banquet", 1)).rejects.toMatchObject({ code: "no_session" });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("passes the server's plain message through, and falls back to its own words for anything unreadable", async () => {
    const declined = fakeFetch(reply(422, { error: { code: "payment_declined", message: "PayPal declined that payment." } }));
    await expect(createPayApi(declined).captureOrder(ORDER_ID, "paypal")).rejects.toMatchObject({
      code: "payment_declined",
      message: "PayPal declined that payment.",
    });
    const html = vi.fn(async () => new Response("<html>Bad gateway</html>", { status: 502 }));
    const error = await createPayApi(html).createOrder("banquet", 1).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "unreadable", status: 502 });
    expect((error as Error).message).not.toContain("<html>");
  });

  it("turns a network failure into a plain message", async () => {
    const offline = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(createPayApi(offline).createOrder("banquet", 1)).rejects.toMatchObject({ code: "network", status: 0 });
  });

  it("refuses a 2xx without the expected fields", async () => {
    await expect(createPayApi(fakeFetch(reply(201, { id: ORDER_ID }))).createOrder("banquet", 1)).rejects.toMatchObject({ code: "unreadable" });
    await expect(createPayApi(fakeFetch(reply(200, { captureId: "x" }))).captureOrder(ORDER_ID, "paypal")).rejects.toMatchObject({
      code: "unreadable",
    });
  });
});
