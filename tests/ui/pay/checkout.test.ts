import { describe, expect, it, vi } from "vitest";
import { createCheckout, type CheckoutStatus } from "@/ui/pay/checkout";
import { PayApiError, type PayApi } from "@/ui/pay/pay-api";
import { PAYPAL_SDK_URL, setUpWallets, type PaymentSession, type PaypalNamespace, type SessionOptions } from "@/ui/pay/paypal-sdk";

const ORDER_ID = "5O190127TN364715T";
const RESULT = { captureId: "3C679366HH908993F", status: "COMPLETED", amountCents: 3_000 };

function fakeApi(overrides: Partial<PayApi> = {}): PayApi & { createOrder: ReturnType<typeof vi.fn>; captureOrder: ReturnType<typeof vi.fn> } {
  return {
    createOrder: vi.fn(async () => ({ orderId: ORDER_ID })),
    captureOrder: vi.fn(async () => RESULT),
    ...overrides,
  } as never;
}

/** A session that records what start() was given, and lets the test play PayPal's part. */
function fakeSession() {
  const started: { options: unknown; order: Promise<{ orderId: string }> }[] = [];
  const session: PaymentSession & { started: typeof started } = {
    started,
    start: vi.fn(async (options: unknown, order: Promise<{ orderId: string }>) => {
      started.push({ options, order });
      await order;
    }),
  };
  return session;
}

function harness(api = fakeApi(), quantity = 2) {
  const statuses: CheckoutStatus[] = [];
  const checkout = createCheckout({ api, eventId: "banquet", quantity: () => quantity, onStatus: (status) => statuses.push(status) });
  return { api, checkout, statuses };
}

describe("createCheckout", () => {
  it("on a click, starts PayPal at once (inside the click) with the server's order for the current quantity", async () => {
    const { api, checkout, statuses } = harness();
    const session = fakeSession();
    checkout.pay("paypal", session);
    expect(session.start).toHaveBeenCalledTimes(1);
    expect(session.started[0]?.options).toEqual({ presentationMode: "auto" });
    await expect(session.started[0]?.order).resolves.toEqual({ orderId: ORDER_ID });
    expect(api.createOrder).toHaveBeenCalledWith("banquet", 2);
    expect(statuses[0]).toEqual({ kind: "opening", method: "paypal" });
  });

  it("captures on approval with the session's wallet, then reports the paid ticket", async () => {
    const { api, checkout, statuses } = harness();
    checkout.pay("venmo", fakeSession());
    await checkout.sessionOptions("venmo").onApprove({ orderId: ORDER_ID });
    expect(api.captureOrder).toHaveBeenCalledWith(ORDER_ID, "venmo");
    expect(statuses.slice(-2)).toEqual([
      { kind: "capturing", method: "venmo" },
      { kind: "paid", method: "venmo", quantity: 2, result: RESULT },
    ]);
  });

  it("says plainly that nothing was charged when the buyer closes PayPal", () => {
    const { checkout, statuses } = harness();
    checkout.sessionOptions("paypal").onCancel?.({ orderId: ORDER_ID });
    expect(statuses.at(-1)).toEqual({ kind: "cancelled" });
  });

  it("shows the server's words when the order couldn't be created", async () => {
    const api = fakeApi({ createOrder: vi.fn(async () => Promise.reject(new PayApiError("paypal_unavailable", 502, "PayPal didn't answer."))) });
    const { checkout, statuses } = harness(api);
    const session = fakeSession();
    checkout.pay("paypal", session);
    await vi.waitFor(() => expect(statuses.at(-1)).toEqual({ kind: "failed", message: "PayPal didn't answer." }));
    checkout.sessionOptions("paypal").onError?.({ code: "ERR", message: "internal detail" });
    expect(statuses.at(-1)).toEqual({ kind: "failed", message: "PayPal didn't answer." });
  });

  it("shows its own words for a PayPal error, never PayPal's internals", () => {
    const { checkout, statuses } = harness();
    checkout.sessionOptions("paypal").onError?.({ code: "INTERNAL", message: "stack trace and debug id" });
    const last = statuses.at(-1);
    expect(last?.kind).toBe("failed");
    expect(JSON.stringify(last)).not.toContain("debug id");
  });

  it("shows the capture's refusal in the server's words", async () => {
    const api = fakeApi({ captureOrder: vi.fn(async () => Promise.reject(new PayApiError("payment_declined", 422, "PayPal declined that payment."))) });
    const { checkout, statuses } = harness(api);
    await checkout.sessionOptions("paypal").onApprove({ orderId: ORDER_ID });
    expect(statuses.at(-1)).toEqual({ kind: "failed", message: "PayPal declined that payment." });
  });
});

describe("setUpWallets", () => {
  function fakePaypal(eligible: Record<string, boolean>, opts: { venmoComponentFails?: boolean } = {}) {
    const sessions: Record<string, SessionOptions[]> = { paypal: [], venmo: [] };
    const createInstance = vi.fn(async (options: { components: string[] }) => {
      if (opts.venmoComponentFails && options.components.includes("venmo-payments")) throw new Error("component failed");
      return {
        findEligibleMethods: vi.fn(async () => ({ isEligible: (method: string) => eligible[method] ?? false })),
        createPayPalOneTimePaymentSession: vi.fn((o: SessionOptions) => (sessions.paypal!.push(o), fakeSession())),
        createVenmoOneTimePaymentSession: vi.fn((o: SessionOptions) => (sessions.venmo!.push(o), fakeSession())),
      };
    });
    return { paypal: { createInstance } as unknown as PaypalNamespace, createInstance };
  }

  it("loads v6 from PayPal's sandbox only", () => {
    expect(PAYPAL_SDK_URL).toBe("https://www.sandbox.paypal.com/web-sdk/v6/core");
  });

  it("asks for PayPal and Venmo with a US test buyer, and offers what PayPal says is eligible", async () => {
    const { paypal, createInstance } = fakePaypal({ paypal: true, venmo: true });
    const wallets = await setUpWallets(paypal, "public-client-id");
    expect(createInstance).toHaveBeenCalledWith({
      clientId: "public-client-id",
      components: ["paypal-payments", "venmo-payments"],
      pageType: "checkout",
      testBuyerCountry: "US",
    });
    expect(wallets.methods).toEqual(["paypal", "venmo"]);
  });

  it("leaves Venmo out when it isn't eligible", async () => {
    const { paypal } = fakePaypal({ paypal: true, venmo: false });
    expect((await setUpWallets(paypal, "id")).methods).toEqual(["paypal"]);
  });

  it("falls back to PayPal alone when the Venmo component can't load", async () => {
    const { paypal, createInstance } = fakePaypal({ paypal: true, venmo: true }, { venmoComponentFails: true });
    expect((await setUpWallets(paypal, "id")).methods).toEqual(["paypal"]);
    expect(createInstance).toHaveBeenLastCalledWith(expect.objectContaining({ components: ["paypal-payments"] }));
  });

  it("creates one session per wallet with that wallet's handlers", async () => {
    const { paypal } = fakePaypal({ paypal: true, venmo: true });
    const wallets = await setUpWallets(paypal, "id");
    const options = (method: "paypal" | "venmo"): SessionOptions => ({ onApprove: vi.fn(async () => undefined), onCancel: () => method });
    expect(wallets.session("paypal", options("paypal"))).toBeDefined();
    expect(wallets.session("venmo", options("venmo"))).toBeDefined();
  });
});
