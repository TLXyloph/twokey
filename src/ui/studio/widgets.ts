/**
 * Studio's widget configuration for TwoKey: the built-in widgets plus the custom "Live Balance"
 * widget (the balances strip), which is added to the end of the widget menu (and so to the AI's
 * widget catalogue), and two overrides of built-in widgets: in a grid a shortfall prints in the data
 * hue, and a grouped column chart labels a money axis in whole dollars.
 */
import type {
  AgAdditionalCreateWidgetsParams,
  AgDefaultRegistry,
  AgDefaultWidgetDefinition,
  AgExternalShape,
  AgShapeBuilder,
  AgStudioApi,
  AgWidgetDataFormat,
  AgWidgetFieldReference,
  AgWidgetsConfig,
  ExtractOverride,
} from "ag-studio";
import { createWidgets, type AgGridWidgetOptions, type AgRegistry, type AgWidgetDefinition } from "ag-studio-react";
import { buildStudioData, currencyFieldIds } from "@/demo/studio-data";
import { createChartFormatter } from "./chart-axis";
import { LiveBalanceWidget } from "./live-balance-widget";
import { createTwoKeyCellRenderer } from "./shortfall-cell";

export const LIVE_BALANCE_WIDGET_TYPE = "live-balance";

/** The widget has no style options of its own; it takes everything from the theme. */
export type LiveBalanceFormat = AgWidgetDataFormat<never>;

export interface LiveBalanceWidgetState {
  type: typeof LIVE_BALANCE_WIDGET_TYPE;
  dataMapping: {
    /** The balance: one numeric field, aggregated (e.g. `balances.available` with `sum`). */
    value: AgWidgetFieldReference[];
    /** When the balance was read: one date-time field, aggregated (e.g. `balances.asOf` with `last`). */
    asOf: AgWidgetFieldReference[];
    /** Optional: how many payouts wait for a second key (e.g. `ledger.awaitingSecondKey` with `sum`). */
    waitingCount?: AgWidgetFieldReference[];
    /** Optional: their total, which adds the second cell (e.g. `ledger.pendingAmount` with `sum`). */
    waitingTotal?: AgWidgetFieldReference[];
    /** Optional: money in this month, which adds the third cell (e.g. `ledger.moneyInThisMonth` with `sum`). */
    moneyIn?: AgWidgetFieldReference[];
  };
  format?: LiveBalanceFormat;
}

export type LiveBalanceWidgetDefinition = AgWidgetDefinition<typeof LIVE_BALANCE_WIDGET_TYPE, LiveBalanceWidgetState>;

export interface TwoKeyRegistry extends AgRegistry {
  widgets: readonly (AgDefaultWidgetDefinition | LiveBalanceWidgetDefinition)[];
}

/**
 * The shape of the widget's `format`, which Studio parses saved state with and shows the AI when it
 * configures the widget. It must declare every format key the form writes (titles and cross-filter),
 * because a format shape drops the keys it does not declare.
 */
function buildFormatShape(s: AgShapeBuilder) {
  const typography = s.object({
    fontFamily: s.string().optional(),
    fontSize: s.number({ description: "Font size in pixels." }).optional(),
    fontWeight: s.enum(["normal", "bold"]).optional(),
    fontStyle: s.enum(["normal", "italic"]).optional(),
  });
  const title = s.object({
    enabled: s.boolean({ description: "Whether to show it. When true, also set text." }).optional(),
    text: s.string().optional(),
    typography: typography.optional(),
    color: s.string({ description: "CSS colour. Leave unset to follow the theme." }).optional(),
    textAlign: s.enum(["left", "center", "right"]).optional(),
    wrapping: s.boolean().optional(),
  });
  return s
    .object(
      {
        title: title.optional(),
        subtitle: title.optional(),
        caption: title.optional(),
        crossFilter: s.enum(["highlight", "filter", "none"]).optional(),
      },
      { description: "Titles only. Leave unset unless the user asks for a title." },
    )
    .optional();
}

/**
 * Studio 3.0 exports no standalone shape builder for `formatShape`. `api.defineAiCommand` hands its
 * factory the same builder Studio builds its own widgets' format shapes with, so this borrows it; the
 * command itself is never run. If that API is missing, the widget still works, but the AI cannot
 * set its titles.
 */
function liveBalanceFormatShape({ api }: { api: AgStudioApi }): AgExternalShape<LiveBalanceFormat | undefined> {
  if (typeof api.defineAiCommand !== "function") {
    // Studio treats a missing format shape as "no format schema".
    return undefined as unknown as AgExternalShape<LiveBalanceFormat | undefined>;
  }
  const command = api.defineAiCommand((s) => ({
    input: buildFormatShape(s),
    execute: () => ({ success: true as const, value: undefined }),
  }));
  return command.shape as unknown as AgExternalShape<LiveBalanceFormat | undefined>;
}

type StripSlotDefinition = NonNullable<LiveBalanceWidgetDefinition["dataMapping"]>["value"];

/** One numeric field, aggregated: every money and count slot of the strip. */
const numberSlot = (required: boolean, aiDescription: string): StripSlotDefinition => ({
  type: "field",
  supportedRoles: ["numeric"],
  requires: { cardinality: "one" },
  required,
  aiDescription,
});

export const liveBalanceWidgetDefinition: LiveBalanceWidgetDefinition = {
  id: LIVE_BALANCE_WIDGET_TYPE,
  label: "Live Balance",
  dataMapping: {
    value: numberSlot(true, "The balance amount: one currency field, aggregated with sum, e.g. balances.available. Fills the first cell."),
    asOf: {
      type: "field",
      supportedRoles: ["temporal"],
      requires: { cardinality: "one" },
      required: true,
      aiDescription:
        "When the balance was read: one date-time field, aggregated with last, e.g. balances.asOf. " +
        "It captions the first cell and names the month of the money-in cell.",
    },
    waitingCount: numberSlot(
      false,
      "Optional. How many payouts wait for a second key: a 1-or-0 helper aggregated with sum, " +
        "e.g. ledger.awaitingSecondKey. Captions the second cell ('2 payouts'). Map it together with waitingTotal.",
    ),
    waitingTotal: numberSlot(
      false,
      "Optional. The total of the payouts waiting for a second key, a positive currency helper aggregated with sum, " +
        "e.g. ledger.pendingAmount. Mapping it adds the second cell; a zero reads 'Nothing waiting'.",
    ),
    moneyIn: numberSlot(
      false,
      "Optional. Completed money in during the balance's month, a currency helper aggregated with sum, " +
        "e.g. ledger.moneyInThisMonth. Mapping it adds the third cell, labelled with the month.",
    ),
  },
  formatShape: liveBalanceFormatShape,
  form: (params) =>
    params.createDefaults({
      dataMappingItems: [
        { key: "value", label: "Balance" },
        { key: "asOf", label: "As of" },
        { key: "waitingTotal", label: "Waiting for a second key" },
        { key: "waitingCount", label: "Payouts waiting" },
        { key: "moneyIn", label: "Money in this month" },
      ],
    }),
  comp: LiveBalanceWidget,
  defaultSize: { width: 960, height: 112 },
  minSize: { width: 280, height: 96 },
  ai: {
    label: "Live Balance",
    description:
      "A strip of up to three figures in one card, split by thin dividers, each a grey label over a large figure " +
      "over a grey caption: the account's available balance (captioned with the PayPal sandbox and its as-of time), " +
      "the total of payouts waiting for a second key (captioned with their count), and money in this month. " +
      "The second and third cells appear only when their slots are mapped.",
    usage:
      "Use once, across the top of the club account page, for its headline balances. Not for trends, comparisons " +
      "or breakdowns by category; each cell holds one figure.",
    configuration:
      "Map value to balances.available (sum) and asOf to balances.asOf (last). For the full strip also map " +
      "waitingTotal to ledger.pendingAmount (sum), waitingCount to ledger.awaitingSecondKey (sum) and moneyIn to " +
      "ledger.moneyInThisMonth (sum). Each table is queried on its own, so mixing balances and ledger fields is safe. " +
      "Leave the widget title off: every cell carries its own label. Give it the full page width and about 7 rows.",
  },
};

/** The built-in grid, with one cell renderer: a negative difference prints in the data hue. */
const gridOverride: ExtractOverride<Extract<AgDefaultWidgetDefinition, { id: "grid" }>> = {
  id: "grid",
  options: { createCellRenderer: createTwoKeyCellRenderer } satisfies AgGridWidgetOptions,
};

/**
 * The built-in grouped column chart, with value-axis labels in whole dollars for money series
 * ("$1,500"). Studio spreads a chart widget's `options` over its own chart options, and has no
 * setting for axis labels; see ./chart-axis.ts for what the formatter keeps of Studio's behaviour.
 */
const columnChartOverride: ExtractOverride<Extract<AgDefaultWidgetDefinition, { id: "column-chart-grouped" }>> = {
  id: "column-chart-grouped",
  options: { formatter: createChartFormatter(currencyFieldIds(buildStudioData())) },
};

/**
 * Studio 3.0 types `overrides` as `never[]` for any registry that adds a custom widget, because its
 * `ExtractOverride` tests the whole union of widget ids at once. The overrides above are checked
 * against each widget's own definition instead and passed through unchanged.
 */
const overrides = [gridOverride, columnChartOverride] as unknown as AgAdditionalCreateWidgetsParams<TwoKeyRegistry>["overrides"];

/**
 * The `widgets` property. A function, so the built-in menu is kept and the Live Balance group is
 * added to it: a `menu` replaces the default one, and the AI only builds widgets the menu lists.
 */
export const twoKeyWidgets = (defaults: AgWidgetsConfig<AgDefaultRegistry>): AgWidgetsConfig<TwoKeyRegistry> =>
  createWidgets<TwoKeyRegistry>({
    additionalTypes: [liveBalanceWidgetDefinition],
    menu: [...defaults.menu, { label: "TwoKey", widgetIds: [LIVE_BALANCE_WIDGET_TYPE] }],
    overrides,
  });
