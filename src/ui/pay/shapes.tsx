/**
 * The stationery's cut edges, drawn as filled SVG shapes (never outlines or gradients): a row of
 * scallops along a card's edge, and a perforation (punched holes with a notch at each end) where a
 * stub tears off. Each SVG pattern needs an id unique on the page.
 */

const SCALLOP = 22;

/** A row of half-circles in the paper colour, hanging below (`down`) or rising above (`up`) an edge. */
export function Scallops({ id, className, direction = "down" }: { id: string; className?: string; direction?: "up" | "down" }) {
  const cy = direction === "down" ? 0 : SCALLOP;
  return (
    <svg className={className} width="100%" height={SCALLOP} aria-hidden="true" focusable="false">
      <defs>
        <pattern id={id} width={SCALLOP * 2} height={SCALLOP} patternUnits="userSpaceOnUse">
          <circle cx={SCALLOP} cy={cy} r={SCALLOP} fill="currentColor" />
        </pattern>
      </defs>
      <rect width="100%" height={SCALLOP} fill={`url(#${id})`} />
    </svg>
  );
}

/**
 * Where a stub tears off: holes punched through the paper in the colour of the ground behind it,
 * with a half-round notch cut into each side (CSS draws the notches). `tone` names that ground.
 */
export function Perforation({ id, tone = "bg" }: { id: string; tone?: "bg" | "field" }) {
  return (
    <div className={`perforation perforation--${tone}`} aria-hidden="true">
      <svg width="100%" height="8" focusable="false">
        <defs>
          <pattern id={id} width="18" height="8" patternUnits="userSpaceOnUse">
            <circle cx="9" cy="4" r="3.5" fill="currentColor" />
          </pattern>
        </defs>
        <rect width="100%" height="8" fill={`url(#${id})`} />
      </svg>
    </div>
  );
}
