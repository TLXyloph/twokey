"use client";

/**
 * The Watchtower's status line, at the right end of the board header's scope row, for every role:
 * "Watchtower checked PayPal at 10:20 AM · PayPal's records as of 2:59 AM CST", plus one plain
 * sentence when the status isn't ok. A small mark carries the tone (grey, amber, maroon); the words
 * carry the meaning. Until the first board view lands, a flat bar holds the line's place.
 */
import type { WatchtowerView } from "@/watchtower/contracts";
import { keepTimesTogether, statusLine } from "./watch-model";
import { useWatchtower } from "./use-watchtower";
import "./watchtower.css";

export function WatchStatusLine({ watch, now = new Date() }: { watch: WatchtowerView | null | "loading"; now?: Date }) {
  if (watch === "loading") {
    return (
      <p className="watch-status" data-loading="">
        <span className="watch-status__bar" aria-hidden="true" />
        <span className="board-visually-hidden">Loading the Watchtower's status</span>
      </p>
    );
  }
  const line = statusLine(watch, now);
  return (
    <p className="watch-status" data-tone={line.tone}>
      <span className="watch-mark" aria-hidden="true" />
      <span className="watch-status__text">
        {line.stamp ? <span className="watch-status__stamp">{keepTimesTogether(line.sentence ? `${line.stamp}.` : line.stamp)}</span> : null}
        {line.stamp && line.sentence ? " " : null}
        {line.sentence ? <span className="watch-status__sentence">{keepTimesTogether(line.sentence)}</span> : null}
      </span>
    </p>
  );
}

export function WatchtowerStatus() {
  return <WatchStatusLine watch={useWatchtower()} />;
}
