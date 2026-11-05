import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatElapsed, startElapsedTicker, waitingLabel } from "@/ui/judge/waiting-clock";

describe("the elapsed time while waiting for PayPal", () => {
  it("reads m:ss under an hour", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(23_000)).toBe("0:23");
    expect(formatElapsed(23_999)).toBe("0:23");
    expect(formatElapsed(65_000)).toBe("1:05");
    expect(formatElapsed(59 * 60_000 + 59_000)).toBe("59:59");
  });

  it("reads h:mm:ss from an hour on", () => {
    expect(formatElapsed(3_600_000)).toBe("1:00:00");
    expect(formatElapsed(3_600_000 + 5 * 60_000 + 7_000)).toBe("1:05:07");
    expect(formatElapsed(26 * 3_600_000)).toBe("26:00:00");
  });

  it("never counts below zero when the browser's clock is behind the server's", () => {
    expect(formatElapsed(-4_000)).toBe("0:00");
    expect(formatElapsed(Number.NaN)).toBe("0:00");
  });

  it("labels the pending confirmation row", () => {
    expect(waitingLabel("2026-11-05T16:42:07Z", new Date("2026-11-05T16:42:30Z"))).toBe("Waiting · 0:23");
    expect(waitingLabel("not a time", new Date("2026-11-05T16:42:30Z"))).toBe("Waiting");
  });
});

describe("the ticker, on a fake clock", () => {
  const sentAt = Date.parse("2026-11-05T16:42:07.400Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(sentAt + 23_100);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("says the time at once, then once a second, on the second", () => {
    const seen: string[] = [];
    const stop = startElapsedTicker(sentAt, (label) => seen.push(label));
    expect(seen).toEqual(["0:23"]);

    // The next second lands 900 ms later, not a full second after the start.
    vi.advanceTimersByTime(899);
    expect(seen).toEqual(["0:23"]);
    vi.advanceTimersByTime(1);
    expect(seen).toEqual(["0:23", "0:24"]);

    vi.advanceTimersByTime(3_000);
    expect(seen).toEqual(["0:23", "0:24", "0:25", "0:26", "0:27"]);
    stop();
  });

  it("stops when told to, as when PayPal confirms", () => {
    const seen: string[] = [];
    const stop = startElapsedTicker(sentAt, (label) => seen.push(label));
    vi.advanceTimersByTime(900);
    stop();
    vi.advanceTimersByTime(10_000);
    expect(seen).toEqual(["0:23", "0:24"]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not skip or repeat a second when a timer fires late", () => {
    const seen: string[] = [];
    const clock = { now: () => Date.now(), setTimeout: (cb: () => void, ms: number) => setTimeout(cb, ms + 40), clearTimeout: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>) };
    const stop = startElapsedTicker(sentAt, (label) => seen.push(label), clock);
    vi.advanceTimersByTime(10_000);
    stop();
    expect(seen.slice(0, 6)).toEqual(["0:23", "0:24", "0:25", "0:26", "0:27", "0:28"]);
    expect(new Set(seen).size).toBe(seen.length);
  });
});
