import { isValidElement, type ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { buildStudioData, SHORTFALL_FIELD_CONTEXT } from "@/demo/studio-data";
import { createTwoKeyCellRenderer, isShortfall, marksShortfall, ShortfallCell } from "@/ui/studio/shortfall-cell";
import { tokens } from "@/ui/studio/tokens";

type CellProps = Parameters<typeof ShortfallCell>[0];
const cell = (value: unknown, valueFormatted: string | null) => ShortfallCell({ value, valueFormatted } as CellProps) as ReactElement<{ style?: { color?: string }; children?: unknown }>;

describe("which grid columns can mark a shortfall", () => {
  it("is the field the data marks as one (the events' difference)", () => {
    const events = buildStudioData().sources.find((s) => s.id === "events");
    const marked = (events && "fields" in events ? (events.fields ?? []) : []).filter((f) => marksShortfall(f));
    expect(marked.map((f) => f.id)).toEqual(["difference"]);
  });

  it("is no other field", () => {
    expect(marksShortfall({ context: undefined })).toBe(false);
    expect(marksShortfall({ context: { somethingElse: true } })).toBe(false);
    expect(marksShortfall({ context: SHORTFALL_FIELD_CONTEXT })).toBe(true);
  });

  it("gives that column the shortfall renderer and leaves every other column to Studio", () => {
    expect(createTwoKeyCellRenderer({ context: SHORTFALL_FIELD_CONTEXT } as never)).toBe(ShortfallCell);
    expect(createTwoKeyCellRenderer({ context: undefined } as never)).toBeUndefined();
  });
});

describe("a shortfall", () => {
  it("is a negative difference", () => {
    expect(isShortfall(-1290)).toBe(true);
    expect(isShortfall(-0.01)).toBe(true);
    expect(isShortfall(BigInt(-1))).toBe(true);
  });

  it("is not a zero, a surplus or a missing value", () => {
    for (const value of [0, -0, 15, null, undefined, "", "-5", Number.NaN]) {
      expect(isShortfall(value), String(value)).toBe(false);
    }
  });
});

describe("the shortfall cell", () => {
  it("prints a negative difference, as Studio formatted it, in the club maroon", () => {
    const element = cell(-1290, "−$1,290.00");
    expect(isValidElement(element)).toBe(true);
    expect(element.props.style?.color).toBe(tokens.data);
    expect(element.props.children).toBe("−$1,290.00");
  });

  it("prints a positive difference in the row's own ink", () => {
    const element = cell(15, "$15.00");
    expect(element.props.style?.color).toBeUndefined();
    expect(element.props.children).toBe("$15.00");
  });

  it("prints a zero difference (the event reconciled) in grey, so only the gap draws the eye", () => {
    for (const value of [0, -0, BigInt(0)]) {
      const element = cell(value, "$0.00");
      expect(element.props.style?.color, String(value)).toBe(tokens.muted);
      expect(element.props.children).toBe("$0.00");
    }
  });

  it("keeps the total row in ink, so the event that is short is the one red mark", () => {
    const total = ShortfallCell({ value: -1290, valueFormatted: "−$1,290.00", node: { footer: true } } as CellProps) as ReactElement<{
      style?: { color?: string };
    }>;
    expect(total.props.style?.color).toBeUndefined();
  });

  it("falls back to the raw value when Studio sent no formatted text", () => {
    expect(cell(12, null).props.children).toBe("12");
    expect(cell(null, null).props.children).toBe("");
  });
});
