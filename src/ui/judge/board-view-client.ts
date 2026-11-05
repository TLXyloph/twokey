/**
 * The board's live data: the session's `BoardView` (GET /api/ledger/view), as a small external store
 * the header, the drawer and Studio read with `useSyncExternalStore`.
 *
 * Polling rules (spec §6):
 *   - every 3 s while the drawer is open, or while a payout is sent but not yet confirmed by PayPal;
 *   - otherwise only on window focus;
 *   - never while the page is hidden (it catches up when shown);
 *   - one read at a time; a read that started before an action landed is dropped, so the board
 *     never steps back to the state before the judge's click.
 *
 * A poll that brings the same view keeps the previous snapshot (and the board data's identity), so
 * React re-renders nothing and Studio reloads nothing.
 */
import type { ActingRole, BoardView, CreatePayoutRequestBody, PayoutRequestView, RefusalCode, SignBody } from "@/ledger/contracts";
import type { ActionResult, BoardTransport } from "./http-transport";

export const POLL_INTERVAL_MS = 3_000;

export type RiskReadState = "running" | "done" | "failed";

/** The latest sign action on a request, kept until the view records it. */
export interface SignOutcome {
  role: ActingRole;
  /** Client time of the action (ms). */
  at: number;
  /** How many refusals the view held when the judge clicked: a new one means the ledger has it. */
  refusalsBefore: number;
  result: ActionResult;
}

export interface BoardViewSnapshot {
  /** Null until the first view arrives; the board shows its seed data until then. */
  view: BoardView | null;
  loading: boolean;
  /** The last read's failure, kept beside the last good view. */
  error: string | null;
  riskReads: Readonly<Record<string, RiskReadState>>;
  /** Requests with a sign action in flight. */
  busy: Readonly<Record<string, true>>;
  outcomes: Readonly<Record<string, SignOutcome>>;
}

export interface BoardViewClient {
  subscribe(listener: () => void): () => void;
  getSnapshot(): BoardViewSnapshot;
  refresh(): Promise<void>;
  setDrawerOpen(open: boolean): void;
  setPageVisible(visible: boolean): void;
  windowFocused(): void;
  isPolling(): boolean;
  sign(requestId: string, body: SignBody): Promise<ActionResult>;
  createRequest(body: CreatePayoutRequestBody): Promise<ActionResult>;
  /** Asks the server for the AI's receipt read once per request per page (spec §4). */
  assessRiskOnce(requestId: string): void;
  dispose(): void;
}

export interface Timers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const globalTimers: Timers = {
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export const EMPTY_SNAPSHOT: BoardViewSnapshot = Object.freeze({
  view: null,
  loading: false,
  error: null,
  riskReads: Object.freeze({}),
  busy: Object.freeze({}),
  outcomes: Object.freeze({}),
});

/** A payout PayPal has accepted but not yet confirmed (its webhook hasn't landed). */
export const payoutInFlight = (view: BoardView | null) => view?.requests.some((r) => r.status === "sent") ?? false;

export function shouldPoll(state: { drawerOpen: boolean; pageVisible: boolean; view: BoardView | null }): boolean {
  return state.pageVisible && (state.drawerOpen || payoutInFlight(state.view));
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The next view, sharing the previous one's objects where nothing changed. */
export function mergeView(prev: BoardView | null, next: BoardView): BoardView {
  if (prev === null) return next;
  if (sameJson(prev, next)) return prev;
  return sameJson(prev.data, next.data) ? { ...next, data: prev.data } : next;
}

/** The view with an action's request in place (or first, when it is new). */
export function withRequest(view: BoardView, request: PayoutRequestView): BoardView {
  const index = view.requests.findIndex((r) => r.requestId === request.requestId);
  const requests = index === -1 ? [request, ...view.requests] : view.requests.map((r, i) => (i === index ? request : r));
  return { ...view, requests };
}

const LIMIT_CODES = new Set(["over_payout_cap", "session_payout_limit", "daily_payout_limit"]);

/**
 * The outcome the drawer still has to show inline: a refusal until the ledger's copy appears in the
 * request's refusals, or a limit (recorded as a block, not a refusal). Null after a success.
 */
export function unrecordedOutcome(request: PayoutRequestView, outcome: SignOutcome | undefined): SignOutcome | null {
  if (!outcome || outcome.result.ok) return null;
  if (LIMIT_CODES.has(outcome.result.code)) return outcome;
  const code = outcome.result.code as RefusalCode;
  const recorded = request.refusals.slice(outcome.refusalsBefore).some((r) => r.code === code && r.role === outcome.role);
  return recorded ? null : outcome;
}

const messageOf = (error: unknown) => (error instanceof Error && error.message ? error.message : "Couldn't load the board.");

export interface BoardViewClientOptions {
  transport: BoardTransport;
  timers?: Timers;
  pollMs?: number;
  now?: () => number;
}

export function createBoardViewClient({ transport, timers = globalTimers, pollMs = POLL_INTERVAL_MS, now = Date.now }: BoardViewClientOptions): BoardViewClient {
  let snapshot: BoardViewSnapshot = EMPTY_SNAPSHOT;
  const listeners = new Set<() => void>();
  let drawerOpen = false;
  let pageVisible = true;
  let disposed = false;
  let timer: unknown = null;
  /** Bumped whenever an action puts a request into the view; reads started earlier are dropped. */
  let epoch = 0;
  let current: { epoch: number; promise?: Promise<void> } | null = null;

  const set = (patch: Partial<BoardViewSnapshot>) => {
    const next = { ...snapshot, ...patch };
    if ((Object.keys(patch) as (keyof BoardViewSnapshot)[]).every((key) => next[key] === snapshot[key])) return;
    snapshot = next;
    for (const listener of [...listeners]) listener();
  };

  const clearTimer = () => {
    if (timer !== null) timers.clearTimeout(timer);
    timer = null;
  };

  const polling = () => !disposed && shouldPoll({ drawerOpen, pageVisible, view: snapshot.view });

  const schedule = () => {
    if (!polling()) return clearTimer();
    if (timer !== null || current !== null) return;
    timer = timers.setTimeout(() => {
      timer = null;
      void refresh();
    }, pollMs);
  };

  function refresh(): Promise<void> {
    if (disposed) return Promise.resolve();
    if (current && current.epoch === epoch && current.promise) return current.promise;
    clearTimer();
    const run: { epoch: number; promise?: Promise<void> } = { epoch };
    current = run;
    set({ loading: true });
    run.promise = (async () => {
      try {
        const next = await transport.getView();
        if (disposed || run.epoch !== epoch) return;
        set({ view: mergeView(snapshot.view, next), error: null, loading: false });
      } catch (error) {
        if (disposed || run.epoch !== epoch) return;
        set({ error: messageOf(error), loading: false });
      } finally {
        if (current === run) current = null;
        schedule();
      }
    })();
    return run.promise;
  }

  const applyRequest = (request: PayoutRequestView) => {
    epoch += 1;
    if (snapshot.view) set({ view: withRequest(snapshot.view, request) });
  };

  const without = <T>(record: Readonly<Record<string, T>>, key: string) => {
    const { [key]: _removed, ...rest } = record;
    return rest;
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    refresh,
    setDrawerOpen(open) {
      if (open === drawerOpen) return;
      drawerOpen = open;
      if (open) void refresh();
      else schedule();
    },
    setPageVisible(visible) {
      if (visible === pageVisible) return;
      pageVisible = visible;
      if (visible) void refresh();
      else schedule();
    },
    windowFocused() {
      if (!polling()) void refresh();
    },
    isPolling: () => polling(),
    async sign(requestId, body) {
      const before = snapshot.view?.requests.find((r) => r.requestId === requestId);
      set({ busy: { ...snapshot.busy, [requestId]: true } });
      const result = await transport.sign(requestId, body);
      if (result.ok) applyRequest(result.request);
      const outcome: SignOutcome = { role: body.actingAs, at: now(), refusalsBefore: before?.refusals.length ?? 0, result };
      set({ busy: without(snapshot.busy, requestId), outcomes: { ...snapshot.outcomes, [requestId]: outcome } });
      // A refusal or a block is recorded in the ledger as well: read it back.
      void refresh();
      return result;
    },
    async createRequest(body) {
      const result = await transport.createRequest(body);
      if (result.ok) {
        applyRequest(result.request);
        void refresh();
      }
      return result;
    },
    assessRiskOnce(requestId) {
      if (snapshot.riskReads[requestId]) return;
      set({ riskReads: { ...snapshot.riskReads, [requestId]: "running" } });
      void transport.assessRisk(requestId).then(
        (result) => {
          if (result.ok) applyRequest(result.request);
          set({ riskReads: { ...snapshot.riskReads, [requestId]: result.ok ? "done" : "failed" } });
          if (result.ok) void refresh();
        },
        () => set({ riskReads: { ...snapshot.riskReads, [requestId]: "failed" } }),
      );
    },
    dispose() {
      disposed = true;
      clearTimer();
      listeners.clear();
    },
  };
}
