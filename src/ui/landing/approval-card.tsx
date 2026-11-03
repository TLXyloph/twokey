/**
 * A cropped fragment of TwoKey's two-key queue: the treasurer's own $480 reimbursement, refused
 * because the person who filed it is the payee. Sample request for the fictional demo club; it never
 * reached the ledger, because nothing was paid. Roles only, never people's names.
 */
const REQUEST = {
  kind: "Reimbursement",
  amount: "$480.00",
  filed: "Nov 2",
  facts: [
    ["Filed by", "Treasurer"],
    ["Pay to", "Treasurer, personal PayPal"],
    ["Receipt", "Attached, checked by Claude"],
  ],
  finding: "Flagged by Claude: the person who filed it is also the payee.",
  keys: [
    { role: "Secretary", state: "Refused", when: "Nov 3", refused: true },
    { role: "President", state: "Not signed", when: "—", refused: false },
  ],
} as const;

export function ApprovalCard() {
  return (
    <article className="ui-card" data-ui data-reveal="rise" aria-label="Example: a payout request refused by the second key">
      <header className="ui-card__head">
        <p className="ui-card__kind">
          {REQUEST.kind} <span className="ui-card__meta">· filed {REQUEST.filed}</span>
        </p>
        <span className="ui-pill ui-pill--refused">Refused</span>
      </header>
      <p className="ui-card__amount">{REQUEST.amount}</p>
      <dl className="ui-card__facts">
        {REQUEST.facts.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="ui-card__finding">{REQUEST.finding}</p>
      <ul className="ui-card__keys" aria-label="Signatures">
        {REQUEST.keys.map((key) => (
          <li key={key.role} data-refused={key.refused ? "" : undefined}>
            <span className="ui-card__role">{key.role}</span>
            <span className="ui-card__state">{key.state}</span>
            <span className="ui-card__when">{key.when}</span>
          </li>
        ))}
      </ul>
      <p className="ui-card__foot">No payout was sent. Nothing left the club&rsquo;s account.</p>
    </article>
  );
}
