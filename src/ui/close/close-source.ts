/**
 * The close screen's one client, created in the browser on first use (null on the server), and the
 * React hooks that read it and the acting role.
 *
 * Development only: `/demo/close?fixture=1` swaps the API for an in-memory fake (./dev/close-fixture.ts)
 * so the screen renders without the backend; `&draft=none` shows the draft as not recorded,
 * `&signed=1` starts signed and `&key=unset` makes the Reviewer's key unpublished. The switch sits
 * inside `if (process.env.NODE_ENV !== "production")`, which the production bundler folds to
 * `if (false)`, so the fake and its dynamic import are not in a production build at all.
 */
import { useSyncExternalStore } from "react";
import { createCloseClient, createHttpCloseTransport, EMPTY_CLOSE, type CloseClient, type CloseSnapshot, type CloseTransport } from "./close-client";

let client: CloseClient | null = null;

/** A transport whose module loads on its first call. */
function deferred(load: () => Promise<CloseTransport>): CloseTransport {
  let loaded: Promise<CloseTransport> | null = null;
  const get = () => (loaded ??= load());
  return {
    getView: () => get().then((t) => t.getView()),
    sign: (role) => get().then((t) => t.sign(role)),
  };
}

function browserTransport(): CloseTransport {
  if (process.env.NODE_ENV !== "production") {
    const params = new URLSearchParams(window.location.search);
    if (params.get("fixture") === "1") {
      const options = { draft: params.get("draft"), signed: params.get("signed") === "1", keyUnset: params.get("key") === "unset" };
      return deferred(() => import("./dev/close-fixture").then((mod) => mod.createCloseFixtureTransport(options)));
    }
  }
  return createHttpCloseTransport();
}

export function closeClient(): CloseClient | null {
  if (typeof window === "undefined") return null;
  client ??= createCloseClient({ transport: browserTransport() });
  return client;
}

const noSubscription = () => () => {};

export function useClose(): CloseSnapshot {
  const live = closeClient();
  return useSyncExternalStore(live ? live.subscribe : noSubscription, live ? live.getSnapshot : () => EMPTY_CLOSE, () => EMPTY_CLOSE);
}
