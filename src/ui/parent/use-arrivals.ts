/**
 * Which rows just arrived: ids in this render that the list had not shown before, once the session's
 * own view is live. Worked out during render (React's derived-state pattern), so a new row's very
 * first frame already carries its mark and its entrance can start from @starting-style. Rows present
 * at the first live view never count: a parent opening the page sees no animation for old payments.
 * The last arrivals keep their mark until the next change.
 */
import { useState } from "react";

interface ArrivalState {
  key: string;
  seen: ReadonlySet<string> | null;
  arrived: ReadonlySet<string>;
}

const NONE: ReadonlySet<string> = new Set();

/** The pure step, for tests: the next state for this render's ids. */
export function nextArrivals(state: ArrivalState, ids: readonly string[], live: boolean): ArrivalState {
  const key = ids.join("\u0000");
  if (!live || key === state.key) return state;
  if (state.seen === null) return { key, seen: new Set(ids), arrived: NONE };
  const fresh = ids.filter((id) => !state.seen!.has(id));
  return { key, seen: new Set([...state.seen, ...ids]), arrived: fresh.length > 0 ? new Set(fresh) : state.arrived };
}

export const EMPTY_ARRIVALS: ArrivalState = { key: "", seen: null, arrived: NONE };

export function useArrivals(ids: readonly string[], live: boolean): ReadonlySet<string> {
  const [state, setState] = useState<ArrivalState>(EMPTY_ARRIVALS);
  const next = nextArrivals(state, ids, live);
  if (next !== state) setState(next);
  return next.arrived;
}
