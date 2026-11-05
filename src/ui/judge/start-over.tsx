"use client";

/**
 * "Start over", at the band's right end beside "Replay an outside send". The confirm is inline:
 * the first press swaps that pair for "Start from the seed?" with the real button and a
 * Cancel, in the same grid cell, so the band never changes width or wraps. Cancel sits where the
 * first button was, so a double click lands on it. Escape cancels; focus follows each swap.
 */
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { KEY_STEPS_STORAGE_KEY } from "@/ui/keys/keys-store";
import { wantsFixture } from "./board-view-source";
import { createResetStore, IDLE_RESET, postReset, type ResetResult, type ResetSnapshot, type ResetStore } from "./reset-store";

let store: ResetStore | null = null;

function browserReset(): Promise<ResetResult> {
  if (process.env.NODE_ENV !== "production") {
    // `?fixture=1`: no backend. The fixture's state lives in the page, so the reload is the reset.
    if (wantsFixture(window.location.search)) return new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 250));
  }
  return postReset();
}

function afterReset() {
  try {
    window.sessionStorage.removeItem(KEY_STEPS_STORAGE_KEY);
  } catch {
    // Blocked storage: nothing was kept.
  }
  window.location.reload();
}

function resetStore(): ResetStore | null {
  if (typeof window === "undefined") return null;
  store ??= createResetStore({ reset: browserReset, afterReset });
  return store;
}

const noSubscription = () => () => {};

function useReset(): ResetSnapshot {
  const reset = resetStore();
  return useSyncExternalStore(reset ? reset.subscribe : noSubscription, reset ? reset.getSnapshot : () => IDLE_RESET, () => IDLE_RESET);
}

export const START_OVER_LABEL = "Start over";
export const START_OVER_QUESTION = "Start from the seed?";

export interface StartOverViewProps {
  snapshot: ResetSnapshot;
  onAsk(): void;
  onCancel(): void;
  onConfirm(): void;
  /** What shares the cell while the confirm is closed: the replay button. */
  children?: ReactNode;
}

export function StartOverView({ snapshot, onAsk, onCancel, onConfirm, children }: StartOverViewProps) {
  const asking = snapshot.phase !== "idle";
  const running = snapshot.phase === "running";
  const startRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const wasAsking = useRef(asking);

  useEffect(() => {
    if (asking && !wasAsking.current) confirmRef.current?.focus();
    if (!asking && wasAsking.current) startRef.current?.focus();
    wasAsking.current = asking;
  }, [asking]);

  return (
    <div className="judge-actions">
      <div className="judge-actions__set" data-shown={asking ? undefined : ""} inert={asking}>
        {children}
        <button ref={startRef} type="button" className="judge-quiet-button" onClick={onAsk}>
          {START_OVER_LABEL}
        </button>
      </div>
      <div
        className="judge-actions__set"
        data-shown={asking ? "" : undefined}
        inert={!asking}
        role="group"
        aria-label="Start over"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !running) onCancel();
        }}
      >
        <span className="judge-actions__question">{START_OVER_QUESTION}</span>
        <button
          ref={confirmRef}
          type="button"
          className="judge-confirm-button"
          aria-busy={running || undefined}
          aria-disabled={running || undefined}
          onClick={() => {
            if (!running) onConfirm();
          }}
        >
          {running ? "Starting over…" : START_OVER_LABEL}
        </button>
        <button type="button" className="judge-quiet-button" aria-disabled={running || undefined} onClick={() => !running && onCancel()}>
          Cancel
        </button>
      </div>
      {snapshot.error ? (
        <p className="judge-actions__error" role="status">
          {snapshot.error}
        </p>
      ) : null}
    </div>
  );
}

export function StartOver({ children }: { children?: ReactNode }) {
  const snapshot = useReset();
  return (
    <StartOverView
      snapshot={snapshot}
      onAsk={() => resetStore()?.ask()}
      onCancel={() => resetStore()?.cancel()}
      onConfirm={() => void resetStore()?.confirm()}
    >
      {children}
    </StartOverView>
  );
}
