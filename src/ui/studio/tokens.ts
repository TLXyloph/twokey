/**
 * The board's tokens: the achromatic-ledger style (design-taste-frontend, seed 1298923909) with the
 * TwoKey brand mapped onto its light roles. Club maroon is the one chart hue and goes on the main
 * data element only (received takings) and on a shortfall's figure; every other colour is neutral,
 * warmed slightly to sit on the stone ground.
 *
 * One source for both consumers: `boardCssVars` puts them on the board's root as CSS custom
 * properties for our own markup, and theme.ts hands the literal values to AG Studio (its menus and
 * popups render outside the board, where a `var()` would not resolve).
 */
import type { CSSProperties } from "react";

export const tokens = {
  ground: "#f5f2ef", // warm stone: the face
  surface: "#ffffff",
  raised: "#f9f7f5",
  active: "#ebe7e3",
  border: "#e7e2dd",
  rule: "#f1edea",
  control: "#d3cdc7",
  text: "#1b1416",
  muted: "#5f5a57",
  faint: "#6b6562",
  primary: "#1b1416", // near-black fill, white label
  data: "#7d0a26", // club maroon: THE one chart hue
  comparison: "#b7b0aa", // grey: the expected / comparison series
  shortTint: "#f7e9ec", // pale maroon, only under a "Refused" or "Missing" status
} as const;

export const radius = { card: 8, control: 6, chip: 4 } as const;

/** Geist Sans everywhere in the app, from next/font in src/app/layout.tsx. No Geist Mono. */
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
