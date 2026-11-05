/**
 * React's view of the parent ledger's data: the session's club data from the live board view (the
 * same store the board reads, src/ui/judge/board-view-client.ts, with its session retry and polling
 * rules), the Watchtower as a parent may see it, and the replayed alert. The server and hydration see
 * the seed (src/demo/riverbend.ts), so the first paint is the seed and matches the server's markup.
 */
import { useMemo, useSyncExternalStore } from "react";
import { riverbend, type ClubDemoData } from "@/demo/riverbend";
import type { BoardViewSnapshot } from "@/ui/judge/board-view-client";
import { useBoardView } from "@/ui/judge/use-judge";
import { useReplay, useWatchtower } from "@/ui/watchtower/use-watchtower";
import type { WatchtowerView } from "@/watchtower/contracts";
import type { ReplayedAlert } from "@/ui/watchtower/replay-store";
import { parentFinding, parentWatch } from "./parent-model";

// --- A transform on the club data (development only: the simulated ticket, ./dev/arrival.ts) -----

type DataTransform = (data: ClubDemoData) => ClubDemoData;
let transform: DataTransform | null = null;
const transformListeners = new Set<() => void>();
/** One transformed object per source object, so Studio is pushed each change once. */
let transformed = new WeakMap<ClubDemoData, ClubDemoData>();

export const dataTransform = {
  set(next: DataTransform | null) {
    transform = next;
    transformed = new WeakMap();
    for (const listener of [...transformListeners]) listener();
  },
  get: () => transform,
  subscribe(listener: () => void) {
    transformListeners.add(listener);
    return () => {
      transformListeners.delete(listener);
    };
  },
};

function applyTransform(data: ClubDemoData): ClubDemoData {
  if (!transform) return data;
  let out = transformed.get(data);
  if (!out) {
    out = transform(data);
    transformed.set(data, out);
  }
  return out;
}

/** The club data a parent sees for a snapshot: the live view's, or the seed until it arrives. */
export const clubDataOf = (snapshot: Pick<BoardViewSnapshot, "view">): ClubDemoData => applyTransform(snapshot.view?.data ?? riverbend);

export interface ClubData {
  data: ClubDemoData;
  /** True once the session's own view has arrived (before that the page shows the seed). */
  live: boolean;
}

export function useClubData(): ClubData {
  const snapshot = useBoardView();
  const current = useSyncExternalStore(dataTransform.subscribe, dataTransform.get, () => null);
  const view = snapshot.view;
  // `current` is read through clubDataOf; it is a dependency so the memo re-runs when it arrives.
  return useMemo(() => ({ data: current ? clubDataOf({ view }) : (view?.data ?? riverbend), live: view !== null }), [view, current]);
}

/** The Watchtower without what a parent may not see; "loading" until the first view. */
export function useParentWatchtower(): WatchtowerView | null | "loading" {
  const watch = useWatchtower();
  return useMemo(() => (watch === "loading" ? watch : parentWatch(watch)), [watch]);
}

/** A replayed outside send (judge mode), with the same cleaning as a real finding. */
export function useParentReplay(): ReplayedAlert | null {
  const { alert } = useReplay();
  return useMemo(() => (alert ? { ...alert, finding: parentFinding(alert.finding) } : null), [alert]);
}
