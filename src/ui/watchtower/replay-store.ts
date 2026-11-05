/**
 * Judge mode's "Replay an outside send": asks the server to run a recorded real sandbox event through
 * the Watchtower's classifier again (POST WATCHTOWER_API.replay; nothing is stored there) and holds
 * the answer as one labelled alert on the board until the judge dismisses it.
 *
 * Page memory only: nothing persists, so a reload shows the board as it really is. One replay at a
 * time; a second click while one is running shares it, and a new answer replaces the shown one (so it
 * arrives again rather than stacking copies down the header).
 */
import type { ReplayResult } from "@/ui/judge/http-transport";
import type { WatchFinding } from "@/watchtower/contracts";

export interface ReplayedAlert {
  /** Unique per arrival, so a repeat replay mounts (and arrives) afresh. */
  id: string;
  /** The server's label: "Replay of a real sandbox event: …". */
  label: string;
  finding: WatchFinding;
}

export interface ReplaySnapshot {
  running: boolean;
  /** The last replay's failure, in a plain sentence; cleared by the next try. */
  error: string | null;
  alert: ReplayedAlert | null;
}

export interface ReplayStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): ReplaySnapshot;
  replay(): Promise<ReplayResult>;
  dismiss(id: string): void;
}

export const EMPTY_REPLAY: ReplaySnapshot = Object.freeze({ running: false, error: null, alert: null });

const FAILED = "Couldn't replay the outside send. Try again in a moment.";

export function createReplayStore(options: { replay: () => Promise<ReplayResult> }): ReplayStore {
  let snapshot: ReplaySnapshot = EMPTY_REPLAY;
  let inFlight: Promise<ReplayResult> | null = null;
  let arrivals = 0;
  const listeners = new Set<() => void>();

  const set = (patch: Partial<ReplaySnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    for (const listener of [...listeners]) listener();
  };

  const run = async (): Promise<ReplayResult> => {
    set({ running: true, error: null });
    let result: ReplayResult;
    try {
      result = await options.replay();
    } catch {
      result = { ok: false, status: 0, code: "network", message: FAILED };
    }
    if (result.ok) {
      arrivals += 1;
      set({ running: false, alert: { id: `replay-${arrivals}`, label: result.replay.label, finding: result.replay.finding } });
    } else {
      set({ running: false, error: result.message || FAILED });
    }
    return result;
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    replay() {
      inFlight ??= run().finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
    dismiss(id) {
      if (snapshot.alert?.id === id) set({ alert: null });
    },
  };
}
