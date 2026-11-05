"use client";

/**
 * The club's books below 720px, where Studio's canvas does not fit: the same four answers as the
 * Studio page (./parent-layout.ts), read-only and stacked, built from the same session data. Server-
 * rendered from the seed, so a phone has the books before any script runs; the live view replaces
 * the seed when it arrives. The ledger shows its newest eight rows and opens the rest on request.
 */
import { useId, useState } from "react";
import { parentWaitingRows } from "./parent-data";
import { balanceFigures, eventTakings, ledgerNewestFirst, money } from "./parent-model";
import { useArrivals } from "./use-arrivals";
import { LatestRows } from "./latest";
import { useClubData } from "./use-parent";

const FIRST_ROWS = 8;

/** Received as a share of expected, for the bar: 0-100, at least a sliver when anything came in. */
export function receivedShare(receivedCents: number, expectedCents: number): number {
  if (expectedCents <= 0) return receivedCents > 0 ? 100 : 0;
  const share = Math.min(100, (receivedCents / expectedCents) * 100);
  return receivedCents > 0 ? Math.max(share, 1.5) : 0;
}

function TakingsList() {
  const { data } = useClubData();
  const events = eventTakings(data);
  const byId = new Map(data.events.map((e) => [e.id, e]));
  return (
    <ul className="stacked__events">
      {events.map((event) => {
        const raw = byId.get(event.id)!;
        const share = receivedShare(Math.round(raw.received * 100), Math.round(raw.expected * 100));
        return (
          <li key={event.id} className="stacked__event">
            <p className="stacked__event-head">
              <span className="stacked__event-name">{event.name}</span>
              <span className="stacked__event-figure" data-short={event.gapCents > 0 || undefined}>
                {event.received} of {event.expected}
              </span>
            </p>
            <span className="stacked__bar" aria-hidden="true">
              <span className="stacked__bar-fill" style={{ width: `${share}%` }} />
            </span>
            {event.gapCents > 0 ? <p className="stacked__note">No record of {money(event.gapCents / 100)}.</p> : null}
          </li>
        );
      })}
    </ul>
  );
}

function WaitingList() {
  const { data } = useClubData();
  const waiting = parentWaitingRows(data);
  if (waiting.length === 0) return <p className="stacked__quiet">Nothing is waiting for a second key.</p>;
  return (
    <ul className="stacked__waiting">
      {waiting.map((payout) => (
        <li key={payout.id} className="stacked__payout">
          <p className="stacked__payout-head">
            <span className="stacked__payee">{payout.payee}</span>
            <span className="stacked__amount">{money(payout.amount)}</span>
          </p>
          <p className="stacked__note">
            {payout.description}. {payout.signedBy} signed; {payout.stillToSign} can add the second key.
          </p>
        </li>
      ))}
    </ul>
  );
}

function LedgerList() {
  const { data, live } = useClubData();
  const lines = ledgerNewestFirst(data);
  const [open, setOpen] = useState(false);
  const listId = useId();
  const arrived = useArrivals(
    lines.map((line) => line.id),
    live,
  );
  const shown = open ? lines : lines.slice(0, FIRST_ROWS);
  return (
    <>
      <div id={listId}>
        <LatestRows lines={shown} arrived={arrived} />
      </div>
      {lines.length > FIRST_ROWS ? (
        <button type="button" className="stacked__more" aria-expanded={open} aria-controls={listId} onClick={() => setOpen((v) => !v)}>
          {open ? "Show the newest eight" : `Show all ${lines.length} rows`}
        </button>
      ) : null}
    </>
  );
}

export function StackedBooks() {
  const { data } = useClubData();
  const figures = balanceFigures(data);
  return (
    <div className="stacked">
      {/* Figure first, then what it is: each reads as one line, "$4,998.75 in the club account". */}
      <div className="stacked__balance">
        <p className="stacked__cell" data-lead="">
          <span className="stacked__figure">{figures.balance}</span>
          <span className="stacked__caption">{figures.balanceLine}</span>
        </p>
        <p className="stacked__cell">
          <span className="stacked__figure">{figures.waitingTotal}</span>
          <span className="stacked__caption">{figures.waitingLine}</span>
        </p>
        <p className="stacked__cell">
          <span className="stacked__figure">{figures.moneyIn}</span>
          <span className="stacked__caption">{figures.moneyInLabel}</span>
        </p>
      </div>

      <section className="stacked__part" aria-labelledby="stacked-takings">
        <h3 id="stacked-takings" className="stacked__title">
          Takings by event
        </h3>
        <TakingsList />
      </section>

      <section className="stacked__part" aria-labelledby="stacked-waiting">
        <h3 id="stacked-waiting" className="stacked__title">
          Waiting for a second key
        </h3>
        <WaitingList />
      </section>

      <section className="stacked__part" aria-labelledby="stacked-ledger">
        <h3 id="stacked-ledger" className="stacked__title">
          Money in and out
        </h3>
        <LedgerList />
      </section>
    </div>
  );
}
