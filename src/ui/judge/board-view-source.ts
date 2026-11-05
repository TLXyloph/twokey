/**
 * The page's one board-view client, created in the browser on first use (null on the server).
 *
 * Development only: `/demo?fixture=1` swaps the API for an in-memory fake (./dev/fixture-transport.ts)
 * so the drawer can be built before the real routes exist. The switch sits inside
 * `if (process.env.NODE_ENV !== "production")`, which Next inlines and the production bundler folds
 * to `if (false)`, so the fake and its dynamic import are not in a production build at all.
 */
import { createBoardViewClient, type BoardViewClient } from "./board-view-client";
import { createHttpTransport, type BoardTransport } from "./http-transport";

let client: BoardViewClient | null = null;

/** A dev URL flag: `?fixture=1`. */
export const wantsFixture = (search: string) => new URLSearchParams(search).get("fixture") === "1";

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
  };
}

function browserTransport(): BoardTransport {
  if (process.env.NODE_ENV !== "production") {
    if (wantsFixture(window.location.search)) {
      return deferredTransport(() => import("./dev/fixture-transport").then((mod) => mod.createFixtureTransport()));
    }
  }
  return createHttpTransport();
}

export function boardViewClient(): BoardViewClient | null {
  if (typeof window === "undefined") return null;
  client ??= createBoardViewClient({ transport: browserTransport() });
  return client;
}
