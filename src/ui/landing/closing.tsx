import { CREDITS, CTA, FOOTER_NOTES, REPO } from "./content";
import { vars } from "./style-vars";

/** The idea again, inverted: the gold field with burgundy words, one sentence and one button. */
export function Cta() {
  return (
    <section className="lp-cta lp-screen" aria-labelledby="cta-title">
      <h2 id="cta-title" className="lp-cta__title">
        {CTA.title.map((line, i) => (
          <span key={line} className="lp-cta__mask" data-reveal="mask" style={vars({ "--i": i })}>
            <span className="lp-cta__line">
              {line}
            </span>
          </span>
        ))}
      </h2>
      <div className="lp-cta__foot">
        <p className="lp-cta__sentence" data-reveal="rise">
          {CTA.sentence}
        </p>
        <div className="lp-cta__action" data-reveal="rise">
          <a className="lp-button lp-button--inverse" href="/demo">
            Open the demo
          </a>
        </div>
      </div>
    </section>
  );
}

/** Where to find it: the repository address is the display line; notes on top, credits at the foot. */
export function Footer() {
  return (
    <footer className="lp-foot">
      <div className="lp-foot__top">
        <p className="lp-foot__mark">TwoKey</p>
        <ul className="lp-foot__notes">
          {FOOTER_NOTES.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
        <a className="lp-link lp-link--under lp-foot__top-link" href="#top">
          Back to top
        </a>
      </div>
      <p className="lp-foot__line" data-reveal="rise">
        <a href={REPO.href} rel="noreferrer">
          <span>github.com/</span>
          <span>TLXyloph/twokey</span>
        </a>
      </p>
      <div className="lp-foot__meta">
        <ul className="lp-foot__links">
          <li>
            <a className="lp-link lp-link--under" href="/demo">
              Demo
            </a>
          </li>
          <li>
            <a className="lp-link lp-link--under" href={REPO.href} rel="noreferrer">
              Source
            </a>
          </li>
        </ul>
        <p className="lp-foot__credits">
          Pictures:{" "}
          {CREDITS.map((c, i) => (
            <span key={c.page}>
              <a className="lp-link lp-link--under" href={c.page} rel="noreferrer">
                &ldquo;{c.title}&rdquo;
              </a>{" "}
              by {c.creator},{" "}
              <a className="lp-link lp-link--under" href={c.licence.href} rel="noreferrer">
                {c.licence.label}
              </a>
              , via Wikimedia Commons{i < CREDITS.length - 1 ? "; " : "."}
            </span>
          ))}
        </p>
        <p className="lp-foot__year">2026</p>
      </div>
    </footer>
  );
}
