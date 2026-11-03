/**
 * The grid widget's one colour rule: a negative difference (takings with no record) prints in the
 * club maroon, the screen's one data hue. Every other cell keeps Studio's own rendering, and a total
 * row stays in ink, so the event that is short is the one red mark. The text is Studio's formatted
 * value, so the true minus sign still says "short" without the colour.
 */
import type { AgWidgetField } from "ag-studio";
import type { AgGridWidgetOptions } from "ag-studio-react";
import type { ComponentProps } from "react";
import { SHORTFALL_FIELD_CONTEXT, type ShortfallFieldContext } from "@/demo/studio-data";
import { tokens } from "./tokens";

type CellRendererFactory = NonNullable<AgGridWidgetOptions["createCellRenderer"]>;
type GridCellProps = ComponentProps<NonNullable<ReturnType<CellRendererFactory>>>;

/** True for a field whose negatives the data marks as shortfalls (see studio-data.ts). */
export function marksShortfall(field: { context?: unknown }): boolean {
  const context = field.context as Partial<ShortfallFieldContext> | undefined;
  return context?.negativeIsShortfall === SHORTFALL_FIELD_CONTEXT.negativeIsShortfall;
}

export function isShortfall(value: unknown): boolean {
  if (typeof value === "bigint") return value < BigInt(0);
  return typeof value === "number" && value < 0;
}

type ShortfallCellProps = Pick<GridCellProps, "value" | "valueFormatted"> & { node?: Pick<GridCellProps["node"], "footer"> };

const isZero = (value: unknown) => (typeof value === "bigint" ? value === BigInt(0) : value === 0);

export function ShortfallCell({ value, valueFormatted, node }: ShortfallCellProps) {
  const text = valueFormatted ?? (value == null ? "" : String(value));
  const marked = isShortfall(value) && node?.footer !== true;
  // A reconciled event (difference zero) is set in grey, the style's rule for a zero balance.
  const color = marked ? tokens.data : isZero(value) ? tokens.muted : undefined;
  return <span style={color ? { color } : undefined}>{text}</span>;
}

/** The grid override's `createCellRenderer`: the shortfall cell for marked fields, Studio's default otherwise. */
export const createTwoKeyCellRenderer: CellRendererFactory = (field: AgWidgetField) =>
  marksShortfall(field) ? ShortfallCell : undefined;
