import { describe, expect, it } from "vitest";
import { createPaypalClient } from "@/payments/paypal/client";
import { BALANCE_CACHE_MS, createSharedBalanceReader, decimalToCents, FAILURE_CACHE_MS, parseBalances } from "@/payments/paypal/balances";
import { FAKE_CLIENT_ID, FAKE_CLIENT_SECRET, fakePaypal, SANDBOX } from "./fixtures";

const balancesBody = (value = "4998.75", currency = "USD") => ({
  balances: [
    { currency: "EUR", primary: false, available_balance: { currency_code: "EUR", value: "1.00" } },
    { currency, primary: true, total_balance: { currency_code: currency, value }, available_balance: { currency_code: currency, value } },
  ],
  account_id: "ACCOUNTTEST01",
  as_of_time: "2026-11-05T13:59:59Z",
  last_refresh_time: "2026-11-05T13:59:59Z",
});

function setup(respond: () => Response) {
  let now = 1_000_000;
  const paypal = fakePaypal({ handle: (call) => (call.url.startsWith(`${SANDBOX}/v1/reporting/balances`) ? respond() : undefined) });
  const client = createPaypalClient({ clientId: FAKE_CLIENT_ID, clientSecret: FAKE_CLIENT_SECRET, fetch: paypal.fetch, now: () => now });
  const reader = createSharedBalanceReader(client, () => now);
  const balanceCalls = () => paypal.calls.filter((c) => c.url.includes("/v1/reporting/balances")).length;
  return { reader, paypal, balanceCalls, advance: (ms: number) => (now += ms) };
}

describe("decimalToCents", () => {
  it("reads PayPal's decimal strings exactly, without floats", () => {
    expect(decimalToCents("4998.75")).toBe(499_875);
    expect(decimalToCents("0.1")).toBe(10);
    expect(decimalToCents("12")).toBe(1200);
    expect(decimalToCents("-3.21")).toBe(-321);
    expect(decimalToCents("1.234")).toBeNull();
    expect(decimalToCents("1e3")).toBeNull();
  });
});

describe("parseBalances", () => {
  it("picks the USD available balance and PayPal's as-of time", () => {
    expect(parseBalances(balancesBody())).toEqual({ availableCents: 499_875, currency: "USD", asOf: "2026-11-05T13:59:59Z" });
  });

  it("is null without a readable USD balance or as-of time", () => {
    expect(parseBalances(balancesBody("4998.75", "CAD"))).toBeNull();
    expect(parseBalances(balancesBody("lots"))).toBeNull();
    expect(parseBalances({ ...balancesBody(), as_of_time: undefined })).toBeNull();
    expect(parseBalances(undefined)).toBeNull();
  });
});

describe("createSharedBalanceReader", () => {
  it("GETs the USD balances and caches them for 10 minutes", async () => {
    const { reader, paypal, balanceCalls, advance } = setup(() => Response.json(balancesBody()));
    expect(await reader()).toEqual({ availableCents: 499_875, currency: "USD", asOf: "2026-11-05T13:59:59Z" });
    expect(paypal.calls.at(-1)?.url).toBe(`${SANDBOX}/v1/reporting/balances?currency_code=USD`);
    advance(BALANCE_CACHE_MS - 1);
    await reader();
    expect(balanceCalls()).toBe(1);
    advance(1);
    await reader();
    expect(balanceCalls()).toBe(2);
  });

  it("shares one request between concurrent readers", async () => {
    const { reader, balanceCalls } = setup(() => Response.json(balancesBody()));
    await Promise.all([reader(), reader(), reader()]);
    expect(balanceCalls()).toBe(1);
  });

  it("shows nothing (null) rather than a wrong number when PayPal fails, and retries after a minute", async () => {
    const { reader, balanceCalls, advance } = setup(() => Response.json({ name: "INTERNAL_SERVER_ERROR" }, { status: 500 }));
    expect(await reader()).toBeNull();
    advance(FAILURE_CACHE_MS - 1);
    expect(await reader()).toBeNull();
    expect(balanceCalls()).toBe(1);
    advance(1);
    await reader();
    expect(balanceCalls()).toBe(2);
  });

  it("is null when PayPal can't be reached at all", async () => {
    const paypal = fakePaypal({ networkError: true });
    const client = createPaypalClient({ clientId: FAKE_CLIENT_ID, clientSecret: FAKE_CLIENT_SECRET, fetch: paypal.fetch });
    expect(await createSharedBalanceReader(client)()).toBeNull();
  });
});
