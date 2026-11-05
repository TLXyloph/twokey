/**
 * "Start over" in the judge band: an inline two-step confirm (no browser dialog), then
 * `POST /api/judge/reset`, which hands this browser a fresh judge session; the page then reloads,
 * and the board opens from the seed. The old session's events stay in the ledger.
 *
 *   idle --ask--> confirming --confirm--> running --ok--> (cleared, reloaded)
 *                     |                       \--refused--> failed (the server's plain sentence)
 *                     \--cancel--> idle
 *
 * A 401 means there is no session to start over (it expired, or none was ever issued); the reload
 * then opens a fresh one from the seed, so it counts as done. The server's 429 (the network's cap
 * on new sessions) comes back as its own sentence, and the judge's session is kept.
 */
export const RESET_API = "/api/judge/reset";

export type ResetResult = { ok: true } | { ok: false; status: number; code: string; message: string };

export type ResetPhase = "idle" | "confirming" | "running" | "failed";

export interface ResetSnapshot {
  phase: ResetPhase;
  /** The last failure's sentence, shown until the judge tries again or cancels. */
  error: string | null;
}

export interface ResetStore {
  getSnapshot(): ResetSnapshot;
  subscribe(listener: () => void): () => void;
  ask(): void;
  cancel(): void;
  confirm(): Promise<void>;
}

export const IDLE_RESET: ResetSnapshot = Object.freeze({ phase: "idle", error: null });

export interface ResetStoreDeps {
  reset(): Promise<ResetResult>;
  /** Forget this tab's demo state (the key-setup steps) and reload the page. */
  afterReset(): void;
}

export function createResetStore({ reset, afterReset }: ResetStoreDeps): ResetStore {
  let snapshot: ResetSnapshot = IDLE_RESET;
  const listeners = new Set<() => void>();
  const set = (next: ResetSnapshot) => {
    if (next.phase === snapshot.phase && next.error === snapshot.error) return;
    snapshot = next;
    for (const listener of [...listeners]) listener();
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    ask() {
      if (snapshot.phase === "running") return;
      set({ phase: "confirming", error: null });
    },
    cancel() {
      if (snapshot.phase === "running") return;
      set(IDLE_RESET);
    },
    async confirm() {
      if (snapshot.phase !== "confirming" && snapshot.phase !== "failed") return;
      set({ phase: "running", error: null });
      let result: ResetResult;
      try {
        result = await reset();
      } catch {
        result = { ok: false, status: 0, code: "network", message: UNREACHABLE };
      }
      if (result.ok || result.status === 401) {
        afterReset();
        return;
      }
      set({ phase: "failed", error: result.message });
    },
  };
}

const UNREACHABLE = "Couldn't reach the server, so the demo didn't start over. Check the connection and try again.";

/** POSTs the reset; an HTTP error comes back as data with the server's own sentence. */
export async function postReset(fetchImpl: (url: string, init?: RequestInit) => Promise<Response> = (url, init) => globalThis.fetch(url, init)): Promise<ResetResult> {
  let response: Response;
  try {
    response = await fetchImpl(RESET_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: "{}",
      credentials: "same-origin",
    });
  } catch {
    return { ok: false, status: 0, code: "network", message: UNREACHABLE };
  }
  if (response.ok) return { ok: true };
  let code = `http_${response.status}`;
  let message = `The demo couldn't start over just now (error ${response.status}). Try again in a moment.`;
  try {
    const body = (await response.json()) as { error?: { code?: unknown; message?: unknown } };
    if (typeof body.error?.code === "string") code = body.error.code;
    if (typeof body.error?.message === "string" && body.error.message.trim() !== "") message = body.error.message;
  } catch {
    // Not JSON: the plain sentence stands.
  }
  return { ok: false, status: response.status, code, message };
}
