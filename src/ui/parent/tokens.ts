/**
 * The parent ledger's tokens: the club's team colours (the landing and the pay page use the same
 * four), plus the three data colours a chart and a table need on maroon. One source for both
 * consumers: `parentCssVars` puts them on the page's root for our own markup, and ./theme.ts hands
 * the literal values to AG Studio (its menus and tooltips render outside the page, where a `var()`
 * would not resolve).
 *
 * Contrast, WCAG 2 ratios measured against the widget surface (#4d0519) and, in brackets, the ground:
 *   ink #f5cf6b 10.4:1 (11.6)   muted #c79b4a 6.1:1 (6.8)   comparison #b98a91 5.3:1 (5.9)
 *   short #ff9e8f 7.8:1 (8.7)   field #7d0a26 under gold ink 7.2:1
 * Every text pair passes AA for body text; the two chart series also differ in hue (gold against a
 * dusty rose) and in lightness, so they part without colour vision.
 */
import type { CSSProperties } from "react";

export const parentTokens = {
  ground: "#3d0012", // maroon: the page and Studio's canvas
  surface: "#4d0519", // one tone step up: a widget, a panel
  raised: "#5a0a21", // a row under the pointer
  rule: "#621029", // the rows of a real table, and nothing else
  field: "#7d0a26", // crimson: the hero's stage and the Watchtower's chapter
  ink: "#f5cf6b", // gold: every word, the action and the main data series (received)
  muted: "#c79b4a", // gold in shadow: secondary notes, table headers
  comparison: "#b98a91", // dusty rose: the expected series, the comparison
  short: "#ff9e8f", // coral: a shortfall's figure, the one warm warning
} as const;

/** Geist Sans for text, tables and figures in running text, from next/font in src/app/layout.tsx. */
export const textFont = 'var(--font-text), "Helvetica Neue", Arial, sans-serif';
/** Bricolage Grotesque for headings, widget titles and the large figures. */
export const displayFont = 'var(--font-display), "Helvetica Neue", Arial, sans-serif';

const kebab = (name: string) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

export const parentCssVars = {
  ...Object.fromEntries(Object.entries(parentTokens).map(([name, value]) => [`--p-${kebab(name)}`, value])),
  "--p-text": textFont,
  "--p-display": displayFont,
} as CSSProperties;
