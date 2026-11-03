/**
 * Value-axis labels for the grouped column chart. Studio labels a multi-series value axis with
 * compact numbers ("1.5K") and offers no setting for it; the takings chart wants "$1,500". This
 * formatter goes in through the chart widget's `options` (see widgets.ts), which Studio spreads over
 * its own chart options, so it replaces Studio's chart-level formatter for grouped column charts:
 *
 * - axis labels: whole dollars when every series on the axis is a currency field; otherwise exactly
 *   Studio's rule (compact above 1,000, else the chart's default);
 * - data labels of a currency series: dollars and cents, as the field formats them;
 * - everything else (tooltips, which Studio formats per series; the category axis): the chart's default.
 */

/** The parts of AG Charts' formatter params this reads (see ag-charts-types formatterOptions.d.ts). */
export interface ChartFormatterParams {
  value: unknown;
  source: string;
  type?: string;
  property?: string;
  key?: string;
  domain?: unknown[];
  boundSeries?: { key: string }[];
}

export type ChartLabelFormatter = (params: ChartFormatterParams) => string | undefined;

const wholeDollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const dollarsAndCents = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const compact = new Intl.NumberFormat(undefined, { notation: "compact", compactDisplay: "short" });
const trueMinus = (text: string) => text.replace("-", "−");

/** "events.received" for a series key such as "events.received.sum-ag-legend-s:Car wash". */
export function fieldIdOfSeriesKey(key: string): string {
  return (key.split("-ag-", 1)[0] ?? key).split(".").slice(0, 2).join(".");
}

/** Studio's own test for compact axis labels: a [min, max] domain reaching past 1,000. */
function domainMax(domain: unknown[] | undefined): number {
  if (!domain || domain.length > 2) return 0;
  return Math.max(0, ...domain.map((v) => Math.abs(Number(v))).filter(Number.isFinite));
}

export function createChartFormatter(currencyFields: ReadonlySet<string>): { y: ChartLabelFormatter } {
  const isMoney = (key: string | undefined) => key !== undefined && currencyFields.has(fieldIdOfSeriesKey(key));

  const y: ChartLabelFormatter = (params) => {
    if (params.type !== "number" || typeof params.value !== "number" || !Number.isFinite(params.value)) return undefined;
    const { value } = params;
    if (params.source === "series-label") return isMoney(params.key) ? trueMinus(dollarsAndCents.format(value)) : undefined;
    if (params.source !== "axis-label" && params.source !== "crosshair") return undefined;
    const series = params.boundSeries ?? [];
    if (series.length > 0 && series.every((s) => isMoney(s.key))) return trueMinus(wholeDollars.format(value));
    return domainMax(params.domain) > 1000 ? compact.format(value) : undefined;
  };
  return { y };
}
