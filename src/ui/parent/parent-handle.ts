/**
 * The link between the parent page and its AG Studio (a second instance, apart from the board's
 * src/ui/studio/studio-handle.ts, so the two never share state): the session's live club data goes in
 * through `api.setProperty("data", …)` once Studio's data engine is up (`onStudioReady`; types:
 * node_modules/ag-studio/dist/types/api/agStudioProperties.d.ts, `data`). Studio answers with a
 * `dataChanged` refresh of its built-in widgets; a custom widget is not re-queried by that refresh,
 * so each push also bumps a revision the balance widget listens to.
 */
import type { AgBaseRegistry, AgDataSourcesDefinition } from "ag-studio";
import type { ClubDemoData } from "@/demo/riverbend";
import { parentStudioData } from "./parent-data";

/** The one method of Studio's API the handle uses, so tests can stand in for it. */
export interface DataApi {
  setProperty(key: "data", value: AgDataSourcesDefinition<AgBaseRegistry>): void;
}

export interface ParentStudioHandle {
  /** Wire from `<AgStudio onStudioReady>`; `null` on teardown. A new Studio starts from the seed. */
  setDataApi(api: DataApi | null): void;
  /** The session's club data from the live view. Held until Studio can take it; pushed once per object. */
  push(data: ClubDemoData): void;
  getRevision(): number;
  subscribe(listener: () => void): () => void;
}

export function createParentStudioHandle(): ParentStudioHandle {
  let api: DataApi | null = null;
  let latest: ClubDemoData | null = null;
  let shown: ClubDemoData | null = null;
  let revision = 0;
  const listeners = new Set<() => void>();

  const flush = () => {
    if (api === null || latest === null || latest === shown) return;
    api.setProperty("data", parentStudioData(latest));
    shown = latest;
    revision += 1;
    for (const listener of [...listeners]) listener();
  };

  return {
    setDataApi(next) {
      api = next;
      shown = null;
      flush();
    },
    push(data) {
      latest = data;
      flush();
    },
    getRevision: () => revision,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The page's one parent Studio handle. */
export const parentStudio = createParentStudioHandle();
