"use client";

/**
 * "Replay an outside send", in the judge band: runs the recorded real sandbox send through the
 * Watchtower's classifier again (the server stores nothing) and shows it arriving on the board as a
 * labelled alert. While it runs the button stays put (same label, same width) and its glyph turns; a
 * failure is one plain sentence beside it.
 */
import { ReplayGlyph } from "@/ui/judge/glyphs";
import { replayStore, useReplay } from "./use-watchtower";
import "./watchtower.css";

export const REPLAY_BUTTON_ID = "watch-replay-button";
export const REPLAY_BUTTON_LABEL = "Replay an outside send";

export function ReplayButtonView({ running, error, onReplay }: { running: boolean; error: string | null; onReplay: () => void }) {
  return (
    <div className="watch-replay">
      <button
        id={REPLAY_BUTTON_ID}
        type="button"
        className="watch-replay__button"
        aria-disabled={running || undefined}
        aria-busy={running || undefined}
        onClick={() => {
          if (!running) onReplay();
        }}
      >
        <ReplayGlyph />
        {REPLAY_BUTTON_LABEL}
      </button>
      {error ? (
        <p className="watch-replay__error" role="status">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function ReplayButton() {
  const { running, error } = useReplay();
  return <ReplayButtonView running={running} error={error} onReplay={() => void replayStore()?.replay()} />;
}
