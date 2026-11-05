/**
 * The board's header, above AG Studio: the product and the club it is scoped to (`BoardScope`, which
 * the other officer screens share), the Watchtower's status line at the scope row's end, the
 * screen's name, the auditor's finding, the one primary action, and the Watchtower's alerts across
 * the full width under the finding (every role sees them). A server component; the button and the
 * Watchtower parts are client components.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { CLUB_SHORT_NAME } from "@/demo/riverbend";
import { WatchtowerAlerts } from "@/ui/watchtower/watch-alerts";
import { WatchtowerStatus } from "@/ui/watchtower/watch-status";
import { boardHeaderModel, type BoardHeaderModel } from "./board-header-model";
import { ReviewButton } from "./review-button";
import "./board.css";

/** Two key bows side by side, teeth outward: the two officers' keys. Drawn in the club maroon. */
function TwoKeyMark() {
  return (
    <svg className="board-wordmark__mark" width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <circle cx="6.5" cy="5.75" r="3.25" />
        <path d="M6.5 9v8.5M6.5 14.25H4.5M6.5 17H4.75" />
        <circle cx="13.5" cy="5.75" r="3.25" />
        <path d="M13.5 9v8.5M13.5 14.25h2M13.5 17h1.75" />
      </g>
    </svg>
  );
}

/**
 * The scope row every officer screen shares: "TwoKey / Riverbend Youth Football League [Demo data]",
 * then whatever the screen puts at its right end (the board: the Watchtower's status line).
 */
export function BoardScope({ club = CLUB_SHORT_NAME, children }: { club?: string; children?: ReactNode }) {
  return (
    <div className="board-header__scope">
      <Link className="board-wordmark" href="/">
        <TwoKeyMark />
        TwoKey
      </Link>
      <span className="board-header__sep" aria-hidden="true">
        /
      </span>
      <span className="board-header__club">
        {club}
        <span className="board-chip">Demo data</span>
      </span>
      {children}
    </div>
  );
}

export function BoardHeader({ model = boardHeaderModel() }: { model?: BoardHeaderModel }) {
  return (
    <header className="board-header">
      <BoardScope club={model.club}>
        <WatchtowerStatus />
      </BoardScope>
      <div className="board-header__title-row">
        <div className="board-header__titles">
          <h1 className="board-header__title">{model.title}</h1>
          <p className="board-header__finding">{model.finding}</p>
        </div>
        <ReviewButton seedCount={model.review?.count ?? 0} />
      </div>
      <WatchtowerAlerts />
    </header>
  );
}
