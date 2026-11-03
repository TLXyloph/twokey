/**
 * The board's tokens: the achromatic-ledger style (design-taste-frontend, seed 1298923909) with the
 * TwoKey brand mapped onto its light roles. Club maroon is the one chart hue and goes on the main
 * data element only (received takings) and on a shortfall's figure; every other colour is neutral,
 * warmed slightly to sit on the stone ground. The ground is the sheet's low-chroma stone (about 12%
 * saturation): the earlier #f5f2ef measured 23% and read as cream in the inspector.
 *
 * One source for both consumers: `boardCssVars` puts them on the board's root as CSS custom
 * properties for our own markup, and theme.ts hands the literal values to AG Studio (its menus and
 * popups render outside the board, where a `var()` would not resolve).
 */
import type { CSSProperties } from "react";

export const tokens = {
  ground: "#f4f3f1", // stone: the face
  surface: "#ffffff",
  raised: "#f9f9f8",
  active: "#eae8e5",
  border: "#e5e2df",
  rule: "#f0eeec",
  control: "#d1cdc9",
  text: "#1b1416",
  muted: "#5f5a57",
  faint: "#6b6562",
  primary: "#1b1416", // near-black fill, white label
  data: "#7d0a26", // club maroon: THE one chart hue
  comparison: "#b7b0aa", // grey: the expected / comparison series
  shortTint: "#f7e9ec", // pale maroon, only under a "Refused" or "Missing" status
} as const;

export const radius = { card: 8, control: 6, chip: 4 } as const;

/** Geist Sans everywhere in the app (figures included), from next/font in src/app/layout.tsx. */
export const textFont = 'var(--font-text), "Helvetica Neue", Arial, sans-serif';
/** Bricolage Grotesque, on the wordmark only. */
export const displayFont = 'var(--font-display), "Helvetica Neue", Arial, sans-serif';

const kebab = (name: string) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

export const boardCssVars = {
  ...Object.fromEntries(Object.entries(tokens).map(([name, value]) => [`--${kebab(name)}`, value])),
  "--radius-card": `${radius.card}px`,
  "--radius-control": `${radius.control}px`,
  "--radius-chip": `${radius.chip}px`,
  "--font": textFont,
  "--font-wordmark": displayFont,
} as CSSProperties;
