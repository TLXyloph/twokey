/**
 * The page's one board-view client and its transport, created in the browser on first use (null on
 * the server). The Watchtower's replay (src/ui/watchtower/replay-source.ts) shares the transport, so
 * one judge session serves both.
 *
 * Development only: `/demo?fixture=1` swaps the API for an in-memory fake (./dev/fixture-transport.ts)
 * so the drawer can be built before the real routes exist; `&watch=stale|ok|no_access|silent|
 * not_started|none` picks the Watchtower's state in it (stale by default), and `&replay=fail` makes
 * its fake replay fail. The switch sits inside
 * `if (process.env.NODE_ENV !== "production")`, which Next inlines and the production bundler folds
 * to `if (false)`, so the fake and its dynamic import are not in a production build at all.
 */
import { createBoardViewClient, type BoardViewClient } from "./board-view-client";
import { createHttpTransport, type BoardTransport } from "./http-transport";

let transport: BoardTransport | null = null;
let client: BoardViewClient | null = null;

/** A dev URL flag: `?fixture=1`. */
export const wantsFixture = (search: string) => new URLSearchParams(search).get("fixture") === "1";

/** A dev URL flag: `&watch=ok` (and the other fixture states); null when absent. */
export const wantsWatchState = (search: string) => new URLSearchParams(search).get("watch");

/** A dev URL flag for screenshots: `&drawer=open` opens the drawer on load. */
export const wantsDrawerOpen = (search: string) => new URLSearchParams(search).get("drawer") === "open";

/** A transport whose module loads on its first call. */
function deferredTransport(load: () => Promise<BoardTransport>): BoardTransport {
  let loaded: Promise<BoardTransport> | null = null;
  const get = () => (loaded ??= load());
  return {
    getView: () => get().then((t) => t.getView()),
    createRequest: (body) => get().then((t) => t.createRequest(body)),
    sign: (requestId, body) => get().then((t) => t.sign(requestId, body)),
    assessRisk: (requestId) => get().then((t) => t.assessRisk(requestId)),
    replayOutsideSend: () => get().then((t) => t.replayOutsideSend()),
  };
}

function browserTransport(): BoardTransport {
  if (process.env.NODE_ENV !== "production") {
    if (wantsFixture(window.location.search)) {
      const search = window.location.search;
      const options = { watch: wantsWatchState(search), replayFails: new URLSearchParams(search).get("replay") === "fail" };
      return deferredTransport(() => import("./dev/fixture-transport").then((mod) => mod.createFixtureTransport(options)));
    }
  }
  return createHttpTransport();
}

export function boardTransport(): BoardTransport | null {
  if (typeof window === "undefined") return null;
  transport ??= browserTransport();
  return transport;
}

export function boardViewClient(): BoardViewClient | null {
  const shared = boardTransport();
  if (!shared) return null;
  client ??= createBoardViewClient({ transport: shared });
  return client;
}
