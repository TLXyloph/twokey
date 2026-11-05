import { describe, expect, it, vi } from "vitest";
import { PaypalApiError, type PaypalJsonResponse } from "@/payments/paypal/client";
import {
  capturePaypalOrder,
  createPaypalOrder,
  PaypalOrderError,
  type CreatePaypalOrderInput,
  type OrdersClient,
} from "@/payments/paypal/orders";

// Fictional ids, shaped like PayPal's sandbox ids.
const ORDER_ID = "5O190127TN364715T";
const CAPTURE_ID = "3C679366HH908993F";
const SECRET_LOOKING = "debug-id-and-token-must-not-leak";

const fakeClient = (...responses: (PaypalJsonResponse | Error)[]) => {
  const postJson = vi.fn<OrdersClient["postJson"]>();
  for (const response of responses) {
    if (response instanceof Error) postJson.mockRejectedValueOnce(response);
    else postJson.mockResolvedValueOnce(response);
  }
  return { postJson };
};

const input: CreatePaypalOrderInput = {
  amountCents: 3_000,
  unitAmountCents: 1_500,
  quantity: 2,
  currency: "USD",
  description: "End-of-season banquet × 2",
  itemName: "Banquet ticket",
  referenceId: "banquet",
  customId: "twokey-banquet-0123456789abcdef",
  requestId: "req-create-0001",
};

const captureBody = (overrides: Record<string, unknown> = {}, capture: Record<string, unknown> = {}) => ({
  id: ORDER_ID,
  status: "COMPLETED",
  payment_source: { paypal: { email_address: "buyer-fictional@example.test", account_id: "BUYERTEST01" } },
  purchase_units: [
    {
      reference_id: "banquet",
      payments: {
        captures: [
          {
            id: CAPTURE_ID,
            status: "COMPLETED",
            amount: { currency_code: "USD", value: "30.00" },
            final_capture: true,
            ...capture,
          },
        ],
      },
    },
  ],
  links: [],
  ...overrides,
});

const paypalError = (status: number, issue: string) => ({
  status,
  body: { name: "UNPROCESSABLE_ENTITY", details: [{ issue, description: SECRET_LOOKING }], debug_id: SECRET_LOOKING },
});

describe("createPaypalOrder", () => {
  it("POSTs one CAPTURE purchase unit priced by the server, with items, custom_id and a request id", async () => {
    const client = fakeClient({ status: 201, body: { id: ORDER_ID, status: "CREATED", links: [] } });
    await expect(createPaypalOrder(client, input)).resolves.toEqual({ orderId: ORDER_ID, status: "CREATED" });

    expect(client.postJson).toHaveBeenCalledTimes(1);
    const [path, body, operation, headers] = client.postJson.mock.calls[0]!;
    expect(path).toBe("/v2/checkout/orders");
    expect(operation).toBe("create order");
    expect(headers).toEqual({ "PayPal-Request-Id": "req-create-0001" });
    expect(JSON.parse(body)).toEqual({
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: "banquet",
          custom_id: "twokey-banquet-0123456789abcdef",
          description: "End-of-season banquet × 2",
          amount: {
            currency_code: "USD",
            value: "30.00",
            breakdown: { item_total: { currency_code: "USD", value: "30.00" } },
          },
          items: [{ name: "Banquet ticket", quantity: "2", unit_amount: { currency_code: "USD", value: "15.00" } }],
        },
      ],
    });
  });

  it("accepts PayPal's 200 for a replayed request id", async () => {
    const client = fakeClient({ status: 200, body: { id: ORDER_ID, status: "CREATED" } });
    await expect(createPaypalOrder(client, input)).resolves.toEqual({ orderId: ORDER_ID, status: "CREATED" });
  });

  it("refuses an inconsistent order before calling PayPal", async () => {
    const client = fakeClient();
    await expect(createPaypalOrder(client, { ...input, amountCents: 2_999 })).rejects.toThrow(RangeError);
    await expect(createPaypalOrder(client, { ...input, customId: "x".repeat(128) })).rejects.toThrow(RangeError);
    await expect(createPaypalOrder(client, { ...input, description: "x".repeat(128) })).rejects.toThrow(RangeError);
    expect(client.postJson).not.toHaveBeenCalled();
  });

  it.each([
    [{ status: 400, body: { name: "INVALID_REQUEST", details: [{ issue: "INVALID_PARAMETER_VALUE" }] } }, "rejected", 400],
    [{ status: 401, body: undefined }, "unavailable", 401],
    [{ status: 429, body: undefined }, "unavailable", 429],
    [{ status: 500, body: { name: "INTERNAL_SERVER_ERROR" } }, "unavailable", 500],
    [{ status: 201, body: { status: "CREATED" } }, "unexpected", 201],
    [{ status: 201, body: undefined }, "unexpected", 201],
  ] as const)("turns %j into a plain %s error", async (response, kind, status) => {
    const error = await createPaypalOrder(fakeClient(response), input).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PaypalOrderError);
    expect(error).toMatchObject({ kind, status, operation: "create order" });
    expect(String((error as Error).message)).not.toContain(SECRET_LOOKING);
  });

  it("turns a network failure or a refused token into an 'unavailable' error", async () => {
    for (const thrown of [new PaypalApiError("token", 0, "no response"), new PaypalApiError("create order", 0, "timeout")]) {
      const error = await createPaypalOrder(fakeClient(thrown), input).catch((caught: unknown) => caught);
      expect(error).toMatchObject({ kind: "unavailable", status: 0 });
    }
  });
});

describe("capturePaypalOrder", () => {
  it("POSTs an empty JSON body to the order's capture path with a request id derived from the order", async () => {
    const client = fakeClient({ status: 201, body: captureBody() });
    const result = await capturePaypalOrder(client, ORDER_ID);
    expect(result).toEqual({
      orderId: ORDER_ID,
      orderStatus: "COMPLETED",
      captureId: CAPTURE_ID,
      captureStatus: "COMPLETED",
      amountCents: 3_000,
      currency: "USD",
      fundingSource: "paypal",
    });
    const [path, body, operation, headers] = client.postJson.mock.calls[0]!;
    expect(path).toBe(`/v2/checkout/orders/${ORDER_ID}/capture`);
    expect(body).toBe("{}");
    expect(operation).toBe("capture order");
    expect(headers).toEqual({ "PayPal-Request-Id": `twokey-capture-${ORDER_ID}` });
  });

  it("reads the funding source PayPal reports: Venmo, PayPal, or neither", async () => {
    const venmo = await capturePaypalOrder(
      fakeClient({ status: 201, body: captureBody({ payment_source: { venmo: { user_name: "fictional" } } }) }),
      ORDER_ID,
    );
    expect(venmo.fundingSource).toBe("venmo");
    const none = await capturePaypalOrder(fakeClient({ status: 201, body: captureBody({ payment_source: undefined }) }), ORDER_ID);
    expect(none.fundingSource).toBeNull();
  });

  it("returns a PENDING capture as it is (the caller decides what it means)", async () => {
    const client = fakeClient({ status: 201, body: captureBody({ status: "COMPLETED" }, { status: "PENDING" }) });
    await expect(capturePaypalOrder(client, ORDER_ID)).resolves.toMatchObject({ captureStatus: "PENDING" });
  });

  it("refuses an order id that isn't a plain PayPal id, without calling PayPal", async () => {
    const client = fakeClient();
    for (const bad of ["", "../v1/payments", "ABC/DEF", "5O190127TN364715T?x=1", "a".repeat(65)]) {
      await expect(capturePaypalOrder(client, bad)).rejects.toMatchObject({ kind: "rejected" });
    }
    expect(client.postJson).not.toHaveBeenCalled();
  });

  it.each([
    [paypalError(422, "INSTRUMENT_DECLINED"), "declined"],
    [paypalError(422, "ORDER_ALREADY_CAPTURED"), "already_captured"],
    [paypalError(422, "ORDER_NOT_APPROVED"), "not_approved"],
    [paypalError(422, "PAYER_ACTION_REQUIRED"), "not_approved"],
    [paypalError(404, "INVALID_RESOURCE_ID"), "not_found"],
    [{ status: 404, body: undefined }, "not_found"],
    [paypalError(422, "SOMETHING_NEW"), "rejected"],
    [{ status: 503, body: undefined }, "unavailable"],
  ] as const)("maps PayPal's %j to %s, in plain words", async (response, kind) => {
    const error = await capturePaypalOrder(fakeClient(response), ORDER_ID).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PaypalOrderError);
    expect(error).toMatchObject({ kind, operation: "capture order" });
    const message = (error as Error).message;
    expect(message).not.toContain(SECRET_LOOKING);
    expect(message).not.toMatch(/[{}]/);
  });

  it.each([
    ["no captures", captureBody({ purchase_units: [{ payments: { captures: [] } }] })],
    ["no purchase units", captureBody({ purchase_units: [] })],
    ["a non-USD capture", captureBody({}, { amount: { currency_code: "EUR", value: "30.00" } })],
    ["a malformed amount", captureBody({}, { amount: { currency_code: "USD", value: "30.001" } })],
    ["no capture id", captureBody({}, { id: "" })],
  ])("refuses a 2xx with %s as unexpected", async (_label, body) => {
    await expect(capturePaypalOrder(fakeClient({ status: 201, body }), ORDER_ID)).rejects.toMatchObject({ kind: "unexpected" });
  });
});
