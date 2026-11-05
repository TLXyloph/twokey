/**
 * The AI's draft of the close: the reconciliation in plain words beside the points for the Reviewer
 * to check, labelled "Drafted by the AI (recorded)": it was made once, in development, from the
 * figures on this page. Until it is recorded, the panel keeps its frame and says so. It names no AI
 * vendor.
 */
import type { CloseDraftView } from "@/close/contracts";
import { formatAsOf } from "@/demo/board-figures";
import { DRAFT_LABEL, DRAFT_MISSING } from "./close-model";

export function DraftPanel({ draft }: { draft: CloseDraftView }) {
  return (
    <section className="close-panel close-draft" aria-labelledby="close-draft-title">
      <header className="close-panel__head">
        <h2 id="close-draft-title" className="close-panel__title">
          Reconciliation summary
        </h2>
        <p className="close-draft__origin">
          <span className="close-chip">{DRAFT_LABEL}</span>
          {draft.state === "recorded" && <span className="close-draft__when">{formatAsOf(draft.recordedAt)}</span>}
        </p>
      </header>
      {draft.state === "recorded" ? (
        <div className="close-draft__body">
          <p className="close-draft__summary">{draft.draft.summary}</p>
          <div className="close-draft__points">
            <h3 className="close-draft__subtitle">Points to check</h3>
            <ul className="close-points">
              {draft.draft.points.map((point) => (
                <li key={point.check} className="close-point">
                  <p className="close-point__check">{point.check}</p>
                  <p className="close-point__basis num">{point.basis}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : (
        <div className="close-draft__missing">
          <p className="close-draft__summary">{DRAFT_MISSING}</p>
          <p className="close-draft__note">
            Every figure and exception on this page is computed in code from the ledger, so the Reviewer can check and sign the close without it.
          </p>
        </div>
      )}
      <p className="close-draft__rule">The AI prepares the close. A person signs it: the club&apos;s insurer says financial software doesn&apos;t qualify.</p>
    </section>
  );
}
