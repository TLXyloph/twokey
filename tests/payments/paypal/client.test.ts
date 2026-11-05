import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPaypalClient,
  PAYPAL_SANDBOX_API_BASE,
  PaypalApiError,
  resolveSandboxApiBase,
  TOKEN_REFRESH_MARGIN_MS,
  type FetchLike,
} from "@/payments/paypal/client";
import { FAKE_CLIENT_ID, FAKE_CLIENT_SECRET, FAKE_TOKEN, fakePaypal, SANDBOX } from "./fixtures";

const client = (fetch: FetchLike, now: () => number = () => 0, apiBase?: string) =>
  createPaypalClient({ clientId: FAKE_CLIENT_ID, clientSecret: FAKE_CLIENT_SECRET, apiBase, fetch, now });

const secretsIn = (text: string) =>
  [FAKE_CLIENT_SECRET, FAKE_TOKEN, btoa(`${FAKE_CLIENT_ID}:${FAKE_CLIENT_SECRET}`)].filter((secret) => text.includes(secret));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolveSandboxApiBase", () => {
  it("defaults to the sandbox when unset or blank", () => {
    expect(PAYPAL_SANDBOX_API_BASE).toBe(SANDBOX);
    expect(resolveSandboxApiBase(undefined)).toBe(SANDBOX);
    expect(resolveSandboxApiBase("")).toBe(SANDBOX);
    expect(resolveSandboxApiBase("   ")).toBe(SANDBOX);
  });

  it("accepts the sandbox with surrounding whitespace or trailing slashes", () => {
    expect(resolveSandboxApiBase("https://api-m.sandbox.paypal.com/")).toBe(SANDBOX);
    expect(resolveSandboxApiBase(" https://api-m.sandbox.paypal.com// ")).toBe(SANDBOX);
  });

  it.each([
    "https://api-m.paypal.com",
    "https://api.paypal.com",
    "http://api-m.sandbox.paypal.com",
    "https://api-m.sandbox.paypal.com.attacker.test",
    "https://api-m.sandbox.paypal.com/v1",
    "https://API-M.SANDBOX.PAYPAL.COM",
    "https://user@api-m.sandbox.paypal.com",
  ])("refuses anything but the sandbox: %s", (base) => {
    expect(resolveSandboxApiBase(base)).toBeUndefined();
  });
});

describe("createPaypalClient", () => {
  it("refuses to build a client for a live or unknown base URL", () => {
    const paypal = fakePaypal();
    expect(() => client(paypal.fetch, undefined, "https://api-m.paypal.com")).toThrow(/sandbox/);
    expect(paypal.calls).toHaveLength(0);
  });

  it("requests a client-credentials token with HTTP Basic auth built by btoa", async () => {
    const paypal = fakePaypal();
    expect(await client(paypal.fetch).getAccessToken()).toBe(FAKE_TOKEN);
    const [call] = paypal.tokenCalls();
    expect(call?.method).toBe("POST");
    expect(call?.headers.get("authorization")).toBe(`Basic ${btoa(`${FAKE_CLIENT_ID}:${FAKE_CLIENT_SECRET}`)}`);
    expect(call?.headers.get("content-type")).toBe("application/x-www-form-urlencoded");
    expect(call?.body).toBe("grant_type=client_credentials");
  });

  it("caches the token until 60 s before it expires, then refreshes", async () => {
    let now = 1_000_000;
    const paypal = fakePaypal({ expiresIn: 3600 });
    const paypalClient = client(paypal.fetch, () => now);
    await paypalClient.getAccessToken();
    expect(TOKEN_REFRESH_MARGIN_MS).toBe(60_000);
    now += 3600_000 - 60_000 - 1;
    await paypalClient.getAccessToken();
    expect(paypal.tokenCalls()).toHaveLength(1);
    now += 1;
    await paypalClient.getAccessToken();
    expect(paypal.tokenCalls()).toHaveLength(2);
  });

  it("shares one token request between concurrent callers", async () => {
    const paypal = fakePaypal();
    const paypalClient = client(paypal.fetch);
    const tokens = await Promise.all([paypalClient.getAccessToken(), paypalClient.getAccessToken(), paypalClient.getAccessToken()]);
    expect(tokens).toEqual([FAKE_TOKEN, FAKE_TOKEN, FAKE_TOKEN]);
    expect(paypal.tokenCalls()).toHaveLength(1);
  });

  it("retries the token after a failed request instead of caching the failure", async () => {
    const failing = fakePaypal({ tokenStatus: 401 });
    let fetch: FetchLike = failing.fetch;
    const paypalClient = client((input, init) => fetch(input, init));
    await expect(paypalClient.getAccessToken()).rejects.toBeInstanceOf(PaypalApiError);
    const working = fakePaypal();
    fetch = working.fetch;
    expect(await paypalClient.getAccessToken()).toBe(FAKE_TOKEN);
  });

  it("reports a token failure by operation and HTTP status, never with a secret", async () => {
    const paypal = fakePaypal({ tokenStatus: 401 });
    const error = await client(paypal.fetch).getAccessToken().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PaypalApiError);
    expect(error).toMatchObject({ operation: "token", status: 401 });
    const text = `${String(error)} ${(error as Error).stack ?? ""} ${JSON.stringify(error)}`;
    expect(secretsIn(text)).toEqual([]);
  });

  it("reports a network failure as status 0", async () => {
    const paypal = fakePaypal({ networkError: true });
    await expect(client(paypal.fetch).getAccessToken()).rejects.toMatchObject({ operation: "token", status: 0 });
  });

  it("rejects a token response without access_token or expires_in", async () => {
    const fetch: FetchLike = async () => Response.json({ token_type: "Bearer" });
    await expect(client(fetch).getAccessToken()).rejects.toMatchObject({ operation: "token", status: 200 });
  });

  it("posts a pre-serialized JSON body unchanged, with the bearer token", async () => {
    const paypal = fakePaypal();
    const body = '{ "a" : 1.10 }';
    const response = await client(paypal.fetch).postJson("/v1/notifications/verify-webhook-signature", body, "verify");
    expect(response).toEqual({ status: 200, body: { verification_status: "SUCCESS" } });
    const [call] = paypal.verifyCalls();
    expect(call?.body).toBe(body);
    expect(call?.headers.get("authorization")).toBe(`Bearer ${FAKE_TOKEN}`);
    expect(call?.headers.get("content-type")).toBe("application/json");
  });

  it("adds a caller's headers (e.g. PayPal-Request-Id) to a POST, never replacing the token or content type", async () => {
    const paypal = fakePaypal({ handle: () => Response.json({ ok: true }, { status: 201 }) });
    const response = await client(paypal.fetch).postJson("/v1/payments/payouts", "{}", "payout", {
      "PayPal-Request-Id": "req-hash-1",
      authorization: "Bearer forged",
      "content-type": "text/plain",
    });
    expect(response).toEqual({ status: 201, body: { ok: true } });
    const call = paypal.calls.at(-1)!;
    expect(call.headers.get("paypal-request-id")).toBe("req-hash-1");
    expect(call.headers.get("authorization")).toBe(`Bearer ${FAKE_TOKEN}`);
    expect(call.headers.get("content-type")).toBe("application/json");
  });

  it("GETs JSON with the bearer token and no body", async () => {
    const paypal = fakePaypal({ handle: (call) => (call.method === "GET" ? Response.json({ balances: [] }) : undefined) });
    const response = await client(paypal.fetch).getJson("/v1/reporting/balances?currency_code=USD", "balances");
    expect(response).toEqual({ status: 200, body: { balances: [] } });
    const call = paypal.calls.at(-1)!;
    expect(call.url).toBe(`${SANDBOX}/v1/reporting/balances?currency_code=USD`);
    expect(call.method).toBe("GET");
    expect(call.body).toBe("");
    expect(call.headers.get("authorization")).toBe(`Bearer ${FAKE_TOKEN}`);
  });

  it("reads a GET's empty or non-JSON body as undefined, and reports no response as status 0", async () => {
    const paypal = fakePaypal({ handle: () => new Response("<html>", { status: 502 }) });
    expect(await client(paypal.fetch).getJson("/v1/payments/payouts/B", "payout_get")).toEqual({ status: 502, body: undefined });
    const down = fakePaypal({ networkError: true });
    await expect(client(down.fetch).getJson("/v1/payments/payouts/B", "payout_get")).rejects.toMatchObject({ status: 0 });
  });

  it("drops a cached token that PayPal answers with 401, so the next call fetches a new one", async () => {
    const paypal = fakePaypal({ verifyStatus: 401 });
    const paypalClient = client(paypal.fetch);
    expect((await paypalClient.postJson("/v1/notifications/verify-webhook-signature", "{}", "verify")).status).toBe(401);
    await paypalClient.getAccessToken();
    expect(paypal.tokenCalls()).toHaveLength(2);
  });

  it("only ever calls the sandbox host", async () => {
    const paypal = fakePaypal();
    await client(paypal.fetch).postJson("/v1/notifications/verify-webhook-signature", "{}", "verify");
    expect(paypal.calls.map((call) => new URL(call.url).origin)).toEqual([SANDBOX, SANDBOX]);
  });

  it("calls the global fetch as a plain function (Workers throws Illegal invocation otherwise)", async () => {
    const paypal = fakePaypal();
    const globalFetch = vi.fn(function (this: unknown, input: string, init: RequestInit) {
      if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
      return paypal.fetch(input, init);
    });
    vi.stubGlobal("fetch", globalFetch);
    const paypalClient = createPaypalClient({ clientId: FAKE_CLIENT_ID, clientSecret: FAKE_CLIENT_SECRET });
    expect(await paypalClient.getAccessToken()).toBe(FAKE_TOKEN);
    expect(globalFetch).toHaveBeenCalledTimes(1);
  });
});
