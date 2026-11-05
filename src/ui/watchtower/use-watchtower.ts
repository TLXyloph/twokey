/**
 * React's view of the Watchtower: its part of the live board view, and the page's one replay store
 * (created in the browser on first use, on the board's own transport, so the judge session and its
 * 401 retry are shared). The server and hydration see "not loaded yet" and no replay.
 */
import { useSyncExternalStore } from "react";
import { boardTransport } from "@/ui/judge/board-view-source";
import { useBoardView } from "@/ui/judge/use-judge";
import type { WatchtowerView } from "@/watchtower/contracts";
import { EMPTY_REPLAY, createReplayStore, type ReplaySnapshot, type ReplayStore } from "./replay-store";

let store: ReplayStore | null = null;

export function replayStore(): ReplayStore | null {
  const transport = boardTransport();
  if (!transport) return null;
  store ??= createReplayStore({ replay: () => transport.replayOutsideSend() });
  return store;
}

const noSubscription = () => () => {};

export function useReplay(): ReplaySnapshot {
  const replays = replayStore();
  return useSyncExternalStore(
    replays ? replays.subscribe : noSubscription,
    replays ? replays.getSnapshot : () => EMPTY_REPLAY,
    () => EMPTY_REPLAY,
  );
}

/**
 * "loading" until the first board view (or its failure) arrives; then the Watchtower's view, or null
 * when the server couldn't read it (or the view came without one).
 */
export function useWatchtower(): WatchtowerView | null | "loading" {
  const { view, error } = useBoardView();
  if (!view) return error ? null : "loading";
  return view.watchtower ?? null;
}
