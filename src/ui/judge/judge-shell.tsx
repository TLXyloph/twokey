"use client";

/**
 * Judge mode around the board: the judge panel above it, the payout drawer beside it, and the
 * wiring between the live board view and everything that reads it.
 *
 * - Starts the board-view client (./use-live-board.ts: the first read, focus and visibility) and
 *   tells it when the drawer opens or closes, which is all its polling needs.
 * - Hands each new board data object to Studio (./../studio/studio-handle.ts holds it until Studio's
 *   data engine is ready), so the strip, the chart and the waiting queue follow the session.
 *
 * The board itself (header and Studio) is passed in as children, so it stays server-rendered.
 */
import { useEffect, type ReactNode } from "react";
import { pushBoardData } from "@/ui/studio/studio-handle";
import { boardViewClient, wantsDrawerOpen } from "./board-view-source";
import { PayoutDrawer } from "./drawer";
import { drawerStore } from "./drawer-store";
import { JudgePanel } from "./judge-panel";
import { useLiveBoardView } from "./use-live-board";

export function JudgeShell({ children }: { children: ReactNode }) {
  useLiveBoardView();
  useEffect(() => {
    const client = boardViewClient();
    if (!client) return;

    const pushData = () => {
      const data = client.getSnapshot().view?.data;
      if (data) pushBoardData(data);
    };
    const syncDrawer = () => client.setDrawerOpen(drawerStore.isOpen());

    const unsubscribeView = client.subscribe(pushData);
    const unsubscribeDrawer = drawerStore.subscribe(syncDrawer);
    pushData();
    syncDrawer();

    if (process.env.NODE_ENV !== "production") {
      if (wantsDrawerOpen(window.location.search)) drawerStore.open();
    }

    return () => {
      unsubscribeView();
      unsubscribeDrawer();
    };
  }, []);

  return (
    <>
      <JudgePanel />
      {children}
      <PayoutDrawer />
    </>
  );
}
