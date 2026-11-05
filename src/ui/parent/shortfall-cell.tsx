/**
 * The parent grid's one colour rule, the board's (src/ui/studio/shortfall-cell.tsx) in team colours:
 * a negative difference (takings with no record) prints in coral, and a reconciled event's zero in
 * the quieter gold. Every other cell keeps Studio's rendering; a total row stays in the ink. The text
 * is Studio's formatted value, so the true minus sign still says "short" without the colour.
 */
import type { AgWidgetField } from "ag-studio";
import type { AgGridWidgetOptions } from "ag-studio-react";
import type { ComponentProps } from "react";
import { isShortfall, marksShortfall } from "@/ui/studio/shortfall-cell";
import { parentTokens } from "./tokens";

type CellRendererFactory = NonNullable<AgGridWidgetOptions["createCellRenderer"]>;
type GridCellProps = ComponentProps<NonNullable<ReturnType<CellRendererFactory>>>;
type CellProps = Pick<GridCellProps, "value" | "valueFormatted"> & { node?: Pick<GridCellProps["node"], "footer"> };

const isZero = (value: unknown) => (typeof value === "bigint" ? value === BigInt(0) : value === 0);

export function ParentShortfallCell({ value, valueFormatted, node }: CellProps) {
  const text = valueFormatted ?? (value == null ? "" : String(value));
  const marked = isShortfall(value) && node?.footer !== true;
  const color = marked ? parentTokens.short : isZero(value) ? parentTokens.muted : undefined;
  return <span style={color ? { color, fontWeight: marked ? 600 : undefined } : undefined}>{text}</span>;
}

export const createParentCellRenderer: CellRendererFactory = (field: AgWidgetField) => (marksShortfall(field) ? ParentShortfallCell : undefined);
