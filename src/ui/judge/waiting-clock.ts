/**
 * The elapsed time on the pending "PayPal confirmed" step: "Waiting · 0:23", counted in the browser
 * from the "Sent to PayPal" time and updated once a second until PayPal confirms. Client-only and
 * display-only: nothing is stored or sent.
 *
 * The ticker schedules each update for the moment the next whole second of the wait begins, from
 * the clock's own reading, so a timer that fires late never skips a second or shows one twice.
 */

/** "0:23" under an hour; "1:05:07" from an hour on. Never below zero. */
export function formatElapsed(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  const seconds = String(total % 60).padStart(2, "0");
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}

/** The pending row's label: "Waiting · 0:23", or just "Waiting" without a usable start time. */
export function waitingLabel(since: string, now: Date): string {
  const start = Date.parse(since);
  return Number.isNaN(start) ? "Waiting" : `Waiting · ${formatElapsed(now.getTime() - start)}`;
}

export interface TickerClock {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const browserClock: TickerClock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Calls `onTick` with the elapsed time since `sinceMs` now, then each time it changes. Returns the
 * function that stops it.
 */
export function startElapsedTicker(sinceMs: number, onTick: (elapsed: string) => void, clock: TickerClock = browserClock): () => void {
  let handle: unknown = null;
  let stopped = false;
  let shown: string | null = null;

  const tick = () => {
    if (stopped) return;
    const elapsed = clock.now() - sinceMs;
    const label = formatElapsed(elapsed);
    if (label !== shown) {
      shown = label;
      onTick(label);
    }
    // Until the wait is under way, count from its start; then aim for the next whole second.
    const toNextSecond = elapsed < 0 ? -elapsed : 1000 - (elapsed % 1000);
    handle = clock.setTimeout(tick, Math.max(1, toNextSecond));
  };

  tick();
  return () => {
    stopped = true;
    if (handle !== null) clock.clearTimeout(handle);
    handle = null;
  };
}
