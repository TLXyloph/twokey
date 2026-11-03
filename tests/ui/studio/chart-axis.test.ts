import { describe, expect, it } from "vitest";
import { buildStudioData, currencyFieldIds } from "@/demo/studio-data";
import { createChartFormatter, fieldIdOfSeriesKey, type ChartFormatterParams } from "@/ui/studio/chart-axis";

const usd = currencyFieldIds(buildStudioData());
const format = createChartFormatter(usd).y;
const takings = [{ key: "events.received.sum" }, { key: "events.expected.sum" }];
const axisLabel = (value: number, boundSeries = takings, domain: unknown[] = [0, 1500]): ChartFormatterParams => ({
  value,
  source: "axis-label",
  type: "number",
  property: "y",
  domain,
  boundSeries,
});

describe("the currency fields a chart axis may print in dollars", () => {
  it("are the data's currency fields, and no others", () => {
    expect([...usd]).toEqual(expect.arrayContaining(["events.expected", "events.received", "events.difference", "ledger.amount", "balances.available", "waiting.amount"]));
    expect(usd.has("events.unitsLogged")).toBe(false);
    expect(usd.has("ledger.awaitingSecondKey")).toBe(false);
  });

  it("are found from a series key, whatever Studio appends to it", () => {
    expect(fieldIdOfSeriesKey("events.received.sum")).toBe("events.received");
    expect(fieldIdOfSeriesKey("events.received.sum-ag-legend-s:Car wash")).toBe("events.received");
    expect(fieldIdOfSeriesKey("events.received.sum-ag-filtered")).toBe("events.received");
  });
});

describe("the value axis of a grouped column chart", () => {
  it("prints whole dollars when every series on it is money", () => {
    expect([0, 500, 1000, 1500].map((v) => format(axisLabel(v)))).toEqual(["$0", "$500", "$1,000", "$1,500"]);
  });

  it("falls back to Studio's own rule for anything else: compact above 1,000, else the chart's default", () => {
    const counts = [{ key: "events.unitsLogged.sum" }];
    expect(format(axisLabel(1500, counts, [0, 1500]))).toBe("1.5K");
    expect(format(axisLabel(50, counts, [0, 90]))).toBeUndefined();
    expect(format(axisLabel(1500, [...takings, ...counts]))).toBe("1.5K");
  });

  it("does not claim dollars when it cannot tell which series it is labelling", () => {
    expect(format(axisLabel(1500, []))).toBe("1.5K");
  });

  it("prints a money data label to the cent, as the field does", () => {
    const label = { ...axisLabel(1280), source: "series-label" as const, key: "events.received.sum", boundSeries: undefined };
    expect(format(label)).toBe("$1,280.00");
  });

  it("leaves tooltips and non-numeric values to the chart", () => {
    expect(format({ ...axisLabel(1280), source: "tooltip" })).toBeUndefined();
    expect(format({ ...axisLabel(1280), type: "category", value: "Car wash" as never })).toBeUndefined();
  });
});
