/**
 * A payout's live timeline once the second key is in: Requested → Signed → Sent to PayPal →
 * PayPal confirmed (or "Not sent", with the reason). Steps still to come are listed as waiting, and
 * tick as the board polls; the last one ticks when PayPal's webhook arrives.
 */
import type { PayoutRequestView } from "@/ledger/contracts";
import { timelineRows } from "./judge-model";

export function Timeline({ request, now }: { request: PayoutRequestView; now: Date }) {
  const rows = timelineRows(request, now);
  return (
    <section className="judge-timeline" aria-label="Payout progress">
      <ol className="judge-steps" aria-live="polite">
        {rows.map((row) => (
          <li key={row.key} className="judge-step" data-state={row.state}>
            <span className="judge-step__mark" aria-hidden="true" />
            <span className="judge-step__label">
              {row.label}
              {row.state === "pending" && <span className="board-visually-hidden"> (not yet)</span>}
            </span>
            {row.time ? (
              <span className="judge-step__time">{row.time}</span>
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
