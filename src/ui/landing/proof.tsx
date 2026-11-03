"use client";

/**
 * Proof: the places where club treasurers have been accused, as one sentence. One name at a time is
 * lit in the full ink, with its reported facts and source beneath. The light moves on by itself while
 * the section is in view; pointing at the section holds it, choosing a name pins it, and Pause stops it.
 * Under reduced motion it never moves by itself. Without script, every caption is shown as a list.
 */
import { Fragment, useEffect, useRef, useState } from "react";
import { CASES, PROOF_OPENING } from "./content";

// Five seconds a place: each lit name carries a caption of 15 to 30 words to read.
const STEP_MS = 5000;

export function Proof() {
  const [lit, setLit] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [held, setHeld] = useState(false);
  const [inView, setInView] = useState(false);
  const root = useRef<HTMLElement>(null);

  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) setPlaying(false);
    const el = root.current;
    if (!el || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(([entry]) => setInView(!!entry?.isIntersecting), { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!playing || held || !inView) return;
    const timer = setInterval(() => setLit((i) => (i + 1) % CASES.length), STEP_MS);
    return () => clearInterval(timer);
  }, [playing, held, inView]);

  const choose = (i: number) => {
    setLit(i);
    setPlaying(false);
  };

  return (
    <section
      ref={root}
      className="lp-proof"
      aria-labelledby="proof-open"
      data-auto={playing ? "" : undefined}
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
    >
      <p className="lp-proof__statement" data-reveal="rise">
        <span id="proof-open" className="lp-proof__open">
          {PROOF_OPENING}
        </span>{" "}
        {CASES.map((c, i) => (
          <Fragment key={c.place}>
            {i === CASES.length - 1 ? "and " : ""}
            <span className="lp-proof__item">
              <button
                type="button"
                className="lp-proof__name"
                aria-pressed={i === lit}
                aria-controls={`case-${i}`}
                onClick={() => choose(i)}
                onFocus={() => choose(i)}
              >
                {c.place}
              </button>
              {i < CASES.length - 2 ? "," : i === CASES.length - 1 ? "." : ""}
            </span>{" "}
          </Fragment>
        ))}
      </p>
      <div className="lp-proof__foot" data-reveal="rise">
        <div className="lp-proof__captions">
          {CASES.map((c, i) => (
            <p key={c.place} id={`case-${i}`} className="lp-proof__caption" data-lit={i === lit ? "" : undefined}>
              {c.caption}{" "}
              <a className="lp-link lp-link--under" href={c.source.href} rel="noreferrer">
                Source: {c.source.label}
              </a>
            </p>
          ))}
        </div>
        <button type="button" className="lp-proof__pause lp-link" onClick={() => setPlaying((p) => !p)}>
          {playing ? "Pause" : "Play"}
        </button>
      </div>
    </section>
  );
}
