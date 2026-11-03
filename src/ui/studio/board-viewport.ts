/**
 * How the board opens at each screen width. Studio's canvas needs 720px (`studioCanvasMinWidth`),
 * and the open AI Assistant takes about 350px plus the editing rails, so:
 *
 *   wide    >= 1220px  edit mode, AI Assistant open, the desktop layout (the judges' and the video's view)
 *   medium   900-1219  edit mode, AI Assistant folded to its rail, the same layout
 *   compact  640-899   view mode, no panels, every widget stacked full width
 *   phone     < 640    the same, with the strip's three cells stacked (see live-balance-widget.css)
 *
 * (Wide and medium screens also keep the strip's captions to two lines; see the same CSS file.)
 *
 * Studio reads `initialState` and the panels once, so the width is read once, when Studio loads.
 */
import type { AgPanelConfig, AgReportState, AgStudioMode, AgWidgetLayoutState } from "ag-studio";
import { BOARD_PAGE_ID, boardInitialState } from "./board-layout";
import { SECOND_KEY_WIDGET_ID } from "./studio-handle";
import type { TwoKeyRegistry } from "./widgets";

export type BoardViewport = "wide" | "medium" | "compact" | "phone";

export const BOARD_BREAKPOINTS = { wide: 1220, medium: 900, compact: 640 } as const;

export function boardViewport(width: number): BoardViewport {
  if (width >= BOARD_BREAKPOINTS.wide) return "wide";
  if (width >= BOARD_BREAKPOINTS.medium) return "medium";
  if (width >= BOARD_BREAKPOINTS.compact) return "compact";
  return "phone";
}

export interface BoardStudioSetup {
  mode: AgStudioMode;
  initialState: AgReportState<TwoKeyRegistry>;
  /** Studio's `panels` property; undefined keeps Studio's default panels. */
  panels?: AgPanelConfig;
  /** True when the canvas must be allowed below Studio's 720px minimum. */
  compactCanvas: boolean;
}

/** Rows (16px) per widget when stacked; the chart keeps the height AG Charts needs for a $500 step. */
const STACKED_ROWS = { chart: 19, queue: 12, events: 19 } as const;
const STRIP_ROWS = { compact: 8, phone: 21 } as const;

function stackedLayout(stripRows: number): Record<string, AgWidgetLayoutState> {
  const order: [string, number][] = [
    ["balances", stripRows],
    ["event-takings-chart", STACKED_ROWS.chart],
    // The queue carries the board's action, so on a narrow screen it moves above the events table.
    [SECOND_KEY_WIDGET_ID, STACKED_ROWS.queue],
    ["event-takings", STACKED_ROWS.events],
  ];
  let yTrack = 0;
  return Object.fromEntries(
    order.map(([id, ySpan]) => {
      const box = { xTrack: 0, yTrack, xSpan: 24, ySpan };
      yTrack += ySpan;
      return [id, box];
    }),
  );
}

function withPage(
  state: AgReportState<TwoKeyRegistry>,
  change: (page: AgReportState<TwoKeyRegistry>["pages"][number]) => Partial<AgReportState<TwoKeyRegistry>["pages"][number]>,
): AgReportState<TwoKeyRegistry> {
  return { ...state, pages: state.pages.map((page) => (page.id === BOARD_PAGE_ID ? { ...page, ...change(page) } : page)) };
}

export function boardStudioSetup(viewport: BoardViewport): BoardStudioSetup {
  switch (viewport) {
    case "wide":
      return { mode: "edit", initialState: boardInitialState, compactCanvas: false };
    case "medium":
      return {
        mode: "edit",
        initialState: { ...boardInitialState, panels: { ...boardInitialState.panels, ai: { collapsed: true } } },
        compactCanvas: false,
      };
    case "compact":
    case "phone":
      return {
        mode: "view",
        initialState: withPage(boardInitialState, () => ({ widgetLayout: stackedLayout(STRIP_ROWS[viewport]) })),
        panels: { view: { left: [], right: [] } },
        compactCanvas: true,
      };
  }
}
