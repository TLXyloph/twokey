import { describe, expect, it, vi } from "vitest";
import { API } from "@/ledger/contracts";
import { createHttpTransport, isWatchReplay } from "@/ui/judge/http-transport";
import { WATCHTOWER_API } from "@/watchtower/contracts";
import { fixtureReplay, NOW } from "../../fixtures/watchtower-view";

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

describe("replaying an outside send over HTTP", () => {
  it("POSTs the replay route as JSON, with the session cookie, and returns the labelled finding", async () => {
    const replay = fixtureReplay(NOW);
    const fetch = scriptedFetch(json(200, replay));
    await expect(createHttpTransport({ fetch }).replayOutsideSend()).resolves.toEqual({ ok: true, replay });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(WATCHTOWER_API.replay);
    expect(init).toMatchObject({ method: "POST", credentials: "same-origin", body: "{}" });
    expect(new Headers(init?.headers).get("Content-Type")).toBe("application/json");
  });

  it("gets a judge session on a 401 and asks once more, like the board's other calls", async () => {
    const replay = fixtureReplay(NOW);
    const fetch = scriptedFetch(json(401, { error: { code: "no_session", message: "No session." } }), json(200, {}), json(200, replay));
    await expect(createHttpTransport({ fetch }).replayOutsideSend()).resolves.toEqual({ ok: true, replay });
    expect(fetch.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      [WATCHTOWER_API.replay, "POST"],
      [API.session, "POST"],
      [WATCHTOWER_API.replay, "POST"],
    ]);
  });

  it("returns the server's refusal as data, never throwing", async () => {
    const fetch = scriptedFetch(json(403, { error: { code: "cross_origin", message: "That request didn't come from this site." } }));
    await expect(createHttpTransport({ fetch }).replayOutsideSend()).resolves.toEqual({
      ok: false,
      status: 403,
      code: "cross_origin",
      message: "That request didn't come from this site.",
    });
  });

  it("says plainly when the session can't be had, the server is unreachable, or the answer is unreadable", async () => {
    const noSession = scriptedFetch(json(401, {}), json(429, { error: { code: "rate_limited", message: "Too many new sessions." } }));
    await expect(createHttpTransport({ fetch: noSession }).replayOutsideSend()).resolves.toMatchObject({ ok: false, code: "no_session", message: "Too many new sessions." });

    const offline = scriptedFetch(new TypeError("Failed to fetch"));
    await expect(createHttpTransport({ fetch: offline }).replayOutsideSend()).resolves.toMatchObject({ ok: false, status: 0, code: "network" });

    const odd = scriptedFetch(json(200, { finding: { transactionId: "X" } }));
    await expect(createHttpTransport({ fetch: odd }).replayOutsideSend()).resolves.toMatchObject({ ok: false, code: "bad_response" });
  });

  it("shares one session request with the board's own reads", async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url === API.session) return json(200, {});
      const sessions = fetch.mock.calls.filter(([u]) => u === API.session).length;
      if (sessions === 0) return json(401, {});
      return url === WATCHTOWER_API.replay ? json(200, fixtureReplay(NOW)) : json(500, {});
    });
    const transport = createHttpTransport({ fetch });
    await Promise.all([transport.replayOutsideSend(), transport.getView().catch(() => null)]);
    expect(fetch.mock.calls.filter(([u]) => u === API.session)).toHaveLength(1);
  });
});

describe("the replay's shape check", () => {
  it("wants a label and a finding with an id, a route, a time and whole cents", () => {
    expect(isWatchReplay(fixtureReplay(NOW))).toBe(true);
    expect(isWatchReplay({ ...fixtureReplay(NOW), label: " " })).toBe(false);
    expect(isWatchReplay({ ...fixtureReplay(NOW), finding: { ...fixtureReplay(NOW).finding, amountCents: 3.21 } })).toBe(false);
    expect(isWatchReplay(null)).toBe(false);
  });
});
