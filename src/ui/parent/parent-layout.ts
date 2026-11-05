/**
 * The parent ledger's Studio page, "The club's books": one page on Studio's 24-column canvas,
 * read top to bottom in the order a parent asks (positions in ./parent-grid.ts):
 *
 *   1. What does the club hold? The balance, what waits for a second key, and this month's money in.
 *   2. Did each event's takings arrive? Received (gold) against expected (dusty rose), beside the
 *      events table whose difference column prints a shortfall in coral.
 *   3. What is about to be paid? The payouts with one key on them: payee, what for, amount, keys.
 *   4. Every row, newest first.
 *
 * It opens in view mode with no panels (read-only; types: api/agPanels.d.ts, agStudioProperties.d.ts
 * `mode`). Studio reads `initialState` once, so the width is read once, when Studio loads. Below
 * 720px Studio is not loaded at all: the page shows its own stacked version (./stacked-books.tsx).
 */
import type { AgPanelConfig, AgReportState, AgStudioLocaleText, AgStudioMode, AgStudioTheme } from "ag-studio";
import { PARENT_BREAKPOINTS, STUDIO_HEIGHTS, WIDGET_IDS, stackedLayout, wideLayout } from "./parent-grid";
import { parentMediumStudioTheme, parentStudioTheme } from "./theme";
import { parentTokens } from "./tokens";
import { PARENT_BALANCE_WIDGET_TYPE, type ParentRegistry } from "./widgets";

export const PARENT_PAGE_ID = "club-books";

/** "Received", not "Received (sum)", in headers and legends. */
export const parentLocaleText: AgStudioLocaleText = { aggregationSumFieldName: "${name}" };

const title = (text: string) => ({ enabled: true, text });

type Widgets = NonNullable<AgReportState<ParentRegistry>["pages"][number]["widgets"]>;

/**
 * The widgets, with the tables' columns for the width: below 1100px a full-width grid has about 700px,
 * so the ledger leaves out "Paid to or from" and the queue keeps the payee, the amount and who can add
 * the second key. The stacked phone version (./stacked-books.tsx) still says what each payout is for.
 */
const widgetsFor = (wide: boolean): Widgets => ({
  [WIDGET_IDS.balance]: {
    type: PARENT_BALANCE_WIDGET_TYPE,
    dataMapping: {
      value: [{ id: "balances.available", aggregation: "sum" }],
      asOf: [{ id: "balances.asOf", aggregation: "last" }],
      waitingCount: [{ id: "ledger.awaitingSecondKey", aggregation: "sum" }],
      waitingTotal: [{ id: "ledger.pendingAmount", aggregation: "sum" }],
      moneyIn: [{ id: "ledger.moneyInThisMonth", aggregation: "sum" }],
    },
  },
  [WIDGET_IDS.chart]: {
    type: "column-chart-grouped",
    dataMapping: {
      categoryKey: [{ id: "events.name" }],
      // Received first: palette 1, the gold. Expected second: palette 2, the dusty rose.
      valueKey: [
        { id: "events.received", aggregation: "sum" },
        { id: "events.expected", aggregation: "sum" },
      ],
    },
    sort: [{ field: { id: "events.expected", aggregation: "sum" }, direction: "desc" }],
    format: {
      title: title("Takings by event"),
      style: {
        theme: {
          common: { legend: { enabled: true, position: "top-right" } },
          bar: { series: { width: 28 } },
        },
        custom: {
          valueAxis: {
            line: { width: 0 },
            tick: { enabled: false },
            gridLine: { enabled: true, style: { stroke: parentTokens.rule, strokeWidth: 1 } },
          },
          categoryAxis: {
            line: { width: 1, stroke: parentTokens.muted },
            tick: { enabled: false },
            gridLine: { enabled: false },
          },
        },
      },
    },
  },
  [WIDGET_IDS.events]: {
    type: "grid",
    dataMapping: {
      cols: [
        { id: "events.name" },
        { id: "events.date" },
        { id: "events.expected", aggregation: "sum" },
        { id: "events.received", aggregation: "sum" },
        { id: "events.difference", aggregation: "sum" },
      ],
    },
    sort: [{ field: { id: "events.date" }, direction: "asc" }],
    format: { title: title("Each event, in dollars"), style: { grandTotalRow: { enabled: true } } },
  },
  [WIDGET_IDS.waiting]: {
    type: "grid",
    dataMapping: {
      cols: wide
        ? [{ id: "waiting.payee" }, { id: "waiting.description" }, { id: "waiting.amount" }, { id: "waiting.signedBy" }, { id: "waiting.stillToSign" }]
        : [{ id: "waiting.payee" }, { id: "waiting.amount" }, { id: "waiting.stillToSign" }],
    },
    format: { title: title("Waiting for a second key") },
  },
  [WIDGET_IDS.ledger]: {
    type: "grid",
    dataMapping: {
      cols: wide
        ? [{ id: "ledger.date" }, { id: "ledger.description" }, { id: "ledger.party" }, { id: "ledger.amount" }, { id: "ledger.status" }]
        : [{ id: "ledger.date" }, { id: "ledger.description" }, { id: "ledger.amount" }, { id: "ledger.status" }],
    },
    sort: [{ field: { id: "ledger.date" }, direction: "desc" }],
    format: { title: title("Money in and out") },
  },
});

export interface ParentStudioSetup {
  mode: AgStudioMode;
  initialState: AgReportState<ParentRegistry>;
  panels: AgPanelConfig;
  theme: AgStudioTheme;
  /** The height Studio's box needs to show the whole canvas without scrolling inside it. */
  heightPx: number;
}

export function parentStudioSetup(width: number): ParentStudioSetup {
  const wide = width >= PARENT_BREAKPOINTS.wide;
  return {
    mode: "view",
    initialState: {
      selectedPageId: PARENT_PAGE_ID,
      pages: [{ id: PARENT_PAGE_ID, widgets: widgetsFor(wide), widgetLayout: wide ? wideLayout() : stackedLayout() }],
    },
    panels: { view: { left: [], right: [] } },
    theme: wide ? parentStudioTheme : parentMediumStudioTheme,
    heightPx: wide ? STUDIO_HEIGHTS.wide : STUDIO_HEIGHTS.medium,
  };
}
