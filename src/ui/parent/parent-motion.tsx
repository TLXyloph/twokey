"use client";

/**
 * Section entrances on the parent ledger, fired once as each part enters the screen; parts entering
 * together are staggered by 70ms, four steps at most (the landing's and the pay page's rhythm).
 * Anything already on the first screen is shown at once. Without script nothing is hidden; under
 * reduced motion the parts fade without travel (motion.css).
 */
import { useEffect } from "react";

const STAGGER_MS = 70;
const MAX_STEPS = 4;

export function ParentMotion() {
  useEffect(() => {
    if (!("IntersectionObserver" in window)) return;
    const parts = [...document.querySelectorAll<HTMLElement>(".parent [data-reveal]")];
    const fold = innerHeight;
    for (const el of parts) if (el.getBoundingClientRect().top < fold) el.dataset.visible = "";
    document.documentElement.classList.add("parent-reveal-ready");

    const io = new IntersectionObserver(
      (entries) => {
        const entering = entries
          .filter((entry) => entry.isIntersecting)
          .map((entry) => entry.target as HTMLElement)
          .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top || a.getBoundingClientRect().left - b.getBoundingClientRect().left);
        entering.forEach((el, k) => {
          el.style.setProperty("--delay", `${Math.min(k, MAX_STEPS - 1) * STAGGER_MS}ms`);
          el.dataset.visible = "";
          io.unobserve(el);
        });
      },
      { rootMargin: "0px 0px 5% 0px" },
    );
    for (const el of parts) if (!("visible" in el.dataset)) io.observe(el);
    return () => io.disconnect();
  }, []);
  return null;
}
