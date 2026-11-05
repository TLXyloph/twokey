"use client";

/**
 * A payout's live timeline once it leaves the queue: Requested → Signed → Sent to PayPal → PayPal
 * confirmed (or "Not sent", with the reason), or Requested → Sent back (with who sent it back and
 * why). Steps still to come are listed as waiting, and tick as the board polls; the last one ticks
 * when PayPal's webhook arrives. While it waits, it counts the time since "Sent to PayPal".
 */
import { useEffect, useState } from "react";
import type { PayoutRequestView } from "@/ledger/contracts";
import { timelineRows } from "./judge-model";
import { formatElapsed, startElapsedTicker } from "./waiting-clock";

/**
 * "Waiting · 0:23", once a second. The figures are tabular, so they never shift the row, and nothing
 * here animates. The ticking part is hidden from assistive tech: the steps are a live region, which
 * would otherwise read the time aloud every second. "Waiting" is read once, as before.
 */
function WaitingClock({ since, now }: { since: string; now: Date }) {
  const start = Date.parse(since);
  const [elapsed, setElapsed] = useState(() => formatElapsed(now.getTime() - start));
  useEffect(() => (Number.isNaN(start) ? undefined : startElapsedTicker(start, setElapsed)), [start]);
  if (Number.isNaN(start)) return <span className="judge-step__time judge-step__time--waiting">Waiting</span>;
  return (
    <span className="judge-step__time judge-step__time--waiting">
      <span className="board-visually-hidden">Waiting</span>
      <span aria-hidden="true">
        Waiting · <span className="judge-step__clock">{elapsed}</span>
      </span>
    </span>
  );
}

export function Timeline({ request, now }: { request: PayoutRequestView; now: Date }) {
  const rows = timelineRows(request, now);
  return (
    <section className="judge-timeline" aria-label="Payout progress">
      <ol className="judge-steps" aria-live="polite">
        {rows.map((row) => (
          <li key={row.key} className="judge-step" data-state={row.state} data-step={row.key}>
            <span className="judge-step__mark" aria-hidden="true" />
            <span className="judge-step__label">
              {row.label}
              {row.key === "sent-back" && row.detail && <span className="board-visually-hidden">: </span>}
              {row.state === "pending" && <span className="board-visually-hidden"> (not yet)</span>}
            </span>
            {row.time ? (
              <span className="judge-step__time">{row.time}</span>
            ) : row.waitingSince ? (
              <WaitingClock since={row.waitingSince} now={now} />
            ) : (
              <span className="judge-step__time judge-step__time--waiting">Waiting</span>
            )}
            {row.detail && <span className="judge-step__detail">{row.detail}</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}
