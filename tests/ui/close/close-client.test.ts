import { describe, expect, it, vi } from "vitest";
import { CLOSE_API, CLOSE_MONTH, CLOSE_MONTH_NAME, type CloseSignoffView, type CloseView } from "@/close/contracts";
import { octoberClose } from "@/close/october";
import { API } from "@/ledger/contracts";
import { CloseReadError, createCloseClient, createHttpCloseTransport, EMPTY_CLOSE, MAX_FAILURES, type CloseTransport, type SignAttempt } from "@/ui/close/close-client";

const HASH = "a".repeat(64);
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const signoff = (over: Partial<CloseSignoffView> = {}): CloseSignoffView => ({
  month: CLOSE_MONTH,
  role: "reviewer",
  title: "Reviewer",
  keyId: "4951e1dd",
  signature: "c2lnbmF0dXJl",
  signedAt: "2026-11-05T18:00:00.000Z",
  signed: { type: "twokey.close.signoff.v1", month: CLOSE_MONTH, closeHash: HASH, role: "reviewer", keyId: "4951e1dd", signedAt: "2026-11-05T18:00:00.000Z" },
  verified: true,
  matchesClose: true,
  ...over,
});

const closeView = (over: Partial<CloseView> = {}): CloseView => ({
  month: CLOSE_MONTH,
  monthName: CLOSE_MONTH_NAME,
  figures: octoberClose(),
  closeHash: HASH,
  draft: { state: "not_recorded" },
  signoff: null,
  reviewerKey: { keyId: "4951e1dd" },
  ...over,
});

/** A fetch that answers each call in turn from `responses`. */
function scriptedFetch(...responses: (Response | Error)[]) {
  return vi.fn(async (_url: string, _init?: RequestInit) => {
    const next = responses.shift();
    if (!next) throw new Error("unexpected fetch");
    if (next instanceof Error) throw next;
    return next;
  });
}

describe("reading the close", () => {
  it("GETs October's close with the session cookie", async () => {
    const view = closeView();
    const fetch = scriptedFetch(json(200, view));
    await expect(createHttpCloseTransport(fetch).getView()).resolves.toEqual(view);
    expect(fetch).toHaveBeenCalledWith(CLOSE_API.view(), expect.objectContaining({ method: "GET", credentials: "same-origin" }));
    expect(CLOSE_API.view()).toBe("/api/close?month=2026-10");
  });

  it("gets a judge session on a 401 and asks once more, then gives up", async () => {
    const view = closeView({ signoff: signoff() });
    const fetch = scriptedFetch(json(401, {}), json(200, { ok: true }), json(200, view));
    await expect(createHttpCloseTransport(fetch).getView()).resolves.toEqual(view);
    expect(fetch.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      [CLOSE_API.view(), "GET"],
      [API.session, "POST"],
      [CLOSE_API.view(), "GET"],
    ]);

    const again = scriptedFetch(json(401, {}), json(200, {}), json(401, { error: { code: "no_session", message: "No session." } }));
    await expect(createHttpCloseTransport(again).getView()).rejects.toThrow("No session.");
    expect(again).toHaveBeenCalledTimes(3);
  });

  it("asks for one session at a time when two reads hit a 401 together", async () => {
    const view = closeView();
    const fetch = vi.fn(async (url: string) => {
      if (url === API.session) return json(200, {});
      return fetch.mock.calls.some(([u]) => u === API.session) ? json(200, view) : json(401, {});
    });
    const transport = createHttpCloseTransport(fetch);
    await Promise.all([transport.getView(), transport.getView()]);
    expect(fetch.mock.calls.filter(([u]) => u === API.session)).toHaveLength(1);
  });

  it("fails with the server's sentence when the session can't be had", async () => {
    const fetch = scriptedFetch(json(401, {}), json(429, { error: { code: "rate_limited", message: "Too many new sessions from this network." } }));
    const read = createHttpCloseTransport(fetch).getView();
    await expect(read).rejects.toBeInstanceOf(CloseReadError);
    await expect(read).rejects.toThrow("Too many new sessions from this network.");
  });

  it("refuses a body that is not October's close, or a sign-off it can't read", async () => {
    await expect(createHttpCloseTransport(scriptedFetch(json(200, { hello: "world" }))).getView()).rejects.toThrow("The close came back in a shape this page can't read.");
    await expect(createHttpCloseTransport(scriptedFetch(json(200, closeView({ month: "2026-09" as never })))).getView()).rejects.toThrow("can't read");
    await expect(createHttpCloseTransport(scriptedFetch(json(200, { ...closeView(), signoff: { role: "treasurer" } }))).getView()).rejects.toThrow("can't read");
  });

  it("says plainly when the server is unreachable, or answers an error without a sentence", async () => {
    await expect(createHttpCloseTransport(scriptedFetch(new TypeError("Failed to fetch"))).getView()).rejects.toThrow("Couldn't reach the server. Check the connection and try again.");
    await expect(createHttpCloseTransport(scriptedFetch(new Response("<html>Bad gateway</html>", { status: 502 }))).getView()).rejects.toThrow(
      "The server couldn't do that just now (error 502). Try again in a moment.",
    );
  });
});

describe("signing the close", () => {
  it("POSTs the acting role and the month as JSON", async () => {
    const made = signoff();
    const fetch = scriptedFetch(json(201, { signoff: made, duplicate: false }));
    await expect(createHttpCloseTransport(fetch).sign("reviewer")).resolves.toEqual({ ok: true, signoff: made, duplicate: false });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(CLOSE_API.sign);
    expect(init).toMatchObject({ method: "POST", credentials: "same-origin", headers: expect.objectContaining({ "Content-Type": "application/json" }) });
    expect(JSON.parse(String(init?.body))).toEqual({ actingAs: "reviewer", month: "2026-10" });
  });

  it("reads a sign-off this session already made as a duplicate", async () => {
    const fetch = scriptedFetch(json(200, { signoff: signoff(), duplicate: true }));
    await expect(createHttpCloseTransport(fetch).sign("reviewer")).resolves.toMatchObject({ ok: true, duplicate: true });
  });

  it("returns a refusal as data, with the server's code and sentence, never a throw", async () => {
    const fetch = scriptedFetch(json(409, { error: { code: "signer_cannot_review", message: "The Treasurer can't sign the monthly close: a non-signer reviews it." } }));
    await expect(createHttpCloseTransport(fetch).sign("treasurer")).resolves.toEqual({
      ok: false,
      status: 409,
      code: "signer_cannot_review",
      message: "The Treasurer can't sign the monthly close: a non-signer reviews it.",
    });
  });

  it("names a network failure, a session it couldn't get and an answer it can't read", async () => {
    await expect(createHttpCloseTransport(scriptedFetch(new TypeError("offline"))).sign("reviewer")).resolves.toMatchObject({ ok: false, status: 0, code: "network" });
    await expect(createHttpCloseTransport(scriptedFetch(json(401, {}), json(503, { error: { code: "x", message: "Sessions are paused." } }))).sign("reviewer")).resolves.toEqual({
      ok: false,
      status: 0,
      code: "no_session",
      message: "Sessions are paused.",
    });
    await expect(createHttpCloseTransport(scriptedFetch(json(201, { signoff: { role: "reviewer" } }))).sign("reviewer")).resolves.toMatchObject({ ok: false, code: "bad_response" });
  });
});

/** A transport whose answers the test releases by hand. */
function deferredTransport() {
  const views: ((view: CloseView | Error) => void)[] = [];
  const signs: ((attempt: SignAttempt) => void)[] = [];
  const transport = {
    getView: vi.fn(() => new Promise<CloseView>((resolve, reject) => views.push((v) => (v instanceof Error ? reject(v) : resolve(v))))),
    sign: vi.fn(() => new Promise<SignAttempt>((resolve) => signs.push(resolve))),
  } satisfies CloseTransport;
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  return {
    transport,
    answerView: async (view: CloseView | Error) => (views.shift()!(view), flush()),
    answerSign: async (attempt: SignAttempt) => (signs.shift()!(attempt), flush()),
  };
}

const refused = (message = "The Treasurer can't sign the monthly close: a non-signer reviews it."): SignAttempt => ({ ok: false, status: 409, code: "signer_cannot_review", message });

describe("the close client", () => {
  it("starts empty", () => {
    expect(createCloseClient({ transport: deferredTransport().transport }).getSnapshot()).toBe(EMPTY_CLOSE);
  });

  it("reads the view and this session's sign-off, telling its listeners", async () => {
    const port = deferredTransport();
    const client = createCloseClient({ transport: port.transport });
    const listener = vi.fn();
    client.subscribe(listener);
    const read = client.refresh();
    expect(client.getSnapshot()).toMatchObject({ loading: true, view: null });
    const view = closeView({ signoff: signoff() });
    await port.answerView(view);
    await read;
    expect(client.getSnapshot()).toMatchObject({ loading: false, error: null, view, signoff: view.signoff, fresh: false });
    expect(listener).toHaveBeenCalled();
  });

  it("shares one read between quick refreshes, and stops telling a listener that left", async () => {
    const port = deferredTransport();
    const client = createCloseClient({ transport: port.transport });
    const listener = vi.fn();
    const leave = client.subscribe(listener);
    const first = client.refresh();
    expect(client.refresh()).toBe(first);
    leave();
    await port.answerView(closeView());
    expect(port.transport.getView).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("keeps a read's failure as a sentence, and clears it on the next good read", async () => {
    const port = deferredTransport();
    const client = createCloseClient({ transport: port.transport });
    const failed = client.refresh();
    await port.answerView(new CloseReadError("Couldn't reach the server."));
    await failed;
    expect(client.getSnapshot()).toMatchObject({ loading: false, error: "Couldn't reach the server.", view: null });
    const again = client.refresh();
    await port.answerView(closeView());
    await again;
    expect(client.getSnapshot().error).toBeNull();
  });

  it("lands a sign-off made on this page with motion, and a duplicate without", async () => {
    const port = deferredTransport();
    const client = createCloseClient({ transport: port.transport });
    const signing = client.sign("reviewer");
    expect(client.getSnapshot().signing).toBe(true);
    await port.answerSign({ ok: true, signoff: signoff(), duplicate: false });
    await expect(signing).resolves.toMatchObject({ ok: true });
    expect(client.getSnapshot()).toMatchObject({ signing: false, fresh: true, signoff: signoff() });

    const other = createCloseClient({ transport: { getView: vi.fn(), sign: async () => ({ ok: true, signoff: signoff(), duplicate: true }) } });
    await other.sign("reviewer");
    expect(other.getSnapshot()).toMatchObject({ fresh: false, signoff: signoff() });
  });

  it("keeps a sign-off made while a read was in flight over the older read", async () => {
    const port = deferredTransport();
    const client = createCloseClient({ transport: port.transport });
    const read = client.refresh();
    const signing = client.sign("reviewer");
    await port.answerSign({ ok: true, signoff: signoff({ keyId: "made-here" }), duplicate: false });
    await signing;
    await port.answerView(closeView({ signoff: null }));
    await read;
    expect(client.getSnapshot().signoff?.keyId).toBe("made-here");
  });

  it("refuses a second click while one is signing, without calling the server", async () => {
    const port = deferredTransport();
    const client = createCloseClient({ transport: port.transport });
    void client.sign("reviewer");
    await expect(client.sign("reviewer")).resolves.toEqual({ ok: false, status: 0, code: "busy", message: "Already signing." });
    expect(port.transport.sign).toHaveBeenCalledTimes(1);
  });

  it("records each refusal in page memory, newest first, at most three, with its role and time", async () => {
    let clock = 1_000;
    const transport: CloseTransport = { getView: vi.fn(), sign: async (role) => refused(`${role} refused`) };
    const client = createCloseClient({ transport, now: () => clock++ });
    for (const role of ["treasurer", "president", "secretary", "parent"] as const) await client.sign(role);
    const { failures, signoff: none, signing } = client.getSnapshot();
    expect(MAX_FAILURES).toBe(3);
    expect(failures.map((f) => [f.role, f.message, f.at])).toEqual([
      ["parent", "parent refused", 1_003],
      ["secretary", "secretary refused", 1_002],
      ["president", "president refused", 1_001],
    ]);
    expect(new Set(failures.map((f) => f.id)).size).toBe(3);
    expect(failures[0]!.code).toBe("signer_cannot_review");
    expect(none).toBeNull();
    expect(signing).toBe(false);
  });
});
