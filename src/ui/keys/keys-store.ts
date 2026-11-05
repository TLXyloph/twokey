/**
 * How many key-setup steps the judge has marked done (0 to 5, always in order). Demo data, client
 * state only: nothing goes to the server or to PayPal.
 *
 * Kept per tab in sessionStorage, like the acting role, so a reload keeps the judge's place and a
 * second tab starts from "before". Storage can be blocked (private windows, embedded previews), so
 * every access is guarded and the steps still work in memory. "Start over" in the judge band clears
 * it with the session.
 */
import { STEP_COUNT } from "./keys-content";
import { clampSteps } from "./keys-model";

export const KEY_STEPS_STORAGE_KEY = "twokey.keys.steps";

type StepStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface KeyStepsStore {
  get(): number;
  /** Marks the next step done. */
  advance(): void;
  /** Undoes the last step done. */
  back(): void;
  reset(): void;
  subscribe(listener: () => void): () => void;
}

export interface KeyStepsStoreOptions {
  storage: () => StepStorage | null;
  /** A starting count when storage holds none (development screenshots: `?steps=5`). */
  initial?: () => number | null;
}

export function createKeyStepsStore({ storage, initial }: KeyStepsStoreOptions): KeyStepsStore {
  let done: number | null = null;
  const listeners = new Set<() => void>();

  const read = (): number => {
    try {
      const stored = storage()?.getItem(KEY_STEPS_STORAGE_KEY);
      if (stored !== null && stored !== undefined) return clampSteps(stored);
    } catch {
      // Blocked storage: fall through to the starting count.
    }
    return clampSteps(initial?.() ?? 0);
  };

  const set = (next: number) => {
    const value = clampSteps(next);
    if (value === done) return;
    done = value;
    try {
      if (value === 0) storage()?.removeItem(KEY_STEPS_STORAGE_KEY);
      else storage()?.setItem(KEY_STEPS_STORAGE_KEY, String(value));
    } catch {
      // Blocked storage: the steps last until the page reloads.
    }
    for (const listener of [...listeners]) listener();
  };

  const get = () => (done ??= read());

  return {
    get,
    advance: () => set(Math.min(get() + 1, STEP_COUNT)),
    back: () => set(Math.max(get() - 1, 0)),
    reset: () => set(0),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** A development URL flag for screenshots: `?steps=3` starts the checklist with three steps done. */
export const wantsSteps = (search: string): number | null => {
  const raw = new URLSearchParams(search).get("steps");
  return raw === null ? null : clampSteps(raw);
};

function browserInitial(): number | null {
  if (process.env.NODE_ENV !== "production") return wantsSteps(window.location.search);
  return null;
}

/** The page's one store. On the server there is no storage, so it reads 0 ("before"). */
export const keyStepsStore = createKeyStepsStore({
  storage: () => (typeof window === "undefined" ? null : window.sessionStorage),
  initial: () => (typeof window === "undefined" ? null : browserInitial()),
});

/** Forgets the steps in this tab's storage without a store (the band's "Start over" runs on every page). */
export function clearStoredKeySteps(storage: Pick<Storage, "removeItem"> | null): void {
  try {
    storage?.removeItem(KEY_STEPS_STORAGE_KEY);
  } catch {
    // Blocked storage: nothing was kept.
  }
}
