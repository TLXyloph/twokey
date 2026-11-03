"use client";

/**
 * The board's one primary action: select the "Waiting for a second key" widget in Studio and bring
 * it into view. Studio loads in the browser after the header, so until it is ready the button stays
 * legible but inert, and says why to assistive tech.
 */
import { useSyncExternalStore } from "react";
import { focusSecondKeyQueue, isStudioReady, subscribeStudioReady } from "./studio-handle";

const LOADING_NOTE_ID = "board-review-loading";

export function ReviewButton({ label }: { label: string }) {
  const ready = useSyncExternalStore(subscribeStudioReady, isStudioReady, () => false);
  return (
    <>
      <button
        type="button"
        className="board-button"
        aria-disabled={ready ? undefined : true}
        aria-describedby={ready ? undefined : LOADING_NOTE_ID}
        onClick={() => {
          if (ready) focusSecondKeyQueue();
        }}
      >
        {label}
      </button>
      {!ready && (
        <span id={LOADING_NOTE_ID} className="board-visually-hidden">
          The dashboard is still loading.
        </span>
      )}
    </>
  );
}
