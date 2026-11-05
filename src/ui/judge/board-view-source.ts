/**
 * The page's one board-view client and its transport, created in the browser on first use (null on
 * the server). The Watchtower's replay (src/ui/watchtower/replay-source.ts) shares the transport, so
 * one judge session serves both.
 *
 * Development only: `/demo?fixture=1` swaps the API for an in-memory fake (./dev/fixture-transport.ts)
 * so the drawer can be built before the real routes exist; `&watch=stale|ok|no_access|silent|
 * not_started|none` picks the Watchtower's state in it (stale by default), `&replay=fail` makes
 * its fake replay fail, and `&confirm=hold` keeps a sent payout waiting for PayPal. The switch sits
 * inside `if (process.env.NODE_ENV !== "production")`, which Next inlines and the production bundler
 * folds to `if (false)`, so the fake and its dynamic import are not in a production build at all
 * (the options type is a type-only import, erased at build time).
 */
import { createBoardViewClient, type BoardViewClient } from "./board-view-client";
import type { FixtureTransportOptions } from "./dev/fixture-transport";
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
    sendBack: (requestId, body) => get().then((t) => t.sendBack(requestId, body)),
    assessRisk: (requestId) => get().then((t) => t.assessRisk(requestId)),
    replayOutsideSend: () => get().then((t) => t.replayOutsideSend()),
  };
}

/** The dev fixture's options from its URL flags: `&watch=`, `&replay=fail`, and `&confirm=hold`. */
export function fixtureOptionsFrom(search: string): FixtureTransportOptions {
  const params = new URLSearchParams(search);
  return {
    watch: wantsWatchState(search),
    replayFails: params.get("replay") === "fail",
    // Holds a sent payout at "PayPal confirmed: Waiting", to watch the wait's clock.
    ...(params.get("confirm") === "hold" && { confirmAfterMs: null }),
  };
}

function browserTransport(): BoardTransport {
  if (process.env.NODE_ENV !== "production") {
    if (wantsFixture(window.location.search)) {
      const options = fixtureOptionsFrom(window.location.search);
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
