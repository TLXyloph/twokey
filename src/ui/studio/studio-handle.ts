/**
 * The links between the board's own markup and AG Studio:
 *
 * - the API Studio hands over in `onApiReady`, so the board can select the "Waiting for a second
 *   key" widget (a small external store, because Studio loads in the browser after the header);
 * - the session's live board data. The judge UI pushes each new `BoardView.data` here; once Studio's
 *   data engine is up (`onStudioReady`) it goes in through `api.setProperty("data", …)`, which Studio
 *   applies to synchronous sources in place (types: api/agStudioProperties.d.ts, `data`) and answers
 *   with a `dataChanged` refresh of every built-in widget. Custom widgets are not re-queried by that
 *   refresh, so each push also bumps a revision the Live Balance strip listens to.
 */
import type { AgReportState, AgStudioApi } from "ag-studio";
import type { ClubDemoData } from "@/demo/riverbend";
import { buildStudioData } from "@/demo/studio-data";
import type { TwoKeyRegistry } from "./widgets";

/** The widget id of the second-key queue in the initial state. The header's button targets it. */
export const SECOND_KEY_WIDGET_ID = "second-key-queue";

/** Studio's class on the layout widget that holds the selection, and its focusable layer. */
const SELECTED_WIDGET = ".ag-studio-layout-widget-selected";
const WIDGET_FOCUS_TARGET = ".ag-studio-layout-widget-focus-container";

let studioApi: AgStudioApi<TwoKeyRegistry> | null = null;
const listeners = new Set<() => void>();

/** Wire from `<AgStudio onApiReady>`; pass `null` on teardown. */
export function setStudioApi(api: AgStudioApi<TwoKeyRegistry> | null): void {
  if (api === studioApi) return;
  studioApi = api;
  for (const listener of [...listeners]) listener();
}

export function isStudioReady(): boolean {
  return studioApi !== null;
}

/** For `useSyncExternalStore`: calls `listener` whenever readiness changes. */
export function subscribeStudioReady(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Selects the second-key widget in Studio (page `selection` state; see api/state/agSelectionState.d.ts)
 * and scrolls it into view. Selection is view state, so it adds nothing to Studio's undo history.
 * false if Studio isn't ready, or if the widget is no longer on any page.
 */
export function focusSecondKeyQueue(): boolean {
  if (studioApi === null) return false;
  const next = withQueueSelected(studioApi.getState());
  if (next === null) return false;
  studioApi.setState(next);
  revealSelectedWidget();
  return true;
}

/** The state with the queue selected on its page (the showing page first), or null if it's gone. */
function withQueueSelected(state: AgReportState<TwoKeyRegistry>): AgReportState<TwoKeyRegistry> | null {
  const holds = (page: (typeof state.pages)[number]) => page.widgets?.[SECOND_KEY_WIDGET_ID] != null;
  const page = state.pages.find((p) => p.id === state.selectedPageId && holds(p)) ?? state.pages.find(holds);
  if (page === undefined) return null;
  return {
    ...state,
    selectedPageId: page.id,
    pages: state.pages.map((p) => (p === page ? { ...p, selection: { type: "widget", id: SECOND_KEY_WIDGET_ID } } : p)),
  };
}

// --- Live board data ----------------------------------------------------------------------------

let dataApi: AgStudioApi<TwoKeyRegistry> | null = null;
/** The latest data the judge UI pushed, and the one Studio holds now (null: its seed). */
let latestData: ClubDemoData | null = null;
let shownData: ClubDemoData | null = null;
let dataRevision = 0;
const dataListeners = new Set<() => void>();

/**
 * Wire from `<AgStudio onStudioReady>` (the data engine is up; a `data` change before that would
 * start a second engine), and pass `null` on teardown. A new Studio starts from the seed, so the
 * latest data goes in again.
 */
export function setStudioDataApi(api: AgStudioApi<TwoKeyRegistry> | null): void {
  dataApi = api;
  shownData = null;
  flushBoardData();
}

/** The session's board data from the live view. Held until Studio can take it; pushed once per object. */
export function pushBoardData(data: ClubDemoData): void {
  latestData = data;
  flushBoardData();
}

function flushBoardData(): void {
  if (dataApi === null || latestData === null || latestData === shownData) return;
  dataApi.setProperty("data", buildStudioData<TwoKeyRegistry>(latestData));
  shownData = latestData;
  dataRevision += 1;
  for (const listener of [...dataListeners]) listener();
}

/** Bumped after each push, once Studio holds the new rows; the Live Balance strip re-queries on it. */
export const getStudioDataRevision = () => dataRevision;

export function subscribeStudioData(listener: () => void): () => void {
  dataListeners.add(listener);
  return () => {
    dataListeners.delete(listener);
  };
}

/** After Studio has drawn the new selection: bring the widget into view and move focus onto it. */
function revealSelectedWidget(): void {
  if (typeof document === "undefined" || typeof requestAnimationFrame !== "function") return;
  requestAnimationFrame(() => {
    const widget = document.querySelector<HTMLElement>(SELECTED_WIDGET);
    if (widget === null) return;
    const reduceMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    widget.scrollIntoView({ block: "nearest", behavior: reduceMotion ? "auto" : "smooth" });
    widget.querySelector<HTMLElement>(WIDGET_FOCUS_TARGET)?.focus({ preventScroll: true });
  });
}
