"use client";

/**
 * "Latest in the club account": the hero's live fragment. The five newest rows of the session's
 * ledger, newest first, with the Watchtower's status line (PayPal's "as of" time) under them. When a
 * payment lands (a ticket bought on the pay page) its row arrives at the top: it drops in from 8px
 * above and its band glows gold once, then settles (latest.css). Under reduced motion it only fades.
 */
import { keepTimesTogether } from "@/ui/watchtower/watch-model";
import { WatchStatusLine } from "@/ui/watchtower/watch-status";
import { flaggedLine, latestLines, type FlaggedLine, type LedgerLine } from "./parent-model";
import { useArrivals } from "./use-arrivals";
import { useClubData, useParentWatchtower } from "./use-parent";

export function LatestRows({ lines, arrived }: { lines: LedgerLine[]; arrived: ReadonlySet<string> }) {
  return (
    <ol className="latest__rows">
      {lines.map((line) => (
        <li key={line.id} className="latest__row" data-arrived={arrived.has(line.id) || undefined} data-direction={line.direction}>
          <span className="latest__day">{line.day}</span>
          <span className="latest__what">
            <span className="latest__desc">{line.description}</span>
            <span className="latest__party">{line.waiting ? `${line.status}: ${line.party}` : line.party}</span>
          </span>
          <span className="latest__amount" data-waiting={line.waiting || undefined}>
            {line.amount}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** The newest open Watchtower finding, pinned over the rows while it is open: money that left without two keys. */
export function FlaggedRow({ line }: { line: FlaggedLine }) {
  return (
    <div className="latest__row latest__flag">
      <span className="latest__day">{line.day}</span>
      <span className="latest__what">
        <span className="latest__desc">{line.description}</span>
        <span className="latest__note">
          {keepTimesTogether(line.note)}
          {line.more > 0 ? (
            <>
              {" "}
              <a className="latest__more" href="#watchtower">
                {line.more} more in the Watchtower
              </a>
            </>
          ) : null}
        </span>
      </span>
      <span className="latest__amount latest__amount--flag">{line.amount}</span>
    </div>
  );
}

export function LatestStatement() {
  const { data, live } = useClubData();
  const watch = useParentWatchtower();
  const flagged = flaggedLine(watch);
  // The pinned finding takes one row's place, so the hero keeps its height.
  const lines = latestLines(data, flagged ? 4 : 5);
  const arrived = useArrivals(
    lines.map((line) => line.id),
    live,
  );
  return (
    <section className="latest" data-ui="" aria-labelledby="latest-title">
      <div className="latest__head">
        <h2 id="latest-title" className="latest__title">
          Latest in the club account
        </h2>
        <a className="latest__all" href="#books">
          Every row
        </a>
      </div>
      {flagged ? <FlaggedRow line={flagged} /> : null}
      {/* Polite: a parent hears a new row arrive, never the list on load. */}
      <div aria-live="polite" aria-atomic="false">
        <LatestRows lines={lines} arrived={arrived} />
      </div>
      <div className="latest__foot">
        <WatchStatusLine watch={watch} />
      </div>
    </section>
  );
}
