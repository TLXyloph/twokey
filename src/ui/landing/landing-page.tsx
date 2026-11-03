import { AskLedgerSection } from "./ask-ledger-section";
import { Cta, Footer } from "./closing";
import { Hero } from "./hero";
import { Motion } from "./motion";
import { HowItWorks } from "./how-it-works";
import { Proof } from "./proof";
import { Questions } from "./questions";
import { Rulebooks } from "./rulebooks";
import "./landing.css";
import "./hero.css";
import "./story.css";
import "./ask-rules.css";
import "./close.css";
import "./fragments.css";
import "./motion.css";

// Set before first paint: it switches on the hero's load sequence (CSS only, so it finishes even if
// hydration fails). Scroll reveals wait for their own flag, set by script once it runs.
const JS_FLAG = "document.documentElement.classList.add('js')";

/** The TwoKey landing page: one sentence with two keys in it, then its evidence, section by section. */
export function LandingPage() {
  return (
    <div className="lp">
      <script dangerouslySetInnerHTML={{ __html: JS_FLAG }} />
      <Hero />
      <main>
        <Proof />
        <HowItWorks />
        <AskLedgerSection />
        <Rulebooks />
        <Questions />
        <Cta />
      </main>
      <Footer />
      <Motion />
    </div>
  );
}
