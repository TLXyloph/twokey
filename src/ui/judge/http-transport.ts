/**
 * The judge UI's port to the step-4 API (src/ledger/contracts.ts `API`): read the board view, create
 * a payout request, sign or send it back, and ask for the AI's receipt read; and the Watchtower's
 * judge-mode replay (src/watchtower/contracts.ts `WATCHTOWER_API.replay`).
 *
 * Every route needs the judge-session cookie. A call without one is answered 401; the transport then
 * POSTs the session endpoint (which sets the cookie) and sends the call once more, the same pattern
 * as Studio's AI adapter in src/agents/studio. Concurrent 401s share one session request.
 *
 * Actions never throw on an HTTP error: a refusal is data the drawer shows ({ ok: false, code,
 * message }). Reading the view throws a {@link BoardViewError}, which the client keeps beside the
 * last good view.
 */
import {
  API,
  type BoardView,
  type CreatePayoutRequestBody,
  type PayoutRequestView,
  type SendBackBody,
  type SignBody,
} from "@/ledger/contracts";
import { WATCHTOWER_API, type WatchReplay } from "@/watchtower/contracts";

export type ActionFailure = { ok: false; status: number; code: string; message: string };

export type ActionResult = { ok: true; request: PayoutRequestView } | ActionFailure;

/** The replay of a real sandbox event (judge mode; the server stores nothing). */
export type ReplayResult = { ok: true; replay: WatchReplay } | ActionFailure;

/** What the board-view client needs from the server. The dev fixture implements it in memory. */
export interface BoardTransport {
  getView(): Promise<BoardView>;
  createRequest(body: CreatePayoutRequestBody): Promise<ActionResult>;
  sign(requestId: string, body: SignBody): Promise<ActionResult>;
  /** An officer who could add key 2 sends the request back, with a reason (3–200 characters). */
  sendBack(requestId: string, body: SendBackBody): Promise<ActionResult>;
  assessRisk(requestId: string): Promise<ActionResult>;
  /** Runs a recorded outside send through the Watchtower's classifier again. */
  replayOutsideSend(): Promise<ReplayResult>;
}

export class BoardViewError extends Error {
  readonly status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.name = "BoardViewError";
    this.status = status;
  }
}

export interface HttpTransportOptions {
  /** Injectable for tests. Defaults to the browser's fetch, resolved per call. */
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
}

const UNREACHABLE = "Couldn't reach the server. Check the connection and try again.";

/** The error body's message, or a plain sentence for the status. */
async function readError(response: Response): Promise<{ code: string; message: string }> {
  try {
    const body = (await response.json()) as { error?: { code?: unknown; message?: unknown } };
    const { code, message } = body.error ?? {};
    if (typeof message === "string" && message.trim() !== "") {
      return { code: typeof code === "string" ? code : `http_${response.status}`, message };
    }
  } catch {
    // Not JSON: fall through to the plain sentence.
  }
  return {
    code: `http_${response.status}`,
    message: `The server couldn't do that just now (error ${response.status}). Try again in a moment.`,
  };
}

/** A light shape check at the boundary: enough to know the fold's view arrived, not a full schema. */
function isBoardView(value: unknown): value is BoardView {
  if (typeof value !== "object" || value === null) return false;
  const view = value as Partial<BoardView>;
  return (
    typeof view.data === "object" &&
    view.data !== null &&
    Array.isArray(view.data.ledger) &&
    Array.isArray(view.requests) &&
    typeof view.limits === "object" &&
    view.limits !== null &&
    typeof view.chain === "object" &&
    view.chain !== null
  );
}

function isRequestBody(value: unknown): value is { request: PayoutRequestView } {
  const request = (value as { request?: Partial<PayoutRequestView> } | null)?.request;
  return typeof request === "object" && request !== null && typeof request.requestId === "string" && Array.isArray(request.timeline);
}

/** Enough of a `WatchReplay` to draw the alert: a labelled finding with its amount and times. */
export function isWatchReplay(value: unknown): value is WatchReplay {
  const replay = value as Partial<WatchReplay> | null;
  const finding = replay?.finding as Partial<WatchReplay["finding"]> | undefined;
  return (
    typeof replay === "object" &&
    replay !== null &&
    typeof replay.label === "string" &&
    replay.label.trim() !== "" &&
    typeof finding === "object" &&
    finding !== null &&
    typeof finding.transactionId === "string" &&
    typeof finding.label === "string" &&
    typeof finding.at === "string" &&
    Number.isInteger(finding.amountCents)
  );
}

export function createHttpTransport(options: HttpTransportOptions = {}): BoardTransport {
  const fetchImpl = (url: string, init?: RequestInit) => (options.fetch ?? globalThis.fetch.bind(globalThis))(url, init);
  let session: Promise<void> | null = null;

  /** One session request for every caller that hit a 401 while it is in flight. */
  const ensureSession = () => {
    session ??= (async () => {
      const response = await fetchImpl(API.session, { method: "POST", headers: { Accept: "application/json" }, credentials: "same-origin" });
      if (!response.ok) {
        const { message } = await readError(response);
        throw new BoardViewError(message, response.status);
      }
    })().finally(() => {
      session = null;
    });
    return session;
  };

  /** Sends once; on a 401 gets a session and sends once more. */
  const send = async (url: string, init: RequestInit): Promise<Response> => {
    const call = () => fetchImpl(url, { ...init, credentials: "same-origin" });
    const first = await call();
    if (first.status !== 401) return first;
    await ensureSession();
    return call();
  };

  /** POSTs JSON; an HTTP error or an unreadable answer comes back as data, never thrown. */
  const postJson = async <T>(url: string, body: unknown, read: (payload: unknown) => T | null): Promise<{ ok: true; value: T } | ActionFailure> => {
    let response: Response;
    try {
      response = await send(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
      });
    } catch (error) {
      if (error instanceof BoardViewError) return { ok: false, status: error.status, code: "no_session", message: error.message };
      return { ok: false, status: 0, code: "network", message: UNREACHABLE };
    }
    if (!response.ok) return { ok: false, status: response.status, ...(await readError(response)) };
    const value = read(await response.json().catch(() => null));
    if (value === null) {
      return { ok: false, status: response.status, code: "bad_response", message: "The server's answer was not one this page can read." };
    }
    return { ok: true, value };
  };

  const post = async (url: string, body: unknown): Promise<ActionResult> => {
    const result = await postJson(url, body, (payload) => (isRequestBody(payload) ? payload.request : null));
    return result.ok ? { ok: true, request: result.value } : result;
  };

  return {
    async getView() {
      let response: Response;
      try {
        response = await send(API.ledgerView, { method: "GET", headers: { Accept: "application/json" } });
      } catch (error) {
        if (error instanceof BoardViewError) throw error;
        throw new BoardViewError("Couldn't reach the server.");
      }
      if (!response.ok) throw new BoardViewError((await readError(response)).message, response.status);
      const payload: unknown = await response.json().catch(() => null);
      if (!isBoardView(payload)) throw new BoardViewError("The board's data came back in a shape this page can't read.", response.status);
      return payload;
    },
    createRequest: (body) => post(API.payoutRequests, body),
    sign: (requestId, body) => post(API.sign(requestId), body),
    sendBack: (requestId, body) => post(API.sendBack(requestId), body),
    assessRisk: (requestId) => post(API.risk(requestId), {}),
    async replayOutsideSend() {
      const result = await postJson(WATCHTOWER_API.replay, {}, (payload) => (isWatchReplay(payload) ? payload : null));
      return result.ok ? { ok: true, replay: result.value } : result;
    },
  };
}
