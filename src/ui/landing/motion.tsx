"use client";

/**
 * Section entrances, fired once as each part enters the screen. Parts that enter together are staggered
 * by 70ms, four steps at most. Anything that starts on the first screen is shown at once, so nothing
 * above the fold waits for a scroll. Without script nothing is ever hidden; under reduced motion the
 * parts below the fold fade in without travel (motion.css).
 */
import { useEffect } from "react";

const STAGGER_MS = 70;
const MAX_STEPS = 4;

export function Motion() {
  useEffect(() => {
    if (!("IntersectionObserver" in window)) return;
    const parts = [...document.querySelectorAll<HTMLElement>(".lp [data-reveal]")];
    const fold = innerHeight;
    for (const el of parts) if (el.getBoundingClientRect().top < fold) el.dataset.visible = "";
    document.documentElement.classList.add("reveal-ready");

    const io = new IntersectionObserver(
      (entries) => {
        const entering = entries
          .filter((e) => e.isIntersecting)
          .map((e) => e.target as HTMLElement)
          .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top || a.getBoundingClientRect().left - b.getBoundingClientRect().left);
        entering.forEach((el, k) => {
          el.style.setProperty("--delay", `${Math.min(k, MAX_STEPS - 1) * STAGGER_MS}ms`);
          el.dataset.visible = "";
          io.unobserve(el);
        });
      },
      // The root reaches 5% past the screen's foot: on desktop a whole screen snaps into view at
      // once, and a closing row 40px above the bottom (held 24px lower until it enters) must still
      // count as on screen, or it would wait for a scroll the snap never gives.
      { rootMargin: "0px 0px 5% 0px" },
    );
    for (const el of parts) if (!("visible" in el.dataset)) io.observe(el);
    return () => io.disconnect();
  }, []);
  return null;
}
