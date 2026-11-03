import { FAQS } from "./content";
import { vars } from "./style-vars";

/** The honest limits, as six native disclosure rows indented under a wide heading. */
export function Questions() {
  return (
    <section id="faq" className="lp-faq" aria-labelledby="faq-title">
      <h2 id="faq-title" className="lp-head" data-reveal="rise">
        What TwoKey can&rsquo;t do
      </h2>
      <div className="lp-faq__list">
        {FAQS.map((item, i) => (
          <details key={item.q} className="lp-faq__item" open={i === 0} data-reveal="rise" style={vars({ "--i": i })}>
            <summary className="lp-faq__q">
              <span>{item.q}</span>
              <span className="lp-faq__chev" aria-hidden="true" />
            </summary>
            <div className="lp-faq__a">
              <p>{item.a}</p>
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}
