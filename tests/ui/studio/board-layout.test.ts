import { describe, expect, it } from "vitest";
import { buildStudioData } from "@/demo/studio-data";
import { BOARD_PAGE_ID, boardInitialState, boardLocaleText } from "@/ui/studio/board-layout";
import { SECOND_KEY_WIDGET_ID } from "@/ui/studio/studio-handle";
import { LIVE_BALANCE_WIDGET_TYPE } from "@/ui/studio/widgets";

const page = boardInitialState.pages.find((p) => p.id === BOARD_PAGE_ID)!;
const widgets = page.widgets as Record<string, any>;
const ids = (refs: { id: string }[]) => refs.map((r) => r.id);

const declared = new Map<string, { hide?: boolean }>();
for (const source of buildStudioData().sources) {
  if (!("data" in source)) continue;
  for (const field of source.fields ?? []) declared.set(`${source.id}.${field.id}`, field);
}

describe("the board's initial state", () => {
  it("opens on the club account page with the strip, the chart and the two grids", () => {
    expect(boardInitialState.selectedPageId).toBe(BOARD_PAGE_ID);
    expect(Object.keys(widgets)).toEqual(["balances", "event-takings-chart", SECOND_KEY_WIDGET_ID, "event-takings"]);
  });

  it("maps the strip's five slots to the helpers the header's figures agree with, with no title", () => {
    const strip = widgets.balances;
    expect(strip.type).toBe(LIVE_BALANCE_WIDGET_TYPE);
    expect(strip.dataMapping).toEqual({
      value: [{ id: "balances.available", aggregation: "sum" }],
      asOf: [{ id: "balances.asOf", aggregation: "last" }],
      waitingCount: [{ id: "ledger.awaitingSecondKey", aggregation: "sum" }],
      waitingTotal: [{ id: "ledger.pendingAmount", aggregation: "sum" }],
      moneyIn: [{ id: "ledger.moneyInThisMonth", aggregation: "sum" }],
    });
    expect(strip.format?.title?.enabled ?? false).toBe(false);
  });

  it("draws received before expected, so received takes the maroon and expected the grey", () => {
    const chart = widgets["event-takings-chart"];
    expect(chart.type).toBe("column-chart-grouped");
    expect(ids(chart.dataMapping.categoryKey)).toEqual(["events.name"]);
    expect(ids(chart.dataMapping.valueKey)).toEqual(["events.received", "events.expected"]);
    expect(chart.sort).toEqual([{ field: { id: "events.expected", aggregation: "sum" }, direction: "desc" }]);
    expect(chart.format.title).toEqual({ enabled: true, text: "Takings by event" });
  });

  it("keeps the columns thin and the legend on", () => {
    const style = widgets["event-takings-chart"].format.style;
    expect(style.theme.bar.series.width).toBeLessThanOrEqual(56);
    expect(style.theme.common.legend.enabled).toBe(true);
    expect(style.custom.valueAxis.line.width).toBe(0);
  });

  it("lists the waiting payouts under the id the header's button targets", () => {
    const queue = widgets[SECOND_KEY_WIDGET_ID];
    expect(queue.type).toBe("grid");
    expect(ids(queue.dataMapping.cols)).toEqual(["waiting.payee", "waiting.description", "waiting.amount", "waiting.signedBy", "waiting.stillToSign"]);
    expect(queue.format.title).toEqual({ enabled: true, text: "Waiting for a second key" });
  });

  it("lists the events by date and closes with a total of the money columns", () => {
    const events = widgets["event-takings"];
    expect(ids(events.dataMapping.cols)).toEqual(["events.name", "events.date", "events.expected", "events.received", "events.difference"]);
    expect(events.dataMapping.cols.map((c: { aggregation?: string }) => c.aggregation)).toEqual([undefined, undefined, "sum", "sum", "sum"]);
    expect(events.sort).toEqual([{ field: { id: "events.date" }, direction: "asc" }]);
    expect(events.format.title).toEqual({ enabled: true, text: "Fundraising events" });
    expect(events.format.style.grandTotalRow).toEqual({ enabled: true });
  });

  it("lists the waiting payouts row by row, with no total (the strip states it)", () => {
    for (const col of widgets[SECOND_KEY_WIDGET_ID].dataMapping.cols) expect(col.aggregation, col.id).toBeUndefined();
    expect(widgets[SECOND_KEY_WIDGET_ID].format.style?.grandTotalRow).toBeUndefined();
  });

  it("names a summed field plainly, so no header or legend reads '(sum)'", () => {
    expect(boardLocaleText).toEqual({ aggregationSumFieldName: "${name}" });
  });

  it("refers only to fields the data declares and shows", () => {
    const refs = Object.values(widgets).flatMap((w) => Object.values(w.dataMapping as Record<string, { id: string }[]>).flat());
    for (const { id } of refs) {
      expect(declared.has(id), id).toBe(true);
      expect(declared.get(id)?.hide, id).toBeFalsy();
    }
  });
});

describe("the board's layout", () => {
  const layout = page.widgetLayout as Record<string, { xTrack: number; yTrack: number; xSpan: number; ySpan: number }>;

  it("places every widget, inside the 24 columns", () => {
    expect(Object.keys(layout).sort()).toEqual(Object.keys(widgets).sort());
    for (const [id, box] of Object.entries(layout)) {
      expect(box.xTrack, id).toBeGreaterThanOrEqual(0);
      expect(box.xTrack + box.xSpan, id).toBeLessThanOrEqual(24);
    }
  });

  it("runs the strip full width, pairs the chart with the events on one bottom edge, and gives the queue the width it needs", () => {
    expect(layout.balances).toMatchObject({ xTrack: 0, xSpan: 24, yTrack: 0 });
    const chart = layout["event-takings-chart"]!;
    const events = layout["event-takings"]!;
    expect(chart).toMatchObject({ xTrack: 0, yTrack: layout.balances!.ySpan });
    expect(chart.xTrack + chart.xSpan).toBe(events.xTrack);
    expect(events.xTrack + events.xSpan).toBe(24);
    expect([chart.yTrack, chart.ySpan]).toEqual([events.yTrack, events.ySpan]);
    // Five text-heavy columns need about 750px; half the canvas beside the AI panel is about 450px.
    expect(layout[SECOND_KEY_WIDGET_ID]).toMatchObject({ xTrack: 0, xSpan: 24, yTrack: chart.yTrack + chart.ySpan });
  });

  it("fits the strip, the chart row and the queue on one 1440 x 900 screen under the header", () => {
    const rows = Math.max(...Object.values(layout).map((b) => b.yTrack + b.ySpan));
    expect(rows * 16).toBeLessThanOrEqual(900 - 130 - 16 * 2);
  });

  it("overlaps nothing", () => {
    const boxes = Object.entries(layout);
    for (const [a, p] of boxes) {
      for (const [b, q] of boxes) {
        if (a >= b) continue;
        const apart = p.xTrack + p.xSpan <= q.xTrack || q.xTrack + q.xSpan <= p.xTrack || p.yTrack + p.ySpan <= q.yTrack || q.yTrack + q.ySpan <= p.yTrack;
        expect(apart, `${a} / ${b}`).toBe(true);
      }
    }
  });
});
