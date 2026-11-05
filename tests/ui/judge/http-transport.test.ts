import { describe, expect, it, vi } from "vitest";
import { API } from "@/ledger/contracts";
import { BoardViewError, createHttpTransport } from "@/ui/judge/http-transport";
import { boardView, glovesRequest } from "../../fixtures/board-view";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** A fetch that answers each call in turn from `responses`. */
function scriptedFetch(...responses: (Response | Error)[]) {
  return vi.fn(async (_url: string, _init?: RequestInit) => {
    const next = responses.shift();
    if (!next) throw new Error("unexpected fetch");
    if (next instanceof Error) throw next;
    return next;
  });
}

describe("reading the board view", () => {
  it("GETs the view with the session cookie", async () => {
    const view = boardView();
    const fetch = scriptedFetch(json(200, view));
    await expect(createHttpTransport({ fetch }).getView()).resolves.toEqual(view);
    expect(fetch).toHaveBeenCalledWith(API.ledgerView, expect.objectContaining({ method: "GET", credentials: "same-origin" }));
  });

  it("gets a judge session on a 401 and asks once more", async () => {
    const view = boardView();
    const fetch = scriptedFetch(json(401, { error: { code: "no_session", message: "No session." } }), json(200, { ok: true }), json(200, view));
    await expect(createHttpTransport({ fetch }).getView()).resolves.toEqual(view);
    expect(fetch.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      [API.ledgerView, "GET"],
      [API.session, "POST"],
      [API.ledgerView, "GET"],
    ]);
  });

  it("gives up after one retry rather than looping", async () => {
    const fetch = scriptedFetch(json(401, {}), json(200, {}), json(401, {}));
    await expect(createHttpTransport({ fetch }).getView()).rejects.toBeInstanceOf(BoardViewError);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("fails plainly when the session cannot be had", async () => {
    const fetch = scriptedFetch(json(401, {}), json(429, { error: { code: "rate_limited", message: "Too many new sessions." } }));
    await expect(createHttpTransport({ fetch }).getView()).rejects.toThrow("Too many new sessions.");
  });

  it("asks for one session at a time when several calls hit a 401 together", async () => {
    const view = boardView();
    const fetch = vi.fn(async (url: string) => {
      if (url === API.session) return json(200, {});
      const sessions = fetch.mock.calls.filter(([u]) => u === API.session).length;
      return sessions === 0 ? json(401, {}) : json(200, view);
    });
    const transport = createHttpTransport({ fetch });
    await Promise.all([transport.getView(), transport.getView()]);
    expect(fetch.mock.calls.filter(([u]) => u === API.session)).toHaveLength(1);
  });

  it("refuses a response that is not a board view", async () => {
    const fetch = scriptedFetch(json(200, { hello: "world" }));
    await expect(createHttpTransport({ fetch }).getView()).rejects.toThrow("The board's data came back in a shape this page can't read.");
  });

  it("says so when the server is unreachable", async () => {
    const fetch = scriptedFetch(new TypeError("Failed to fetch"));
    await expect(createHttpTransport({ fetch }).getView()).rejects.toThrow("Couldn't reach the server.");
  });
});

describe("actions", () => {
  it("POSTs a signature as JSON and returns the updated request", async () => {
    const request = glovesRequest();
    const fetch = scriptedFetch(json(200, { request }));
    const result = await createHttpTransport({ fetch }).sign("req 1", { actingAs: "president", acknowledgedFlags: false });

    expect(result).toEqual({ ok: true, request });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(API.sign("req 1"));
    expect(init).toMatchObject({ method: "POST", credentials: "same-origin" });
    expect(new Headers(init!.headers).get("Content-Type")).toBe("application/json");
    expect(JSON.parse(String(init!.body))).toEqual({ actingAs: "president", acknowledgedFlags: false });
  });

  it("returns the server's refusal as data, not as an exception", async () => {
    const fetch = scriptedFetch(json(409, { error: { code: "payee_cannot_sign", message: "The payee can't sign." } }));
    await expect(createHttpTransport({ fetch }).sign("r", { actingAs: "treasurer", acknowledgedFlags: false })).resolves.toEqual({
      ok: false,
      status: 409,
      code: "payee_cannot_sign",
      message: "The payee can't sign.",
    });
  });

  it("creates a request (201) and asks for the AI's receipt read", async () => {
    const request = glovesRequest();
    const fetch = scriptedFetch(json(201, { request }), json(200, { request }));
    const transport = createHttpTransport({ fetch });
    const body = { actingAs: "secretary" as const, payeeId: "team-supply" as const, amountCents: 4_800, description: "Cones", budgetLine: "equipment" as const, receiptId: "cones-team-supply" as const };

    await expect(transport.createRequest(body)).resolves.toEqual({ ok: true, request });
    await expect(transport.assessRisk("abc")).resolves.toEqual({ ok: true, request });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([API.payoutRequests, API.risk("abc")]);
    expect(JSON.parse(String(fetch.mock.calls[1]![1]!.body))).toEqual({});
  });

  it("retries an action once after getting a session", async () => {
    const request = glovesRequest();
    const fetch = scriptedFetch(json(401, {}), json(200, {}), json(200, { request }));
    await expect(createHttpTransport({ fetch }).sign("r", { actingAs: "president", acknowledgedFlags: false })).resolves.toEqual({ ok: true, request });
  });

  it("words a failure without a body, and a network failure", async () => {
    const fetch = scriptedFetch(new Response("oops", { status: 502 }), new TypeError("Failed to fetch"));
    const transport = createHttpTransport({ fetch });
    await expect(transport.sign("r", { actingAs: "president", acknowledgedFlags: false })).resolves.toEqual({
      ok: false,
      status: 502,
      code: "http_502",
      message: "The server couldn't do that just now (error 502). Try again in a moment.",
    });
    await expect(transport.sign("r", { actingAs: "president", acknowledgedFlags: false })).resolves.toEqual({
      ok: false,
      status: 0,
      code: "network",
      message: "Couldn't reach the server. Check the connection and try again.",
    });
  });
});
