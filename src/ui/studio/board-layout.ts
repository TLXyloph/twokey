/**
 * The board's initial report state: one page, "Club account", on Studio's 24-column canvas with
 * 16px rows. Read top to bottom it answers the officers' questions in order:
 *
 *   1. What do we hold, what is waiting, what came in? The balances strip, full width.
 *   2. Did each event's takings arrive? Received (maroon, the one data hue) against expected (grey),
 *      largest expected first, so the car wash's missing takings lead.
 *   3. What needs my key? The waiting payouts, beside the events they will be judged against.
 *
 * Studio reads `initialState` once; after that the officers (or the AI) own the layout.
 */
import type { AgReportState, AgStudioLocaleText, AgWidgetLayoutState } from "ag-studio";
import { SECOND_KEY_WIDGET_ID } from "./studio-handle";
import { tokens } from "./tokens";
import { LIVE_BALANCE_WIDGET_TYPE, type TwoKeyRegistry } from "./widgets";

export const BOARD_PAGE_ID = "club-account";

/** The open AI Assistant's width at 1440: Studio's default (about 350px) clipped the events grid. */
export const AI_PANEL_WIDTH = 304;

/**
 * Studio names a summed field "Received (sum)" in grid headers and chart legends. The board's
 * headers and legend read as plain names; the aggregation stays visible on the field's own pill.
 */
export const boardLocaleText: AgStudioLocaleText = { aggregationSumFieldName: "${name}" };

/** Position on the canvas grid, in tracks: 24 columns wide, 16px rows. */
const at = (xTrack: number, yTrack: number, xSpan: number, ySpan: number): AgWidgetLayoutState => ({ xTrack, yTrack, xSpan, ySpan });

const title = (text: string) => ({ enabled: true, text });

export const boardInitialState: AgReportState<TwoKeyRegistry> = {
  selectedPageId: BOARD_PAGE_ID,
  pages: [
    {
      id: BOARD_PAGE_ID,
      widgets: {
        balances: {
          type: LIVE_BALANCE_WIDGET_TYPE,
          dataMapping: {
            value: [{ id: "balances.available", aggregation: "sum" }],
            asOf: [{ id: "balances.asOf", aggregation: "last" }],
            waitingCount: [{ id: "ledger.awaitingSecondKey", aggregation: "sum" }],
            waitingTotal: [{ id: "ledger.pendingAmount", aggregation: "sum" }],
            moneyIn: [{ id: "ledger.moneyInThisMonth", aggregation: "sum" }],
          },
        },
        "event-takings-chart": {
          type: "column-chart-grouped",
          dataMapping: {
            categoryKey: [{ id: "events.name" }],
            // Received first: palette 1, the club maroon. Expected second: palette 2, grey.
            valueKey: [
              { id: "events.received", aggregation: "sum" },
              { id: "events.expected", aggregation: "sum" },
            ],
          },
          sort: [{ field: { id: "events.expected", aggregation: "sum" }, direction: "desc" }],
          format: {
            // The legend names the two series, so the title only names the subject.
            title: title("Takings by event"),
            style: {
              theme: {
                common: { legend: { enabled: true, position: "top-right" } },
                bar: { series: { width: 24 } },
              },
              custom: {
                valueAxis: {
                  line: { width: 0 },
                  tick: { enabled: false },
                  gridLine: { enabled: true, style: { stroke: tokens.border, strokeWidth: 1 } },
                },
                categoryAxis: {
                  line: { width: 1, stroke: tokens.control },
                  tick: { enabled: false },
                  gridLine: { enabled: false },
                },
              },
            },
          },
        },
        [SECOND_KEY_WIDGET_ID]: {
          type: "grid",
          dataMapping: {
            cols: [
              { id: "waiting.payee" },
              { id: "waiting.description" },
              { id: "waiting.amount" },
              { id: "waiting.signedBy" },
              { id: "waiting.stillToSign" },
            ],
          },
          format: { title: title("Waiting for a second key") },
        },
        "event-takings": {
          type: "grid",
          dataMapping: {
            // Summed (one row per event either way) so the grid can close with a labelled total.
            cols: [
              { id: "events.name" },
              { id: "events.date" },
              { id: "events.expected", aggregation: "sum" },
              { id: "events.received", aggregation: "sum" },
              { id: "events.difference", aggregation: "sum" },
            ],
          },
          sort: [{ field: { id: "events.date" }, direction: "asc" }],
          format: { title: title("Fundraising events"), style: { grandTotalRow: { enabled: true } } },
        },
      },
      widgetLayout: {
        balances: at(0, 0, 24, 8),
        "event-takings-chart": at(0, 8, 12, 19),
        "event-takings": at(12, 8, 12, 19),
        [SECOND_KEY_WIDGET_ID]: at(0, 27, 24, 12),
      },
    },
  ],
  // Leave the AI Assistant panel open, at 304px (its suggestions still fit on one line) so the canvas
  // keeps the width the events grid's five columns need; fold the right-hand panels away.
  panels: { ai: { width: AI_PANEL_WIDTH }, filters: { collapsed: true }, edit: { collapsed: true }, data: { collapsed: true } },
};
