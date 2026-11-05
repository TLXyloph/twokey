/**
 * A request's risk card: the verdict in plain words, where the check came from, its one-sentence
 * summary and each finding with the evidence it rests on. While the AI's read is pending the rules
 * card stays up under a quiet "reading" line.
 */
import type { RiskCard, RiskFinding } from "@/ledger/contracts";
import type { RiskReadState } from "./board-view-client";
import { AlertGlyph, StopGlyph, TickGlyph } from "./glyphs";
import { originLabel, verdictLabel } from "./judge-model";

const VERDICT_GLYPHS = { clear: TickGlyph, check: AlertGlyph, stop: StopGlyph } as const;
const SEVERITY_WORDS: Record<RiskFinding["severity"], string> = { info: "Note", warn: "Check", stop: "Stop" };

export interface RiskBlockProps {
  card: RiskCard | null;
  pending: boolean;
  read?: RiskReadState;
}

export function RiskBlock({ card, pending, read }: RiskBlockProps) {
  const reading = pending && read !== "failed";
  const status = reading
    ? "The AI is reading the receipt…"
    : pending
      ? "The AI couldn't read the receipt just now. The rule checks stand."
      : card
        ? originLabel(card.origin)
        : "";

  if (!card) {
    return (
      <section className="judge-risk" aria-label="Receipt check">
        <p className="judge-risk__status" data-reading={reading || undefined} role="status">
          {status || "No receipt check yet."}
        </p>
      </section>
    );
  }

  const Glyph = VERDICT_GLYPHS[card.verdict];
  return (
    <section className="judge-risk" aria-label="Receipt check">
      <div className="judge-risk__head">
        <span className="judge-verdict" data-verdict={card.verdict}>
          <Glyph />
          {verdictLabel(card.verdict)}
        </span>
        <span className="judge-risk__status" data-reading={reading || undefined} role="status">
          {status}
        </span>
      </div>
      <p className="judge-risk__summary">{card.summary}</p>
      {card.findings.length > 0 && (
        <ul className="judge-findings">
          {card.findings.map((finding, i) => (
            <li key={i} className="judge-finding" data-severity={finding.severity}>
              <span className="judge-finding__mark" aria-hidden="true" />
              <div>
                <p className="judge-finding__text">
                  <span className="board-visually-hidden">{SEVERITY_WORDS[finding.severity]}: </span>
                  {finding.text}
                </p>
                <p className="judge-finding__evidence">
                  {finding.evidence}
                  <span className="judge-finding__source"> · {finding.source === "rule" ? "Rule check" : "Read from the receipt"}</span>
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
