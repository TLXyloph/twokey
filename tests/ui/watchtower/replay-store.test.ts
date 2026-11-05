import { describe, expect, it, vi } from "vitest";
import type { ReplayResult } from "@/ui/judge/http-transport";
import { createReplayStore, EMPTY_REPLAY } from "@/ui/watchtower/replay-store";
import { fixtureReplay, NOW } from "../../fixtures/watchtower-view";

/** A replay port whose answers the test releases by hand. */
function deferredReplay() {
  const pending: ((result: ReplayResult) => void)[] = [];
  const replay = vi.fn(() => new Promise<ReplayResult>((resolve) => pending.push(resolve)));
  return { replay, answer: (result: ReplayResult) => pending.shift()!(result) };
}

const ok = (): ReplayResult => ({ ok: true, replay: fixtureReplay(NOW) });

describe("the replay store", () => {
  it("starts empty", () => {
    expect(createReplayStore({ replay: vi.fn() }).getSnapshot()).toBe(EMPTY_REPLAY);
  });

  it("runs, then holds the answer as one labelled alert", async () => {
    const port = deferredReplay();
    const store = createReplayStore(port);
    const listener = vi.fn();
    store.subscribe(listener);

    const done = store.replay();
    expect(store.getSnapshot()).toMatchObject({ running: true, alert: null, error: null });
    port.answer(ok());
    await done;

    const { running, alert } = store.getSnapshot();
    expect(running).toBe(false);
    expect(alert?.label).toBe("Replay of a real sandbox event: a $3.21 website send on Nov 3, 2026.");
    expect(alert?.finding.transactionId).toBe("1TY14748YE721631B");
    expect(listener).toHaveBeenCalled();
  });

  it("shares one request between quick clicks", async () => {
    const port = deferredReplay();
    const store = createReplayStore(port);
    const first = store.replay();
    const second = store.replay();
    expect(second).toBe(first);
    port.answer(ok());
    await first;
    expect(port.replay).toHaveBeenCalledTimes(1);
  });

  it("replaces the shown replay with a new arrival rather than stacking copies", async () => {
    const store = createReplayStore({ replay: async () => ok() });
    await store.replay();
    const firstId = store.getSnapshot().alert!.id;
    await store.replay();
    expect(store.getSnapshot().alert!.id).not.toBe(firstId);
  });

  it("dismisses the alert it holds, and ignores a stale dismiss", async () => {
    const store = createReplayStore({ replay: async () => ok() });
    await store.replay();
    const { id } = store.getSnapshot().alert!;
    store.dismiss("replay-old");
    expect(store.getSnapshot().alert?.id).toBe(id);
    store.dismiss(id);
    expect(store.getSnapshot().alert).toBeNull();
  });

  it("keeps a failure as one plain sentence, and clears it on the next try", async () => {
    const port = deferredReplay();
    const store = createReplayStore(port);
    const failed = store.replay();
    port.answer({ ok: false, status: 503, code: "replay_unavailable", message: "The replay isn't available just now." });
    await failed;
    expect(store.getSnapshot()).toMatchObject({ running: false, error: "The replay isn't available just now.", alert: null });

    const retry = store.replay();
    expect(store.getSnapshot().error).toBeNull();
    port.answer(ok());
    await retry;
    expect(store.getSnapshot().alert).not.toBeNull();
  });

  it("turns a thrown error into the plain failure sentence", async () => {
    const store = createReplayStore({ replay: async () => Promise.reject(new Error("chunk failed to load")) });
    await expect(store.replay()).resolves.toMatchObject({ ok: false, code: "network" });
    expect(store.getSnapshot().error).toBe("Couldn't replay the outside send. Try again in a moment.");
  });

  it("stops telling a listener once it unsubscribes", async () => {
    const store = createReplayStore({ replay: async () => ok() });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();
    await store.replay();
    expect(listener).not.toHaveBeenCalled();
  });
});
