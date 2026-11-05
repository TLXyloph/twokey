/**
 * Studio's widget configuration for the parent ledger: the built-in widgets, the custom parent
 * balance widget (adapted from the board's Live Balance widget, src/ui/studio/widgets.ts), and two
 * overrides of built-ins: a grid prints a shortfall in coral, the page's one warning colour, and a
 * grouped column chart labels its money axis in whole dollars (the board's formatter).
 *
 * The parent page opens in view mode with no panels, so nobody edits it and the AI is not offered;
 * the widget still declares a form, which Studio requires of every widget type.
 */
import type { AgAdditionalCreateWidgetsParams, AgDefaultRegistry, AgDefaultWidgetDefinition, AgWidgetDataFormat, AgWidgetFieldReference, AgWidgetsConfig, ExtractOverride } from "ag-studio";
import { createWidgets, type AgGridWidgetOptions, type AgRegistry, type AgWidgetDefinition } from "ag-studio-react";
import { currencyFieldIds } from "@/demo/studio-data";
import { createChartFormatter } from "@/ui/studio/chart-axis";
import { ParentBalanceWidget } from "./balance-widget";
import { createParentCellRenderer } from "./shortfall-cell";
import { parentStudioData } from "./parent-data";

export const PARENT_BALANCE_WIDGET_TYPE = "parent-balance";

export interface ParentBalanceWidgetState {
  type: typeof PARENT_BALANCE_WIDGET_TYPE;
  dataMapping: {
    /** The balance: one numeric field, aggregated (`balances.available`, sum). */
    value: AgWidgetFieldReference[];
    /** When it was read: one date-time field (`balances.asOf`, last). */
    asOf: AgWidgetFieldReference[];
    waitingCount?: AgWidgetFieldReference[];
    waitingTotal?: AgWidgetFieldReference[];
    moneyIn?: AgWidgetFieldReference[];
  };
  format?: AgWidgetDataFormat<never>;
}

export type ParentBalanceWidgetDefinition = AgWidgetDefinition<typeof PARENT_BALANCE_WIDGET_TYPE, ParentBalanceWidgetState>;

export interface ParentRegistry extends AgRegistry {
  widgets: readonly (AgDefaultWidgetDefinition | ParentBalanceWidgetDefinition)[];
}

type SlotDefinition = NonNullable<ParentBalanceWidgetDefinition["dataMapping"]>["value"];

const numberSlot = (required: boolean): SlotDefinition => ({
  type: "field",
  supportedRoles: ["numeric"],
  requires: { cardinality: "one" },
  required,
});

export const parentBalanceWidgetDefinition: ParentBalanceWidgetDefinition = {
  id: PARENT_BALANCE_WIDGET_TYPE,
  label: "Club balance",
  dataMapping: {
    value: numberSlot(true),
    asOf: { type: "field", supportedRoles: ["temporal"], requires: { cardinality: "one" }, required: true },
    waitingCount: numberSlot(false),
    waitingTotal: numberSlot(false),
    moneyIn: numberSlot(false),
  },
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
  comp: ParentBalanceWidget,
  defaultSize: { width: 960, height: 144 },
  minSize: { width: 320, height: 112 },
};

const gridOverride: ExtractOverride<Extract<AgDefaultWidgetDefinition, { id: "grid" }>> = {
  id: "grid",
  options: { createCellRenderer: createParentCellRenderer } satisfies AgGridWidgetOptions,
};

const columnChartOverride: ExtractOverride<Extract<AgDefaultWidgetDefinition, { id: "column-chart-grouped" }>> = {
  id: "column-chart-grouped",
  options: { formatter: createChartFormatter(currencyFieldIds(parentStudioData())) },
};

/** Studio 3.0 types `overrides` as `never[]` once a custom widget is added (see src/ui/studio/widgets.ts). */
const overrides = [gridOverride, columnChartOverride] as unknown as AgAdditionalCreateWidgetsParams<ParentRegistry>["overrides"];

export const parentWidgets = (defaults: AgWidgetsConfig<AgDefaultRegistry>): AgWidgetsConfig<ParentRegistry> =>
  createWidgets<ParentRegistry>({
    additionalTypes: [parentBalanceWidgetDefinition],
    menu: [...defaults.menu, { label: "TwoKey", widgetIds: [PARENT_BALANCE_WIDGET_TYPE] }],
    overrides,
  });
