import { ApprovalCard } from "./approval-card";
import { STAGES, stageShares } from "./content";
import { vars } from "./style-vars";

/**
 * One payout, end to end, as the product's own progress bar enlarged to the page: each segment as
 * wide as that stage really takes, so the reader sees that people, not software, are the slow part.
 * On desktop the section itself is the bar's grid, so the payout slip sits in the "Usually the same
 * day" track and shares its two edges exactly; the floor keeps a short stage's clause readable on a
 * narrow window.
 */
export function HowItWorks() {
  const shares = stageShares(STAGES.map((s) => s.seconds));
  return (
    <section
      id="how"
      className="lp-how lp-screen"
      aria-labelledby="how-title"
      style={vars({ "--cols": shares.map((s) => `minmax(10.5rem, ${s}fr)`).join(" ") })}
    >
      <h2 id="how-title" className="lp-head" data-reveal="rise">
        One payout, start to finish
      </h2>
      <ol className="lp-bar" data-ui data-reveal="wipe">
        {STAGES.map((stage, i) => (
          <li key={stage.duration} className="lp-bar__stage" data-stage={i} style={vars({ "--share": (shares[i] ?? 15) / 100, "--i": i })}>
            <p className="lp-bar__time">{stage.duration}</p>
            <p className="lp-bar__clause">{stage.clause}</p>
          </li>
        ))}
      </ol>
      <ApprovalCard />
    </section>
  );
}
