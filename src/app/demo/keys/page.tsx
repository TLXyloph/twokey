import type { Metadata } from "next";
import { JudgePanel } from "@/ui/judge/judge-panel";
import { KEYS_COPY } from "@/ui/keys/keys-content";
import { KeysScreen } from "@/ui/keys/keys-screen";
import { BoardScope } from "@/ui/studio/board-header";
import { boardCssVars } from "@/ui/studio/tokens";

export const metadata: Metadata = {
  title: "Key setup · TwoKey",
  description: "Who holds the keys to the club's PayPal account, and the five settings that move them (demo data).",
};

/**
 * Key setup (/demo/keys): the judge band, the board's scope row and title, then the five PayPal
 * settings beside the public "Who holds the keys" panel (#who-holds-the-keys). The header is
 * server-rendered; the steps and the panel read client state and the session's live board view.
 * `?fixture=1` (development only) runs it on the in-memory board view, like /demo; `&steps=N`
 * starts with N steps done.
 */
export default function KeysPage() {
  return (
    <main className="keys-page" style={boardCssVars}>
      <JudgePanel />
      <header className="board-header keys-header">
        <BoardScope />
        <div className="board-header__titles">
          <h1 className="board-header__title">{KEYS_COPY.title}</h1>
          <p className="board-header__finding">{KEYS_COPY.finding}</p>
        </div>
      </header>
      <KeysScreen />
    </main>
  );
}
