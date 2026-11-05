/**
 * Where each widget sits on the parent's Studio canvas (24 columns, 16px rows), and so how tall
 * Studio's box must be. Kept apart from Studio's runtime (types only), so the server can size the
 * books' place before Studio loads and the page below never jumps.
 */
import type { AgWidgetLayoutState } from "ag-studio";

export const ROW_HEIGHT = 16;

/** Studio's canvas needs 720px; the page is wide from 1100px. */
export const PARENT_BREAKPOINTS = { studio: 720, wide: 1100 } as const;

/** Studio adds 12px around each widget, so a 20px inset lands the panels on the page's 32px margin. */
export const PARENT_CANVAS_PADDING = 20;
/** The page margin below 1100px is 24px. */
export const PARENT_CANVAS_PADDING_MEDIUM = 12;

export const WIDGET_IDS = { balance: "balance", chart: "takings-chart", events: "takings", waiting: "waiting", ledger: "ledger" } as const;
export type WidgetId = (typeof WIDGET_IDS)[keyof typeof WIDGET_IDS];
export type Layout = Record<WidgetId, AgWidgetLayoutState>;

/** Rows per widget. The balance holds a 60px figure; the ledger shows about fourteen rows. */
const ROWS: Record<WidgetId, number> = { balance: 11, "takings-chart": 26, takings: 26, waiting: 14, ledger: 48 };

const box = (xTrack: number, yTrack: number, xSpan: number, id: WidgetId): AgWidgetLayoutState => ({ xTrack, yTrack, xSpan, ySpan: ROWS[id] });

/** 1100px and up: the chart and the events table side by side. */
export function wideLayout(): Layout {
  const pair = ROWS.balance;
  const waiting = pair + ROWS["takings-chart"];
  const ledger = waiting + ROWS.waiting;
  return {
    balance: box(0, 0, 24, "balance"),
    "takings-chart": box(0, pair, 12, "takings-chart"),
    takings: box(12, pair, 12, "takings"),
    waiting: box(0, waiting, 24, "waiting"),
    ledger: box(0, ledger, 24, "ledger"),
  };
}

/** 720-1099px: every widget full width, in reading order. */
export function stackedLayout(): Layout {
  let yTrack = 0;
  const order: WidgetId[] = ["balance", "takings-chart", "takings", "waiting", "ledger"];
  return Object.fromEntries(
    order.map((id) => {
      const placed = box(0, yTrack, 24, id);
      yTrack += ROWS[id];
      return [id, placed];
    }),
  ) as Layout;
}

/** The canvas's height in rows: the lowest widget's bottom edge. */
export const layoutRows = (layout: Layout) => Math.max(...Object.values(layout).map((b) => b.yTrack + (b.ySpan ?? 0)));

/** Studio's box at each width: the whole canvas, so the page scrolls and Studio doesn't. */
export const STUDIO_HEIGHTS = {
  wide: layoutRows(wideLayout()) * ROW_HEIGHT + PARENT_CANVAS_PADDING * 2,
  medium: layoutRows(stackedLayout()) * ROW_HEIGHT + PARENT_CANVAS_PADDING_MEDIUM * 2,
} as const;
