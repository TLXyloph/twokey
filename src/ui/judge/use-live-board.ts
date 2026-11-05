/**
 * Keeps the page's board view live on any demo screen: the first read on mount, a read when the
 * window gains focus, and none while the page is hidden (it catches up when shown). The board's
 * own shell (./judge-shell.tsx) adds the drawer and Studio on top; other screens (/demo/keys, and
 * any page that renders `<JudgePanel />` and reads `useBoardView()`) call this once.
 */
import { useEffect } from "react";
import { boardViewClient } from "./board-view-source";

export function useLiveBoardView(): void {
  useEffect(() => {
    const client = boardViewClient();
    if (!client) return;
    const onFocus = () => client.windowFocused();
    const onVisibility = () => client.setPageVisible(document.visibilityState !== "hidden");
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    void client.refresh();
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
}
