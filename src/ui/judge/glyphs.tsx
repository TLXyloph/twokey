/**
 * The judge UI's few glyphs: 16px outline strokes in `currentColor` at 1.5px, the weight of the 14px
 * text beside them. Decorative everywhere (the words beside them carry the meaning).
 */
const common = {
  width: 16,
  height: 16,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  focusable: false,
};

export const CloseGlyph = () => (
  <svg {...common}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
);

/** A tick: a signature that is there, a check that came back clean. */
export const TickGlyph = () => (
  <svg {...common}>
    <path d="M3.5 8.5l3 3 6-7" />
  </svg>
);

/** A key's empty slot: the second signature still to come. */
export const SlotGlyph = () => (
  <svg {...common}>
    <circle cx="8" cy="8" r="5" strokeDasharray="2.2 2.2" />
  </svg>
);

export const AlertGlyph = () => (
  <svg {...common}>
    <path d="M8 2.75l5.75 10.25H2.25z" />
    <path d="M8 6.5v3M8 11.25v.01" />
  </svg>
);

export const StopGlyph = () => (
  <svg {...common}>
    <circle cx="8" cy="8" r="5.75" />
    <path d="M5.25 10.75l5.5-5.5" />
  </svg>
);

export const PlusGlyph = () => (
  <svg {...common}>
    <path d="M8 3.5v9M3.5 8h9" />
  </svg>
);

/** A disclosure's chevron; CSS turns it when the section is open. */
export const ChevronGlyph = () => (
  <svg {...common} width={14} height={14}>
    <path d="M4.5 6.25L8 9.75l3.5-3.5" />
  </svg>
);

/** Play it again: an arrow coming round to its start. */
export const ReplayGlyph = () => (
  <svg {...common}>
    <path d="M3.25 8a4.75 4.75 0 1 0 1.4-3.36" />
    <path d="M3.25 2.75v2.5h2.5" />
  </svg>
);
