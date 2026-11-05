"use client";

/**
 * The Watchtower, as parents see it (spec §5.4: "each finding ... appears on the parent ledger with an
 * 'as of' time"): its status line with PayPal's "as of" time, and its alerts, open findings first
 * and in full, explained ones collapsed but never hidden. The board's own components
 * (src/ui/watchtower), fed the parent's cleaned view: no email address ever reaches the page. A replay
 * fired from the judge band arrives here too, labelled as a replay.
 */
import { REPLAY_BUTTON_ID } from "@/ui/watchtower/replay-button";
import { replayStore } from "@/ui/watchtower/use-watchtower";
import { WatchAlertsView } from "@/ui/watchtower/watch-alerts";
import { WatchStatusLine } from "@/ui/watchtower/watch-status";
import { useParentReplay, useParentWatchtower } from "./use-parent";

/** Hands focus back to the judge band's replay button when its alert goes. */
function dismissReplay(id: string) {
  replayStore()?.dismiss(id);
  document.getElementById(REPLAY_BUTTON_ID)?.focus();
}

export function WatchRoom() {
  const watch = useParentWatchtower();
  const replay = useParentReplay();
  return (
    <div className="watch-room" data-ui="">
      <div className="watch-room__status">
        <WatchStatusLine watch={watch} />
      </div>
      <WatchAlertsView watch={watch} replay={replay} onDismissReplay={dismissReplay} initiallyOpen={{ more: true }} />
      {watch !== "loading" && watch && watch.findings.length === 0 && watch.explained.length === 0 ? (
        <p className="watch-room__quiet">The Watchtower has found nothing that left the account without two keys.</p>
      ) : null}
    </div>
  );
}
