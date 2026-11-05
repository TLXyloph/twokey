import type { AgReportState, AgStudioApi } from "ag-studio";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildStudioData } from "@/demo/studio-data";
import {
  SECOND_KEY_WIDGET_ID,
  focusSecondKeyQueue,
  getStudioDataRevision,
  isStudioReady,
  pushBoardData,
  setStudioApi,
  setStudioDataApi,
  subscribeStudioData,
  subscribeStudioReady,
} from "@/ui/studio/studio-handle";
import type { TwoKeyRegistry } from "@/ui/studio/widgets";
import { fixtureClubData } from "../../fixtures/board-view";

type State = AgReportState<TwoKeyRegistry>;
type Api = AgStudioApi<TwoKeyRegistry>;

const grid = { type: "grid", dataMapping: { cols: [] } } as const;

function boardState(): State {
  return {
    selectedPageId: "club-account",
    pages: [
      { id: "notes", widgets: {} },
      {
        id: "club-account",
        widgets: { balances: grid, [SECOND_KEY_WIDGET_ID]: grid },
        selection: { type: "widget", id: "balances" },
      },
    ],
  } as unknown as State;
}

/** Only what the handle may touch: reading and writing state. */
function mockApi(state: State = boardState()) {
  const getState = vi.fn(() => state);
  const setState = vi.fn();
  return { api: { getState, setState } as unknown as Api, getState, setState };
}

afterEach(() => {
  setStudioApi(null);
  vi.unstubAllGlobals();
});

describe("the Studio handle", () => {
  it("fixes the id of the widget the header's button targets", () => {
    expect(SECOND_KEY_WIDGET_ID).toBe("second-key-queue");
  });

  it("is not ready until Studio hands over its API, and not after teardown", () => {
    expect(isStudioReady()).toBe(false);
    setStudioApi(mockApi().api);
    expect(isStudioReady()).toBe(true);
    setStudioApi(null);
    expect(isStudioReady()).toBe(false);
  });

  it("tells subscribers when readiness changes, and stops after they unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeStudioReady(listener);
    const { api } = mockApi();

    setStudioApi(api);
    setStudioApi(api); // the same API again changes nothing
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    setStudioApi(null);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("does nothing and says so while Studio is not ready", () => {
    expect(focusSecondKeyQueue()).toBe(false);
  });
});

describe("focusSecondKeyQueue", () => {
  it("selects the second-key widget on its page, immutably", () => {
    const before = boardState();
    const { api, setState } = mockApi(before);
    setStudioApi(api);

    expect(focusSecondKeyQueue()).toBe(true);

    expect(setState).toHaveBeenCalledTimes(1);
    const after = setState.mock.calls[0]![0] as State;
    expect(after).not.toBe(before);
    expect(after.selectedPageId).toBe("club-account");
    expect(after.pages[1]!.selection).toEqual({ type: "widget", id: SECOND_KEY_WIDGET_ID });
    // Untouched parts keep their identity, so Studio sees only the selection change.
    expect(after.pages[0]).toBe(before.pages[0]);
    expect(after.pages[1]!.widgets).toBe(before.pages[1]!.widgets);
    expect(before.pages[1]!.selection).toEqual({ type: "widget", id: "balances" });
  });

  it("switches to the page that holds the widget when another page is showing", () => {
    const { api, setState } = mockApi({ ...boardState(), selectedPageId: "notes" });
    setStudioApi(api);

    expect(focusSecondKeyQueue()).toBe(true);
    expect((setState.mock.calls[0]![0] as State).selectedPageId).toBe("club-account");
  });

  it("returns false and leaves state alone when the widget has been deleted", () => {
    const state = boardState();
    delete state.pages[1]!.widgets![SECOND_KEY_WIDGET_ID];
    const { api, setState } = mockApi(state);
    setStudioApi(api);

    expect(focusSecondKeyQueue()).toBe(false);
    expect(setState).not.toHaveBeenCalled();
  });

  it("scrolls the selected widget into view and moves focus to it, on the next frame", () => {
    const focusTarget = { focus: vi.fn() };
    const widget = { scrollIntoView: vi.fn(), querySelector: vi.fn(() => focusTarget) };
    const querySelector = vi.fn(() => widget);
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("document", { querySelector });
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    setStudioApi(mockApi().api);

    focusSecondKeyQueue();
    expect(widget.scrollIntoView).not.toHaveBeenCalled(); // Studio re-renders the selection first

    frames.forEach((cb) => cb(0));
    expect(querySelector).toHaveBeenCalledWith(".ag-studio-layout-widget-selected");
    expect(widget.scrollIntoView).toHaveBeenCalledWith({ block: "nearest", behavior: "smooth" });
    expect(focusTarget.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("jumps instead of gliding when the reader asks for reduced motion", () => {
    const widget = { scrollIntoView: vi.fn(), querySelector: vi.fn(() => null) };
    vi.stubGlobal("document", { querySelector: () => widget });
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => cb(0));
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(prefers-reduced-motion: reduce)" }));
    setStudioApi(mockApi().api);

    focusSecondKeyQueue();
    expect(widget.scrollIntoView).toHaveBeenCalledWith({ block: "nearest", behavior: "auto" });
  });
});

describe("outside a browser", () => {
  beforeEach(() => {
    vi.stubGlobal("document", undefined);
    vi.stubGlobal("requestAnimationFrame", undefined);
  });

  it("still selects the widget without touching the DOM", () => {
    const { api, setState } = mockApi();
    setStudioApi(api);
    expect(focusSecondKeyQueue()).toBe(true);
    expect(setState).toHaveBeenCalledTimes(1);
  });
});

describe("pushing the session's board data into Studio", () => {
  /** The handle only calls `setProperty("data", …)` on the API Studio hands over when it is ready. */
  function dataApi() {
    const setProperty = vi.fn();
    return { api: { setProperty } as unknown as Api, setProperty };
  }

  afterEach(() => {
    setStudioDataApi(null);
  });

  it("holds the data until Studio's data engine is ready, then pushes it once", () => {
    const data = fixtureClubData();
    pushBoardData(data);
    const { api, setProperty } = dataApi();
    const revision = getStudioDataRevision();

    setStudioDataApi(api);

    expect(setProperty).toHaveBeenCalledTimes(1);
    expect(setProperty).toHaveBeenCalledWith("data", buildStudioData(data));
    expect(getStudioDataRevision()).toBe(revision + 1);
  });

  it("pushes only when the data object changes, and tells the strip each time", () => {
    const { api, setProperty } = dataApi();
    setStudioDataApi(api);
    setProperty.mockClear(); // the previous test's data went in on wiring
    const listener = vi.fn();
    const unsubscribe = subscribeStudioData(listener);
    const data = fixtureClubData();

    pushBoardData(data);
    pushBoardData(data);
    pushBoardData(fixtureClubData());

    expect(setProperty).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("pushes the latest data again into a new Studio (it starts from the seed)", () => {
    const first = dataApi();
    setStudioDataApi(first.api);
    const data = fixtureClubData();
    pushBoardData(data);
    setStudioDataApi(null);

    const second = dataApi();
    setStudioDataApi(second.api);
    expect(second.setProperty).toHaveBeenCalledWith("data", buildStudioData(data));
  });
});
