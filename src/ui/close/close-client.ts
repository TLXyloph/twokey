/**
 * The close screen's live part: this judge session's sign-off (GET /api/close) and the sign action
 * (POST /api/close/sign), as a small external store the screen reads with `useSyncExternalStore`.
 * The figures and the draft are server-rendered (they come from the seed, the same for everyone);
 * only the sign-off is per session.
 *
 * Every route needs the judge-session cookie. A call answered 401 gets a session from
 * /api/ai/session and is sent once more, the same pattern as the board (src/ui/judge/http-transport.ts).
 * Actions never throw on an HTTP error: a refusal is data the screen shows, inline.
 */
import { CLOSE_API, CLOSE_MONTH, type CloseSignoffView, type CloseView } from "@/close/contracts";
import { API, type ActingRole } from "@/ledger/contracts";

export type SignAttempt = { ok: true; signoff: CloseSignoffView; duplicate: boolean } | { ok: false; status: number; code: string; message: string };

export interface CloseTransport {
  getView(): Promise<CloseView>;
  sign(actingAs: ActingRole): Promise<SignAttempt>;
}

/** A sign attempt the server refused (or couldn't take), kept in page memory: nothing is recorded. */
export interface SignFailure {
  id: number;
  role: ActingRole;
  /** Client time (ms). */
  at: number;
  code: string;
  message: string;
}

export interface CloseSnapshot {
  /** Null until the first read lands. */
  view: CloseView | null;
  /** This session's sign-off: from the read, or from a sign action on this page (which wins). */
  signoff: CloseSignoffView | null;
  loading: boolean;
  /** The last read's failure, in a plain sentence. */
  error: string | null;
  signing: boolean;
  /** Newest first, at most three. */
  failures: readonly SignFailure[];
  /** True when the sign-off on screen was made by a click on this page (it lands with motion). */
  fresh: boolean;
}

export const EMPTY_CLOSE: CloseSnapshot = Object.freeze({ view: null, signoff: null, loading: false, error: null, signing: false, failures: Object.freeze([]), fresh: false });
export const MAX_FAILURES = 3;

const UNREACHABLE = "Couldn't reach the server. Check the connection and try again.";

export class CloseReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CloseReadError";
  }
}

async function readError(response: Response): Promise<{ code: string; message: string }> {
  try {
    const body = (await response.json()) as { error?: { code?: unknown; message?: unknown } };
    const { code, message } = body.error ?? {};
    if (typeof message === "string" && message.trim() !== "") return { code: typeof code === "string" ? code : `http_${response.status}`, message };
  } catch {
    // Not JSON: fall through to the plain sentence.
  }
  return { code: `http_${response.status}`, message: `The server couldn't do that just now (error ${response.status}). Try again in a moment.` };
}

const isSignoff = (value: unknown): value is CloseSignoffView => {
  const s = value as Partial<CloseSignoffView> | null;
  return typeof s === "object" && s !== null && s.role === "reviewer" && typeof s.keyId === "string" && typeof s.signature === "string" && typeof s.signedAt === "string";
};

function isCloseView(value: unknown): value is CloseView {
  const v = value as Partial<CloseView> | null;
  return typeof v === "object" && v !== null && v.month === CLOSE_MONTH && typeof v.closeHash === "string" && typeof v.figures === "object" && (v.signoff === null || isSignoff(v.signoff));
}

export function createHttpCloseTransport(fetchImpl: (url: string, init?: RequestInit) => Promise<Response> = (url, init) => globalThis.fetch(url, init)): CloseTransport {
  let session: Promise<void> | null = null;
  const ensureSession = () => {
    session ??= (async () => {
      const response = await fetchImpl(API.session, { method: "POST", headers: { Accept: "application/json" }, credentials: "same-origin" });
      if (!response.ok) throw new CloseReadError((await readError(response)).message);
    })().finally(() => {
      session = null;
    });
    return session;
  };
  const send = async (url: string, init: RequestInit): Promise<Response> => {
    const call = () => fetchImpl(url, { ...init, credentials: "same-origin" });
    const first = await call();
    if (first.status !== 401) return first;
    await ensureSession();
    return call();
  };

  return {
    async getView() {
      let response: Response;
      try {
        response = await send(CLOSE_API.view(), { method: "GET", headers: { Accept: "application/json" } });
      } catch (error) {
        throw error instanceof CloseReadError ? error : new CloseReadError(UNREACHABLE);
      }
      if (!response.ok) throw new CloseReadError((await readError(response)).message);
      const payload: unknown = await response.json().catch(() => null);
      if (!isCloseView(payload)) throw new CloseReadError("The close came back in a shape this page can't read.");
      return payload;
    },
    async sign(actingAs) {
      let response: Response;
      try {
        response = await send(CLOSE_API.sign, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ actingAs, month: CLOSE_MONTH }),
        });
      } catch (error) {
        return { ok: false, status: 0, code: error instanceof CloseReadError ? "no_session" : "network", message: error instanceof CloseReadError ? error.message : UNREACHABLE };
      }
      if (!response.ok) return { ok: false, status: response.status, ...(await readError(response)) };
      const payload = (await response.json().catch(() => null)) as { signoff?: unknown; duplicate?: unknown } | null;
      if (!payload || !isSignoff(payload.signoff)) {
        return { ok: false, status: response.status, code: "bad_response", message: "The server's answer was not one this page can read." };
      }
      return { ok: true, signoff: payload.signoff, duplicate: payload.duplicate === true };
    },
  };
}

export interface CloseClient {
  subscribe(listener: () => void): () => void;
  getSnapshot(): CloseSnapshot;
  refresh(): Promise<void>;
  sign(role: ActingRole): Promise<SignAttempt>;
}

export function createCloseClient(options: { transport: CloseTransport; now?: () => number }): CloseClient {
  const now = options.now ?? Date.now;
  const listeners = new Set<() => void>();
  let snapshot: CloseSnapshot = EMPTY_CLOSE;
  let nextId = 1;
  let reading: Promise<void> | null = null;
  const set = (patch: Partial<CloseSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    for (const listener of [...listeners]) listener();
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    refresh() {
      reading ??= (async () => {
        set({ loading: true });
        try {
          const view = await options.transport.getView();
          // A sign-off made on this page while the read was in flight wins over an older read.
          set({ view, signoff: snapshot.signoff ?? view.signoff, loading: false, error: null });
        } catch (error) {
          set({ loading: false, error: error instanceof Error ? error.message : UNREACHABLE });
        } finally {
          reading = null;
        }
      })();
      return reading;
    },
    async sign(role) {
      if (snapshot.signing) return { ok: false, status: 0, code: "busy", message: "Already signing." };
      set({ signing: true });
      const result = await options.transport.sign(role);
      if (result.ok) {
        // A duplicate was already signed (in another tab, say): it shows without the landing.
        set({ signing: false, signoff: result.signoff, fresh: !result.duplicate });
      } else {
        const failure: SignFailure = { id: nextId++, role, at: now(), code: result.code, message: result.message };
        set({ signing: false, failures: [failure, ...snapshot.failures].slice(0, MAX_FAILURES) });
      }
      return result;
    },
  };
}
