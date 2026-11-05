import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardView } from "@/ledger/contracts";
import {
  createBoardViewClient,
  mergeView,
  payoutInFlight,
  POLL_INTERVAL_MS,
  shouldPoll,
  unrecordedOutcome,
  withRequest,
} from "@/ui/judge/board-view-client";
import type { ActionResult, BoardTransport, ReplayResult } from "@/ui/judge/http-transport";
import { boardView, glovesRequest, paintRequest, sentBackRequest, sentRequest } from "../../fixtures/board-view";

/** A server in miniature: reads return `views` in turn (then the last), and actions change it. */
function mockTransport(views: BoardView[] = [boardView()]) {
  let server = views[0]!;
  const getView = vi.fn(async () => {
    server = views.shift() ?? server;
    return structuredClone(server);
  });
  const act = (request: ReturnType<typeof sentRequest>): ActionResult => {
    server = withRequest(server, request);
    return { ok: true, request };
  };
  const sign = vi.fn(async (): Promise<ActionResult> => act(sentRequest()));
  const createRequest = vi.fn(async (): Promise<ActionResult> => act({ ...glovesRequest(), requestId: "new" }));
  const assessRisk = vi.fn(async (): Promise<ActionResult> => act({ ...paintRequest(), riskPending: false }));
  const sendBack = vi.fn(async (): Promise<ActionResult> => act(sentBackRequest()));
  // The board-view client never replays: the Watchtower's replay store does (tests/ui/watchtower).
  const replayOutsideSend = vi.fn(async (): Promise<ReplayResult> => ({ ok: false, status: 500, code: "unused", message: "unused" }));
  return {
    transport: { getView, sign, createRequest, assessRisk, sendBack, replayOutsideSend } satisfies BoardTransport,
    getView,
    sign,
    createRequest,
    assessRisk,
    sendBack,
  };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("polling rules", () => {
  const view = boardView();
  const inFlight = boardView({ requests: [sentRequest()] });

  it("knows a payout is in flight while it is sent but not confirmed", () => {
    expect(payoutInFlight(view)).toBe(false);
    expect(payoutInFlight(inFlight)).toBe(true);
    expect(payoutInFlight(null)).toBe(false);
  });

  it("polls while the drawer is open or a payout is in flight, and only while the page is visible", () => {
    expect(shouldPoll({ drawerOpen: false, pageVisible: true, view })).toBe(false);
    expect(shouldPoll({ drawerOpen: true, pageVisible: true, view })).toBe(true);
    expect(shouldPoll({ drawerOpen: false, pageVisible: true, view: inFlight })).toBe(true);
    expect(shouldPoll({ drawerOpen: true, pageVisible: false, view })).toBe(false);
  });
});

describe("merging views", () => {
  it("keeps the previous view when nothing changed, so React and Studio do no work", () => {
    const prev = boardView();
    expect(mergeView(prev, structuredClone(prev))).toBe(prev);
  });

  it("keeps the board data's identity when only the requests changed", () => {
    const prev = boardView();
    const next = { ...structuredClone(prev), requests: [sentRequest()] };
    const merged = mergeView(prev, next);
    expect(merged).not.toBe(prev);
    expect(merged.data).toBe(prev.data);
    expect(merged.requests).toEqual([sentRequest()]);
  });

  it("puts an action's request in place, or first when it is new", () => {
    const view = boardView();
    const replaced = withRequest(view, { ...glovesRequest(), status: "sent" });
    expect(replaced.requests.map((r) => [r.requestId, r.status])).toEqual([
      ["req_seed_gloves", "sent"],
      ["req_seed_paint", "waiting"],
    ]);
    expect(replaced.data).toBe(view.data);
    expect(withRequest(view, { ...glovesRequest(), requestId: "new" }).requests[0]!.requestId).toBe("new");
  });
});

describe("the board-view client", () => {
  it("has no view until the first one arrives", async () => {
    const { transport } = mockTransport();
    const client = createBoardViewClient({ transport });
    expect(client.getSnapshot().view).toBeNull();

    await client.refresh();
    expect(client.getSnapshot()).toMatchObject({ view: boardView(), loading: false, error: null });
  });

  it("tells subscribers when the snapshot changes, and not when a poll brings the same view", async () => {
    const { transport } = mockTransport();
    const client = createBoardViewClient({ transport });
    await client.refresh();
    const listener = vi.fn();
    client.subscribe(listener);
    const before = client.getSnapshot();

    await client.refresh();
    expect(client.getSnapshot().view).toBe(before.view);
    // Only the loading flag went up and down.
    expect(listener.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("keeps the last good view beside an error", async () => {
    const { transport, getView } = mockTransport();
    const client = createBoardViewClient({ transport });
    await client.refresh();
    getView.mockRejectedValueOnce(new Error("Couldn't reach the server."));

    await client.refresh();
    expect(client.getSnapshot().view).toEqual(boardView());
    expect(client.getSnapshot().error).toBe("Couldn't reach the server.");
  });

  it("does not poll with the drawer shut and nothing in flight", async () => {
    const { transport, getView } = mockTransport();
    const client = createBoardViewClient({ transport });
    await client.refresh();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 5);
    expect(getView).toHaveBeenCalledTimes(1);
    expect(client.isPolling()).toBe(false);
  });

  it("refreshes at once when the drawer opens, then every 3 s, and stops when it closes", async () => {
    const { transport, getView } = mockTransport();
    const client = createBoardViewClient({ transport });
    await client.refresh();

    client.setDrawerOpen(true);
    await flush();
    expect(getView).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(getView).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(getView).toHaveBeenCalledTimes(4);

    client.setDrawerOpen(false);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
    expect(getView).toHaveBeenCalledTimes(4);
  });

  it("keeps polling with the drawer shut until PayPal confirms the payout in flight", async () => {
    const confirmed = sentRequest([{ step: "confirmed", label: "PayPal confirmed", at: "2026-11-05T16:42:24Z" }]);
    const { transport, getView } = mockTransport([
      boardView({ requests: [sentRequest()] }),
      boardView({ requests: [sentRequest()] }),
      boardView({ requests: [{ ...confirmed, status: "confirmed" }] }),
    ]);
    const client = createBoardViewClient({ transport });
    await client.refresh();
    expect(client.isPolling()).toBe(true);

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(getView).toHaveBeenCalledTimes(3);
    expect(client.isPolling()).toBe(false);

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
    expect(getView).toHaveBeenCalledTimes(3);
  });

  it("refreshes on window focus when it is not polling", async () => {
    const { transport, getView } = mockTransport();
    const client = createBoardViewClient({ transport });
    await client.refresh();

    client.windowFocused();
    await flush();
    expect(getView).toHaveBeenCalledTimes(2);
  });

  it("pauses polling while the page is hidden, and catches up when it shows", async () => {
    const { transport, getView } = mockTransport();
    const client = createBoardViewClient({ transport });
    client.setDrawerOpen(true);
    await flush();
    const calls = getView.mock.calls.length;

    client.setPageVisible(false);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
    expect(getView).toHaveBeenCalledTimes(calls);

    client.setPageVisible(true);
    await flush();
    expect(getView).toHaveBeenCalledTimes(calls + 1);
  });

  it("never runs two reads of the view at once", async () => {
    const { transport, getView } = mockTransport();
    const client = createBoardViewClient({ transport });
    await Promise.all([client.refresh(), client.refresh(), client.refresh()]);
    expect(getView).toHaveBeenCalledTimes(1);
  });

  it("stops everything once disposed", async () => {
    const { transport, getView } = mockTransport();
    const client = createBoardViewClient({ transport });
    client.setDrawerOpen(true);
    await flush();
    client.dispose();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
    expect(getView).toHaveBeenCalledTimes(1);
  });
});

describe("actions", () => {
  it("shows a signed payout at once, then refreshes the board behind it", async () => {
    const { transport, sign, getView } = mockTransport();
    const client = createBoardViewClient({ transport });
    await client.refresh();

    const pending = client.sign("req_seed_gloves", { actingAs: "president", acknowledgedFlags: false });
    expect(client.getSnapshot().busy).toEqual({ req_seed_gloves: true });
    await expect(pending).resolves.toEqual({ ok: true, request: sentRequest() });

    expect(sign).toHaveBeenCalledWith("req_seed_gloves", { actingAs: "president", acknowledgedFlags: false });
    expect(client.getSnapshot().busy).toEqual({});
    expect(client.getSnapshot().view!.requests[0]!.status).toBe("sent");
    await flush();
    expect(getView).toHaveBeenCalledTimes(2);
  });

  it("ignores a read that started before the action landed, so the board never steps back", async () => {
    const { transport, getView } = mockTransport();
    const client = createBoardViewClient({ transport });
    await client.refresh();
    let release!: (view: BoardView) => void;
    getView.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));

    const stale = client.refresh();
    await client.sign("req_seed_gloves", { actingAs: "president", acknowledgedFlags: false });
    release(boardView()); // the old view, with the gloves still waiting
    await stale;

    expect(client.getSnapshot().view!.requests[0]!.status).toBe("sent");
  });

  it("keeps a refusal as the request's latest outcome, with the refusals counted before it", async () => {
    const { transport, sign } = mockTransport();
    sign.mockResolvedValueOnce({ ok: false, status: 409, code: "payee_cannot_sign", message: "The payee can't sign." });
    const client = createBoardViewClient({ transport });
    await client.refresh();

    await client.sign("req_seed_paint", { actingAs: "treasurer", acknowledgedFlags: false });
    expect(client.getSnapshot().outcomes["req_seed_paint"]).toMatchObject({
      role: "treasurer",
      refusalsBefore: 0,
      result: { ok: false, code: "payee_cannot_sign", message: "The payee can't sign." },
    });
  });

  it("shows a sent-back payout at once, out of the queue, then refreshes the board behind it", async () => {
    const { transport, sendBack, getView } = mockTransport();
    const client = createBoardViewClient({ transport });
    await client.refresh();

    const body = { actingAs: "president" as const, reason: "One line on the receipt is not a league item." };
    await expect(client.sendBack("req_seed_paint", body)).resolves.toEqual({ ok: true, request: sentBackRequest() });
    expect(sendBack).toHaveBeenCalledWith("req_seed_paint", body);
    const paint = client.getSnapshot().view!.requests.find((r) => r.requestId === "req_seed_paint")!;
    expect(paint.status).toBe("sent_back");
    await flush();
    expect(getView).toHaveBeenCalledTimes(2);
  });

  it("keeps a refused send-back as the request's latest outcome, so the card shows it inline", async () => {
    const { transport, sendBack } = mockTransport();
    sendBack.mockResolvedValueOnce({ ok: false, status: 409, code: "request_closed", message: "This payout has already been sent to PayPal." });
    const client = createBoardViewClient({ transport });
    await client.refresh();

    await client.sendBack("req_seed_paint", { actingAs: "president", reason: "Not a league item." });
    expect(client.getSnapshot().outcomes["req_seed_paint"]).toMatchObject({
      role: "president",
      refusalsBefore: 0,
      result: { ok: false, code: "request_closed", message: "This payout has already been sent to PayPal." },
    });
    expect(client.getSnapshot().view!.requests.find((r) => r.requestId === "req_seed_paint")!.status).toBe("waiting");
  });

  it("adds a new request first", async () => {
    const { transport, createRequest } = mockTransport();
    const client = createBoardViewClient({ transport });
    await client.refresh();
    const body = { actingAs: "secretary" as const, payeeId: "team-supply" as const, amountCents: 4_800, description: "Cones", budgetLine: "equipment" as const, receiptId: "cones-team-supply" as const };

    await client.createRequest(body);
    expect(createRequest).toHaveBeenCalledWith(body);
    expect(client.getSnapshot().view!.requests[0]!.requestId).toBe("new");
  });

  it("asks for the AI's receipt read once per request, however often it is asked", async () => {
    const { transport, assessRisk } = mockTransport();
    const client = createBoardViewClient({ transport });
    await client.refresh();

    client.assessRiskOnce("req_seed_paint");
    client.assessRiskOnce("req_seed_paint");
    expect(client.getSnapshot().riskReads).toEqual({ req_seed_paint: "running" });
    await flush();
    client.assessRiskOnce("req_seed_paint");

    expect(assessRisk).toHaveBeenCalledTimes(1);
    expect(client.getSnapshot().riskReads).toEqual({ req_seed_paint: "done" });
  });

  it("marks a receipt read that failed, and does not try again", async () => {
    const { transport, assessRisk } = mockTransport();
    assessRisk.mockResolvedValueOnce({ ok: false, status: 503, code: "ai_unavailable", message: "The AI is unavailable." });
    const client = createBoardViewClient({ transport });
    client.assessRiskOnce("x");
    await flush();
    client.assessRiskOnce("x");
    expect(client.getSnapshot().riskReads).toEqual({ x: "failed" });
    expect(assessRisk).toHaveBeenCalledTimes(1);
  });
});

describe("unrecorded outcomes", () => {
  const refusal = { ok: false as const, status: 409, code: "payee_cannot_sign", message: "No." };

  it("shows a refusal until the ledger's copy arrives in the view", () => {
    const request = paintRequest();
    const outcome = { role: "treasurer" as const, at: 0, refusalsBefore: 0, result: refusal };
    expect(unrecordedOutcome(request, outcome)).toBe(outcome);
    const recorded = { ...request, refusals: [{ role: "treasurer" as const, code: "payee_cannot_sign" as const, message: "No.", at: "2026-11-05T16:00:00Z" }] };
    expect(unrecordedOutcome(recorded, outcome)).toBeNull();
  });

  it("always shows a limit, which the ledger records as a block, not a refusal", () => {
    const outcome = { role: "president" as const, at: 0, refusalsBefore: 0, result: { ...refusal, code: "session_payout_limit" } };
    expect(unrecordedOutcome(glovesRequest(), outcome)).toBe(outcome);
  });

  it("has nothing to show after a success or before any action", () => {
    expect(unrecordedOutcome(glovesRequest(), undefined)).toBeNull();
    expect(unrecordedOutcome(glovesRequest(), { role: "president", at: 0, refusalsBefore: 0, result: { ok: true, request: glovesRequest() } })).toBeNull();
  });
});
