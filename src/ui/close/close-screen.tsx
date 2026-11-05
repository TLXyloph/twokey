"use client";

/**
 * The monthly close (/demo/close): the Reviewer's one screen. Under the judge band, the header names
 * the club and the month and says, in one sentence, whether the month adds up. Then:
 *   - the main column: the month statement, the AI's recorded draft (its summary beside the points
 *     to check), and October's rows behind the statement;
 *   - the rail: what the Reviewer decides on: the exceptions, the sign-off (on the first screen at
 *     1440x900), then the budget lines.
 * On a phone it is one column, in the order a Reviewer works: statement, exceptions, draft,
 * sign-off, budget lines, then the rows.
 *
 * The figures and the draft are server-rendered (the seed is the same for everyone); this session's
 * sign-off is read once on load and on window focus.
 */
import Link from "next/link";
import { useEffect } from "react";
import type { CloseDraftView, CloseFigures } from "@/close/contracts";
import { CLUB_SHORT_NAME } from "@/demo/riverbend";
import { DraftPanel } from "./close-draft";
import { BudgetLines, Exceptions, MonthRows, Statement } from "./close-figures";
import { closeFinding } from "./close-model";
import { SignoffPanel } from "./close-signoff";
import { closeClient, useClose } from "./close-source";

export interface CloseInitial {
  monthName: string;
  figures: CloseFigures;
  closeHash: string;
  draft: CloseDraftView;
  reviewerKey: { keyId: string } | null;
}

/** Two key bows side by side, teeth outward: the two officers' keys (the board's mark). */
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

export function CloseScreen({ initial }: { initial: CloseInitial }) {
  const { view, error } = useClose();
  const figures = view?.figures ?? initial.figures;
  const hash = view?.closeHash ?? initial.closeHash;
  const draft = view?.draft ?? initial.draft;

  useEffect(() => {
    const client = closeClient();
    if (!client) return;
    void client.refresh();
    const onFocus = () => void client.refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  return (
    <div className="close-page">
      <header className="board-header close-header">
        <div className="board-header__scope">
          <Link className="board-wordmark" href="/">
            <TwoKeyMark />
            TwoKey
          </Link>
          <span className="board-header__sep" aria-hidden="true">
            /
          </span>
          <span className="board-header__club">
            <Link className="close-crumb" href="/demo">
              {CLUB_SHORT_NAME}
            </Link>
            <span className="board-chip">Demo data</span>
          </span>
        </div>
        <div className="board-header__titles">
          <h1 className="board-header__title">Monthly close: {initial.monthName}</h1>
          <p className="board-header__finding">{closeFinding(figures)}</p>
        </div>
        {error && (
          <p className="close-read-error" role="status">
            Couldn&apos;t read this session&apos;s sign-off: {error}
          </p>
        )}
      </header>
      <div className="close-grid">
        <div className="close-main">
          <Statement figures={figures} />
          <DraftPanel draft={draft} />
          <MonthRows figures={figures} />
        </div>
        <div className="close-rail">
          <Exceptions figures={figures} />
          <SignoffPanel closeHash={hash} reviewerKey={initial.reviewerKey} />
          <BudgetLines figures={figures} />
        </div>
      </div>
    </div>
  );
}
