import { riverbend, type LedgerEntry } from "@/demo/riverbend";
import { formatUSD } from "./ask-ledger";

/**
 * A cropped fragment of TwoKey's two-key queue, set directly under the "Usually the same day" stage it
 * explains: one real payout from the demo ledger, signed by two officers while the person who asked
 * for it could not sign. The payout (amount, payee, date) is ledger row L03; the signing dates are
 * sample details for the fictional demo club, because the demo ledger records payouts, not signatures.
 * Roles only, never people's names.
 */
export const PAYOUT_ROW_ID = "L03";

export function payoutRow(ledger: readonly LedgerEntry[] = riverbend.ledger): LedgerEntry | undefined {
  return ledger.find((row) => row.id === PAYOUT_ROW_ID && row.status === "completed" && row.direction === "out");
}

function shortDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function ApprovalCard() {
  const row = payoutRow();
  if (!row) return null; // tests guard the row; never render a card that disagrees with the ledger
  const sentOn = shortDate(row.date);
  const signers = [
    { role: "Treasurer", key: "Asked for it", detail: "Can't sign", excluded: true },
    { role: "Secretary", key: "First key", detail: "Signed Oct 4", excluded: false },
    { role: "President", key: "Second key", detail: `Signed ${sentOn}`, excluded: false },
  ];

  return (
    <article className="ui-card ui-payout" data-ui data-reveal="rise" aria-label="Example: one payout, signed by two officers">
      <header className="ui-card__head">
        <p className="ui-card__kind">
          Payout <span className="ui-card__meta">· {row.counterparty}</span>
        </p>
        <span className="ui-pill ui-pill--sent">Sent {sentOn}</span>
      </header>
      <div className="ui-payout__body">
        <p className="ui-card__amount">{formatUSD(Math.abs(row.amount))}</p>
        <p className="ui-payout__what">{row.description}. The AI checked the receipt against the equipment budget.</p>
      </div>
      <ul className="ui-payout__keys" aria-label="Who signed">
        {signers.map((signer) => (
          <li key={signer.role} className="ui-payout__key" data-excluded={signer.excluded ? "" : undefined}>
            <span className="ui-payout__role">{signer.role}</span>
            <span className="ui-payout__label">{signer.key}</span>
            <span className="ui-payout__detail">{signer.detail}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}
