import { ENFORCED, STATE_RULES, type Rule } from "./content";
import { vars } from "./style-vars";

function Rows({ rules, offset }: { rules: Rule[]; offset: number }) {
  return rules.map((r, i) => (
    <tr key={r.kind} data-reveal="rise" style={vars({ "--i": offset + i })}>
      <th scope="row">{r.kind}</th>
      <td className="lp-rules__rule">{r.rule}</td>
      <td className="lp-rules__src">
        {r.source ? (
          <a className="lp-link lp-link--under" href={r.source.href} rel="noreferrer">
            {r.source.label}
            <span aria-hidden="true"> ↗</span>
          </a>
        ) : null}
      </td>
    </tr>
  ));
}

/**
 * The rulebooks already demand two keys; the table sets their words beside what TwoKey enforces. On
 * desktop the photograph (columns 1-5) and the table (columns 7-12) start on one line; the table's two
 * group headings name it, so it needs no label of its own.
 */
export function Rulebooks() {
  return (
    <section id="rules" className="lp-rules lp-screen" aria-labelledby="rules-title">
      <h2 id="rules-title" className="lp-head lp-rules__head" data-reveal="rise">
        <span className="lp-rules__first">Your rulebook</span> <span>already says so</span>
      </h2>
      <div className="lp-rules__grid">
        <figure className="lp-rules__photo" data-reveal="rise">
          <div className="lp-rules__frame">
            <img
              src="/landing/img/football-4x5.jpg"
              width={844}
              height={1055}
              alt="A youth football game on a green field, the players in gold and in white, purple bleachers and a brick high school behind them."
              loading="lazy"
              decoding="async"
            />
          </div>
          <figcaption>A youth football game at a high school in Washington, D.C., 2010.</figcaption>
        </figure>
        <table className="lp-rules__table">
          <caption className="lp-sr-only">Rules</caption>
          <tbody>
            <tr className="lp-rules__group">
              <th colSpan={3} scope="colgroup">
                State PTA rules
              </th>
            </tr>
            <Rows rules={STATE_RULES} offset={0} />
          </tbody>
          <tbody>
            <tr className="lp-rules__group">
              <th colSpan={3} scope="colgroup">
                What TwoKey enforces
              </th>
            </tr>
            <Rows rules={ENFORCED} offset={4} />
          </tbody>
        </table>
      </div>
    </section>
  );
}
