"use client";

/**
 * The evening, told left to right: one column per moment in a row that scrolls sideways and snaps
 * to each column. A solid bar under the heading shows how far along the row is; on desktop two
 * square buttons step one column back or forward. It is a plain list that scrolls without script.
 */
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Moment } from "./content";

export function EveningRow({ heading, moments }: { heading: string; moments: Moment[] }) {
  const rowRef = useRef<HTMLOListElement>(null);
  const [progress, setProgress] = useState(0);
  const [ends, setEnds] = useState({ start: true, end: false });

  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const update = () => {
      const span = row.scrollWidth - row.clientWidth;
      const share = span > 0 ? row.scrollLeft / span : 1;
      setProgress(share);
      setEnds({ start: row.scrollLeft <= 2, end: span - row.scrollLeft <= 2 });
    };
    update();
    row.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      row.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  const step = (direction: 1 | -1) => {
    const row = rowRef.current;
    const first = row?.querySelector<HTMLElement>(".moment");
    if (!row || !first) return;
    const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    row.scrollBy({ left: direction * (first.offsetWidth + gap), behavior: reduce ? "auto" : "smooth" });
  };

  return (
    <>
      <div className="evening__top">
        <h2 className="evening__heading" id="evening-title" data-reveal="rise">
          {heading}
        </h2>
        <div className="evening__buttons">
          <button type="button" className="evening__button" aria-label="Earlier in the evening" disabled={ends.start} onClick={() => step(-1)}>
            <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false">
              <path d="M12.5 4 6.5 10l6 6" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="square" />
            </svg>
          </button>
          <button type="button" className="evening__button" aria-label="Later in the evening" disabled={ends.end} onClick={() => step(1)}>
            <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false">
              <path d="m7.5 4 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="square" />
            </svg>
          </button>
        </div>
      </div>
      <div className="evening__bar" aria-hidden="true">
        <span style={{ "--progress": progress } as CSSProperties} />
      </div>
      <ol className="evening__row" ref={rowRef} tabIndex={0} aria-label={heading}>
        {moments.map((moment, i) => (
          <li className="moment" key={moment.title} style={{ "--drop": `${[96, 40, 128, 64, 112, 48][i % 6]}px` } as CSSProperties} data-reveal="rise">
            <h3 className="moment__title">{moment.title}</h3>
            <p className="moment__text">{moment.text}</p>
            <figure className="moment__picture">
              <img
                src={moment.picture.src}
                width={moment.picture.width}
                height={moment.picture.height}
                alt={moment.picture.alt}
                loading="lazy"
                decoding="async"
                style={moment.picture.position ? { objectPosition: moment.picture.position } : undefined}
              />
              <figcaption>{moment.picture.caption}</figcaption>
            </figure>
          </li>
        ))}
      </ol>
    </>
  );
}
