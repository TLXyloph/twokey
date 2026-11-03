import { describe, expect, it } from "vitest";
import { AI_PANEL_WIDTH, BOARD_PAGE_ID, boardInitialState } from "@/ui/studio/board-layout";
import { boardStudioSetup, boardViewport, type BoardViewport } from "@/ui/studio/board-viewport";
import { SECOND_KEY_WIDGET_ID } from "@/ui/studio/studio-handle";

type Box = { xTrack: number; yTrack: number; xSpan: number; ySpan: number };
const layoutOf = (viewport: BoardViewport) =>
  boardStudioSetup(viewport).initialState.pages.find((p) => p.id === BOARD_PAGE_ID)!.widgetLayout as Record<string, Box>;

describe("boardViewport", () => {
  it("keeps the AI panel open only where the canvas still gets Studio's 720px beside it", () => {
    expect(boardViewport(1440)).toBe("wide");
    expect(boardViewport(1220)).toBe("wide");
    expect(boardViewport(1219)).toBe("medium");
    expect(boardViewport(900)).toBe("medium");
    expect(boardViewport(899)).toBe("compact");
    expect(boardViewport(640)).toBe("compact");
    expect(boardViewport(639)).toBe("phone");
    expect(boardViewport(390)).toBe("phone");
  });
});

describe("boardStudioSetup", () => {
  it("opens wide screens in edit mode with the AI Assistant open and the desktop layout", () => {
    const setup = boardStudioSetup("wide");
    expect(setup.mode).toBe("edit");
    expect(setup.panels).toBeUndefined();
    expect(setup.compactCanvas).toBe(false);
    expect(setup.initialState).toBe(boardInitialState);
    expect(setup.initialState.panels?.ai).toEqual({ width: AI_PANEL_WIDTH });
  });

  it("folds the AI Assistant to its rail on a medium screen, so the canvas keeps its width", () => {
    const setup = boardStudioSetup("medium");
    expect(setup.mode).toBe("edit");
    expect(setup.initialState.panels?.ai).toEqual({ collapsed: true });
    expect(setup.initialState.panels?.data).toEqual({ collapsed: true });
    expect(layoutOf("medium")).toEqual(layoutOf("wide"));
  });

  it.each(["compact", "phone"] as const)("shows the board read-only with no panels on a %s screen", (viewport) => {
    const setup = boardStudioSetup(viewport);
    expect(setup.mode).toBe("view");
    expect(setup.panels).toEqual({ view: { left: [], right: [] } });
    expect(setup.compactCanvas).toBe(true);
  });

  it.each(["compact", "phone"] as const)("stacks every widget full width on a %s screen, the queue before the events", (viewport) => {
    const layout = layoutOf(viewport);
    const order = Object.entries(layout)
      .sort(([, a], [, b]) => a.yTrack - b.yTrack)
      .map(([id]) => id);
    expect(order).toEqual(["balances", "event-takings-chart", SECOND_KEY_WIDGET_ID, "event-takings"]);
    let next = 0;
    for (const id of order) {
      expect(layout[id], id).toMatchObject({ xTrack: 0, xSpan: 24, yTrack: next });
      next += layout[id]!.ySpan;
    }
  });

  it("gives the strip room for its three cells stacked on a phone", () => {
    expect(layoutOf("phone").balances!.ySpan).toBeGreaterThan(layoutOf("compact").balances!.ySpan);
  });

  it("never changes the widgets themselves, only where they sit", () => {
    const widgetsOf = (v: BoardViewport) => boardStudioSetup(v).initialState.pages[0]!.widgets;
    for (const v of ["medium", "compact", "phone"] as const) expect(widgetsOf(v)).toBe(widgetsOf("wide"));
  });
});
