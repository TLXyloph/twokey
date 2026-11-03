/**
 * Studio's widget configuration for TwoKey: the built-in widgets plus the custom "Live Balance"
 * widget, which is added to the end of the widget menu (and so to the AI's widget catalogue).
 */
import type {
  AgDefaultRegistry,
  AgDefaultWidgetDefinition,
  AgExternalShape,
  AgShapeBuilder,
  AgStudioApi,
  AgWidgetDataFormat,
  AgWidgetFieldReference,
  AgWidgetsConfig,
} from "ag-studio";
import { createWidgets, type AgRegistry, type AgWidgetDefinition } from "ag-studio-react";
import { LiveBalanceWidget } from "./live-balance-widget";

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

export const liveBalanceWidgetDefinition: LiveBalanceWidgetDefinition = {
  id: LIVE_BALANCE_WIDGET_TYPE,
  label: "Live Balance",
  dataMapping: {
    value: {
      type: "field",
      supportedRoles: ["numeric"],
      requires: { cardinality: "one" },
      required: true,
      aiDescription: "The balance amount: one currency field, aggregated with sum, e.g. balances.available.",
    },
    asOf: {
      type: "field",
      supportedRoles: ["temporal"],
      requires: { cardinality: "one" },
      required: true,
      aiDescription: "When the balance was read: one date-time field, aggregated with last, e.g. balances.asOf.",
    },
  },
  formatShape: liveBalanceFormatShape,
  form: (params) =>
    params.createDefaults({
      dataMappingItems: [
        { key: "value", label: "Balance" },
        { key: "asOf", label: "As of" },
      ],
    }),
  comp: LiveBalanceWidget,
  defaultSize: { width: 320, height: 180 },
  minSize: { width: 220, height: 140 },
  ai: {
    label: "Live Balance",
    description: "One large currency figure: the club account's current balance, with an 'as of' time and a PayPal sandbox caption.",
    usage: "Use for the account's current balance from the one-row balances table. Not for totals over many rows, trends or comparisons.",
    configuration: "Map value to balances.available (aggregation sum) and asOf to balances.asOf (aggregation last).",
  },
};

/**
 * The `widgets` property. A function, so the built-in menu is kept and the Live Balance group is
 * added to it: a `menu` replaces the default one, and the AI only builds widgets the menu lists.
 */
export const twoKeyWidgets = (defaults: AgWidgetsConfig<AgDefaultRegistry>): AgWidgetsConfig<TwoKeyRegistry> =>
  createWidgets<TwoKeyRegistry>({
    additionalTypes: [liveBalanceWidgetDefinition],
    menu: [...defaults.menu, { label: "TwoKey", widgetIds: [LIVE_BALANCE_WIDGET_TYPE] }],
  });
