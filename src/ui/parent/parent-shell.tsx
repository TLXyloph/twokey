"use client";

/**
 * The parent ledger's wiring to the live session (no markup of its own). It starts the board-view
 * client the board uses (src/ui/judge/board-view-source.ts: the same session cookie and 401 retry),
 * and keeps the client's polling rules (src/ui/judge/board-view-client.ts): a read on load, on window
 * focus and when the page is shown again, and every 3 s while a payout is sent but not yet confirmed.
 * So a ticket bought on the pay page, or a payout sent from the board, shows here as soon as the
 * parent comes back to this tab or window. Each new club data object goes into the parent's Studio.
 *
 * Development only: `?fixture=1` runs the page on the board's in-memory fixture, and `&arrive=1`
 * adds a simulated banquet ticket four seconds in (./dev/arrival.ts), to see the ledger tick.
 */
import { useEffect } from "react";
import { boardViewClient, wantsFixture } from "@/ui/judge/board-view-source";
import { parentStudio } from "./parent-handle";
import { clubDataOf, dataTransform } from "./use-parent";

export const ARRIVAL_DELAY_MS = 4_000;

export function ParentShell() {
  useEffect(() => {
    const client = boardViewClient();
    if (!client) return;

    const push = () => {
      const snapshot = client.getSnapshot();
      // Studio starts on the seed; it needs nothing until the session's own view (or the dev ticket) arrives.
      if (snapshot.view || dataTransform.get()) parentStudio.push(clubDataOf(snapshot));
    };
    const onFocus = () => client.windowFocused();
    const onVisibility = () => client.setPageVisible(document.visibilityState !== "hidden");

    const unsubscribeView = client.subscribe(push);
    const unsubscribeTransform = dataTransform.subscribe(push);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    push();
    void client.refresh();

    let arrival: ReturnType<typeof setTimeout> | undefined;
    if (process.env.NODE_ENV !== "production") {
      const search = new URLSearchParams(window.location.search);
      if (wantsFixture(window.location.search) && search.get("arrive") === "1") {
        void import("./dev/arrival").then(({ addBanquetCapture }) => {
          arrival = setTimeout(() => {
            const at = new Date();
            dataTransform.set((data) => addBanquetCapture(data, at));
          }, ARRIVAL_DELAY_MS);
        });
      }
    }

    return () => {
      unsubscribeView();
      unsubscribeTransform();
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      if (arrival) clearTimeout(arrival);
    };
  }, []);

  return null;
}
