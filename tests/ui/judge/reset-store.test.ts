import { describe, expect, it, vi } from "vitest";
import { createResetStore, postReset, RESET_API, type ResetResult } from "@/ui/judge/reset-store";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

function setup(results: ResetResult[] = [{ ok: true }]) {
  const reset = vi.fn<() => Promise<ResetResult>>();
  for (const result of results) reset.mockResolvedValueOnce(result);
  const afterReset = vi.fn();
  const store = createResetStore({ reset, afterReset });
  return { store, reset, afterReset };
}

describe("the start-over store", () => {
  it("asks before it does anything, and cancelling sends nothing", async () => {
    const { store, reset } = setup();
    store.ask();
    expect(store.getSnapshot().phase).toBe("confirming");
    store.cancel();
    expect(store.getSnapshot()).toEqual({ phase: "idle", error: null });
    await store.confirm();
    expect(reset).not.toHaveBeenCalled();
  });

  it("on confirm, resets once, then clears this tab's demo state and reloads", async () => {
    const { store, reset, afterReset } = setup();
    store.ask();
    const pending = deferred<ResetResult>();
    reset.mockReset().mockReturnValueOnce(pending.promise);
    const run = store.confirm();
    expect(store.getSnapshot().phase).toBe("running");
    void store.confirm();
    store.cancel();
    expect(store.getSnapshot().phase).toBe("running");
    pending.resolve({ ok: true });
    await run;
    expect(reset).toHaveBeenCalledTimes(1);
    expect(afterReset).toHaveBeenCalledTimes(1);
  });

  it("treats 'no session' as already fresh: the reload opens a new one from the seed", async () => {
    const { store, afterReset } = setup([{ ok: false, status: 401, code: "no_session", message: "No session" }]);
    store.ask();
    await store.confirm();
    expect(afterReset).toHaveBeenCalledTimes(1);
  });

  it("shows the server's sentence when the network's session cap refuses, keeps the session, and can try again", async () => {
    const message = "This network has started the most new demo sessions allowed in an hour.";
    const { store, afterReset, reset } = setup([{ ok: false, status: 429, code: "rate_limited", message }, { ok: true }]);
    store.ask();
    await store.confirm();
    expect(store.getSnapshot()).toEqual({ phase: "failed", error: message });
    expect(afterReset).not.toHaveBeenCalled();
    await store.confirm();
    expect(reset).toHaveBeenCalledTimes(2);
    expect(afterReset).toHaveBeenCalledTimes(1);
  });

  it("turns a thrown reset into a plain sentence", async () => {
    const reset = vi.fn<() => Promise<ResetResult>>().mockRejectedValue(new Error("boom"));
    const store = createResetStore({ reset, afterReset: vi.fn() });
    store.ask();
    await store.confirm();
    expect(store.getSnapshot().error).toMatch(/Couldn't reach the server/);
  });
});

describe("postReset", () => {
  it("POSTs {} same-origin to the reset route", async () => {
    const fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>().mockResolvedValue(Response.json({ ok: true, session: "issued" }));
    expect(await postReset(fetch)).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledWith(RESET_API, expect.objectContaining({ method: "POST", body: "{}", credentials: "same-origin" }));
    expect(RESET_API).toBe("/api/judge/reset");
  });

  it("returns the server's code and message on an error, a plain sentence when the body isn't JSON, and a network sentence on failure", async () => {
    const limited = Response.json({ error: { code: "rate_limited", message: "Try again within the hour." } }, { status: 429 });
    expect(await postReset(async () => limited)).toEqual({ ok: false, status: 429, code: "rate_limited", message: "Try again within the hour." });
    const html = new Response("<html>", { status: 502 });
    expect(await postReset(async () => html)).toMatchObject({ ok: false, status: 502, code: "http_502", message: expect.stringContaining("error 502") });
    expect(
      await postReset(async () => {
        throw new TypeError("offline");
      }),
    ).toMatchObject({ ok: false, status: 0, code: "network" });
  });
});
