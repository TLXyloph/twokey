import { describe, expect, it } from "vitest";
import { createPaypalClient } from "@/payments/paypal/client";
import {
  parseSearchPage,
  searchTransactions,
  searchWindows,
  TRANSACTIONS_PATH,
  TransactionSearchError,
} from "@/payments/paypal/transactions";
import measured from "../../fixtures/paypal/transaction-search-2026-11-05.json";
import { FAKE_CLIENT_ID, FAKE_CLIENT_SECRET, FAKE_TOKEN, fakePaypal, SANDBOX, type FakeCall } from "./fixtures";

const FROM = "2026-11-01T00:00:00Z";
const NOW = new Date("2026-11-05T15:20:31.456Z");

function setup(respond: (call: FakeCall, url: URL) => Response | undefined, options: { tokenStatus?: number; networkError?: boolean } = {}) {
  const paypal = fakePaypal({
    ...options,
    handle: (call) => {
      const url = new URL(call.url);
      return url.pathname === TRANSACTIONS_PATH ? respond(call, url) : undefined;
    },
  });
  const client = createPaypalClient({ clientId: FAKE_CLIENT_ID, clientSecret: FAKE_CLIENT_SECRET, fetch: paypal.fetch });
  const searches = () => paypal.calls.filter((call) => new URL(call.url).pathname === TRANSACTIONS_PATH).map((call) => new URL(call.url));
  return { client, paypal, searches };
}

const page = (details: unknown[], extra: Record<string, unknown> = {}) => ({
  transaction_details: details,
  account_number: "ACCOUNTTEST01",
  last_refreshed_datetime: "2026-11-05T08:59:59Z",
  page: 1,
  total_items: details.length,
  total_pages: 1,
  ...extra,
});

const row = (id: string, value: string, extra: Record<string, unknown> = {}) => ({
  transaction_info: {
    transaction_id: id,
    transaction_event_code: "T0000",
    transaction_initiation_date: "2026-11-03T04:13:48Z",
    transaction_amount: { currency_code: "USD", value },
    transaction_status: "S",
    ...extra,
  },
  payer_info: { email_address: "someone-fictional@example.test" },
});

async function failure(promise: Promise<unknown>): Promise<TransactionSearchError> {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  if (!(error instanceof TransactionSearchError)) throw new Error(`expected a TransactionSearchError, got ${String(error)}`);
  return error;
}

describe("searchWindows", () => {
  it("covers WATCH_FROM to now in windows of at most 31 days, second precision, no gaps", () => {
    expect(searchWindows(FROM, NOW)).toEqual([{ start: "2026-11-01T00:00:00Z", end: "2026-11-05T15:20:31Z" }]);
    const windows = searchWindows(FROM, new Date("2027-01-15T12:00:00Z"));
    expect(windows).toEqual([
      { start: "2026-11-01T00:00:00Z", end: "2026-12-01T23:59:59Z" },
      { start: "2026-12-02T00:00:00Z", end: "2027-01-01T23:59:59Z" },
      { start: "2027-01-02T00:00:00Z", end: "2027-01-15T12:00:00Z" },
    ]);
    for (const { start, end } of windows) expect(Date.parse(end) - Date.parse(start)).toBeLessThanOrEqual(31 * 86_400_000);
  });

  it("is empty when the clock is before WATCH_FROM", () => {
    expect(searchWindows(FROM, new Date("2026-10-31T00:00:00Z"))).toEqual([]);
  });
});

describe("parseSearchPage", () => {
  it("reads the measured club account: 11 rows, PayPal's as-of time, only the fields the Watchtower uses", () => {
    const parsed = parseSearchPage(measured)!;
    expect(parsed.rows).toHaveLength(11);
    expect(parsed.unreadable).toBe(0);
    expect(parsed.totalPages).toBe(1);
    expect(parsed.lastRefreshed).toBe("2026-11-05T08:59:59Z");
    expect(parsed.rows.find((r) => r.transactionId === "3XT37311AK7894010")).toEqual({
      transactionId: "3XT37311AK7894010",
      eventCode: "T0001",
      amountCents: -100,
      feeCents: -25,
      currency: "USD",
      initiatedAt: "2026-11-02T23:32:17Z",
      status: "S",
      referenceId: "0GN99893ND2823603",
      customField: "item-1",
      counterpartyEmail: "payouts-simulator-receiver@paypal.com",
    });
    expect(parsed.rows.find((r) => r.transactionId === "0UN74527JS883252U")).toMatchObject({
      eventCode: "T0300",
      amountCents: 321,
      feeCents: 0,
      referenceId: "1TY14748YE721631B",
      counterpartyEmail: null,
      customField: null,
    });
  });

  it("normalizes PayPal's +0000 offsets to UTC", () => {
    const parsed = parseSearchPage(page([row("A", "-1.00", { transaction_initiation_date: "2026-11-03T04:13:48+0000" })]))!;
    expect(parsed.rows[0]!.initiatedAt).toBe("2026-11-03T04:13:48Z");
  });

  it("counts a row it can't read instead of guessing, and keeps the rest", () => {
    const parsed = parseSearchPage(
      page([row("A", "-1.00"), row("B", "lots"), { transaction_info: { transaction_id: "C" } }, row("D", "2.00", { transaction_event_code: "X" })]),
    )!;
    expect(parsed.rows.map((r) => r.transactionId)).toEqual(["A"]);
    expect(parsed.unreadable).toBe(3);
  });

  it("reads an empty window, which may come without transaction_details", () => {
    expect(parseSearchPage({ last_refreshed_datetime: "2026-11-05T08:59:59Z", total_items: 0, total_pages: 0 })).toEqual({
      rows: [],
      unreadable: 0,
      totalPages: 0,
      lastRefreshed: "2026-11-05T08:59:59Z",
    });
  });

  it("is null for a body that isn't a search page", () => {
    expect(parseSearchPage(undefined)).toBeNull();
    expect(parseSearchPage({ transaction_details: "no" })).toBeNull();
    expect(parseSearchPage({ name: "INTERNAL_SERVER_ERROR" })).toBeNull();
  });
});

describe("searchTransactions", () => {
  it("GETs every window with fields=all and page_size=500, with the bearer token", async () => {
    const { client, paypal, searches } = setup(() => Response.json(measured));
    const result = await searchTransactions(client, { from: FROM, now: NOW });
    expect(result.rows).toHaveLength(11);
    expect(result.lastRefreshed).toBe("2026-11-05T08:59:59Z");
    expect(result.unreadable).toBe(0);
    const [url] = searches();
    expect(searches()).toHaveLength(1);
    expect(`${url!.origin}${url!.pathname}`).toBe(`${SANDBOX}${TRANSACTIONS_PATH}`);
    expect(Object.fromEntries(url!.searchParams)).toEqual({
      start_date: "2026-11-01T00:00:00Z",
      end_date: "2026-11-05T15:20:31Z",
      fields: "all",
      page_size: "500",
      page: "1",
    });
    const call = paypal.calls.find((c) => c.url.includes(TRANSACTIONS_PATH))!;
    expect(call.method).toBe("GET");
    expect(call.headers.get("authorization")).toBe(`Bearer ${FAKE_TOKEN}`);
  });

  it("reads every page of every window, and keeps one copy of a row PayPal repeats", async () => {
    const { client, searches } = setup((_call, url) => {
      const start = url.searchParams.get("start_date");
      const n = Number(url.searchParams.get("page"));
      if (start === "2026-11-01T00:00:00Z") {
        return Response.json(page([row(`W1-P${n}`, "-1.00"), row("SAME", "-2.00")], { page: n, total_pages: 3, last_refreshed_datetime: "2026-12-30T06:59:59Z" }));
      }
      return Response.json(page([row("W2", "-3.00"), row("SAME", "-2.00")], { last_refreshed_datetime: "2027-01-01T04:59:59Z" }));
    });
    const result = await searchTransactions(client, { from: FROM, now: new Date("2027-01-01T12:00:00Z") });
    expect(searches().map((u) => [u.searchParams.get("start_date"), u.searchParams.get("page")])).toEqual([
      ["2026-11-01T00:00:00Z", "1"],
      ["2026-11-01T00:00:00Z", "2"],
      ["2026-11-01T00:00:00Z", "3"],
      ["2026-12-02T00:00:00Z", "1"],
    ]);
    expect(result.rows.map((r) => r.transactionId)).toEqual(["W1-P1", "SAME", "W1-P2", "W1-P3", "W2"]);
    expect(result.lastRefreshed).toBe("2027-01-01T04:59:59Z");
  });

  it("refuses to truncate: more pages than it will read is an error, not a partial answer", async () => {
    const { client } = setup(() => Response.json(page([row("A", "-1.00")], { total_pages: 999 })));
    expect(await failure(searchTransactions(client, { from: FROM, now: NOW }))).toMatchObject({ kind: "paypal_error", code: "too_many_pages" });
  });

  it("reads a refused token (credentials revoked or rotated) as lost access", async () => {
    const { client, searches } = setup(() => Response.json(measured), { tokenStatus: 401 });
    const error = await failure(searchTransactions(client, { from: FROM, now: NOW }));
    expect(error).toMatchObject({ kind: "no_access", status: 401, code: "token_http_401" });
    expect(searches()).toHaveLength(0);
  });

  it("reads a 401 or 403 from the search itself as lost access", async () => {
    for (const status of [401, 403]) {
      const { client } = setup(() => Response.json({ name: "NOT_AUTHORIZED", message: "secret-looking body" }, { status }));
      const error = await failure(searchTransactions(client, { from: FROM, now: NOW }));
      expect(error).toMatchObject({ kind: "no_access", status, code: `search_http_${status}` });
      expect(error.message).not.toContain("secret-looking body");
    }
  });

  it("reads any other failure as a PayPal error with its status, never its body or the token", async () => {
    const { client } = setup(() => Response.json({ name: "INTERNAL_SERVER_ERROR", debug_id: "body-detail" }, { status: 500 }));
    const error = await failure(searchTransactions(client, { from: FROM, now: NOW }));
    expect(error).toMatchObject({ kind: "paypal_error", status: 500, code: "search_http_500" });
    expect(`${error.message} ${error.code}`).not.toMatch(/body-detail|test-access-token/);

    const token500 = setup(() => Response.json(measured), { tokenStatus: 500 });
    expect(await failure(searchTransactions(token500.client, { from: FROM, now: NOW }))).toMatchObject({ kind: "paypal_error", code: "token_http_500" });

    const unreadable = setup(() => new Response("<html>oops</html>", { status: 200 }));
    expect(await failure(searchTransactions(unreadable.client, { from: FROM, now: NOW }))).toMatchObject({ kind: "paypal_error", status: 200, code: "unreadable_response" });
  });

  it("reads no response at all as a PayPal error with status 0", async () => {
    const { client } = setup(() => Response.json(measured), { networkError: true });
    expect(await failure(searchTransactions(client, { from: FROM, now: NOW }))).toMatchObject({ kind: "paypal_error", status: 0, code: "no_response" });
  });
});
