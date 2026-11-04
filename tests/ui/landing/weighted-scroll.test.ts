import { describe, expect, it } from "vitest";
import {
  LINE_PX,
  SNAP_REACH,
  clamp,
  normaliseDelta,
  shouldHijack,
  smoothStep,
  softSnapTarget,
  type ScrollBox,
  type SnapArea,
} from "@/ui/landing/weighted-scroll-math";

const VH = 900;
// Seven screens as on the 1440x900 page: six of 900px, then a 625px footer; the page ends at 6025.
const AREAS: SnapArea[] = [0, 900, 1800, 2700, 3600, 4500].map((start) => ({ start, end: start + 900 }));
AREAS.push({ start: 5400, end: 6025 });
const MAX = 6025 - VH;

describe("normaliseDelta", () => {
  it("keeps pixels, turns lines into 16px and pages into the viewport height", () => {
    expect(normaliseDelta(100, 0, VH)).toBe(100);
    expect(normaliseDelta(3, 1, VH)).toBe(3 * LINE_PX);
    expect(normaliseDelta(-1, 2, VH)).toBe(-VH);
  });
});

describe("smoothStep", () => {
  it("is frame-rate independent: one 32ms step equals two 16ms steps", () => {
    const k = 6;
    const two = smoothStep(smoothStep(0, 500, k, 0.016), 500, k, 0.016);
    const one = smoothStep(0, 500, k, 0.032);
    expect(Math.abs(two - one)).toBeLessThan(1e-9);
  });

  it("moves toward the target without overshooting, and not at all in zero time", () => {
    expect(smoothStep(100, 400, 6, 0)).toBe(100);
    const next = smoothStep(100, 400, 6, 0.016);
    expect(next).toBeGreaterThan(100);
    expect(next).toBeLessThan(400);
    expect(smoothStep(100, 400, 6, 10)).toBeLessThanOrEqual(400);
    expect(smoothStep(400, 100, 6, 0.016)).toBeLessThan(400);
  });
});

describe("clamp", () => {
  it("holds the target inside the page", () => {
    expect(clamp(-40, 0, MAX)).toBe(0);
    expect(clamp(MAX + 300, 0, MAX)).toBe(MAX);
    expect(clamp(1234, 0, MAX)).toBe(1234);
  });
});

describe("softSnapTarget", () => {
  const at = (fraction: number) => 900 + fraction * VH; // a position inside screen 2

  it("settles on the screen start within a quarter of the viewport, and leaves the middle free", () => {
    expect(SNAP_REACH).toBe(0.25);
    expect(softSnapTarget(at(0.1), AREAS, VH, MAX)).toBe(900);
    expect(softSnapTarget(at(0.24), AREAS, VH, MAX)).toBe(900);
    expect(softSnapTarget(at(0.26), AREAS, VH, MAX)).toBeNull();
    expect(softSnapTarget(at(0.5), AREAS, VH, MAX)).toBeNull();
    expect(softSnapTarget(at(0.76), AREAS, VH, MAX)).toBe(1800);
  });

  it("treats the page's end as the last screen's start, since the footer's own start is past it", () => {
    expect(softSnapTarget(MAX - 80, AREAS, VH, MAX)).toBe(MAX);
    expect(softSnapTarget(4500 + 60, AREAS, VH, MAX)).toBe(4500);
    expect(softSnapTarget(MAX, AREAS, VH, MAX)).toBeNull();
  });

  it("returns nothing when already resting on a screen start", () => {
    expect(softSnapTarget(1800, AREAS, VH, MAX)).toBeNull();
  });

  it("leaves a screen taller than the window free inside, and settles on either of its ends", () => {
    const tall: SnapArea[] = [{ start: 0, end: 900 }, { start: 900, end: 2300 }, { start: 2300, end: 3200 }];
    const max = 3200 - VH;
    expect(softSnapTarget(940, tall, VH, max)).toBeNull();
    expect(softSnapTarget(1300, tall, VH, max)).toBeNull();
    expect(softSnapTarget(1400 + 60, tall, VH, max)).toBe(1400); // just past its end-aligned position
  });

  it("only looks ahead in the direction of travel when one is given (keyboard scrolls)", () => {
    expect(softSnapTarget(940, AREAS, VH, MAX, { direction: 1 })).toBeNull(); // one Arrow Down stays put
    expect(softSnapTarget(1687, AREAS, VH, MAX, { direction: 1 })).toBe(1800); // Page Down lands short
    expect(softSnapTarget(1013, AREAS, VH, MAX, { direction: -1 })).toBe(900); // Page Up lands short
    expect(softSnapTarget(860, AREAS, VH, MAX, { direction: -1 })).toBeNull(); // one Arrow Up stays put
  });
});

describe("shouldHijack", () => {
  const wheel = { ctrlKey: false, metaKey: false, deltaX: 0, deltaY: 100 };
  const box = (over: Partial<ScrollBox> = {}): ScrollBox => ({
    scrollTop: 0,
    scrollHeight: 800,
    clientHeight: 300,
    overflowY: "auto",
    overscrollY: "auto",
    ...over,
  });

  it("takes a plain vertical wheel over the page", () => {
    expect(shouldHijack(wheel, [], false)).toBe(true);
  });

  it("never takes zoom, a mostly horizontal wheel, or a wheel while the phone menu is open", () => {
    expect(shouldHijack({ ...wheel, ctrlKey: true }, [], false)).toBe(false);
    expect(shouldHijack({ ...wheel, metaKey: true }, [], false)).toBe(false);
    expect(shouldHijack({ ...wheel, deltaX: 120, deltaY: 40 }, [], false)).toBe(false);
    expect(shouldHijack(wheel, [], true)).toBe(false);
  });

  it("leaves a scrollable box to scroll itself while it has room in that direction", () => {
    expect(shouldHijack(wheel, [box()], false)).toBe(false); // room below
    expect(shouldHijack(wheel, [box({ scrollTop: 500 })], false)).toBe(true); // at its foot: the page goes on
    expect(shouldHijack({ ...wheel, deltaY: -100 }, [box()], false)).toBe(true); // at its top, going up
    expect(shouldHijack(wheel, [box({ overflowY: "visible" })], false)).toBe(true); // not a scroll box
    expect(shouldHijack(wheel, [box({ scrollHeight: 300 })], false)).toBe(true); // nothing to scroll
  });

  it("never takes a wheel inside a scroll box that keeps its scrolling to itself", () => {
    expect(shouldHijack(wheel, [box({ scrollTop: 500, overscrollY: "contain" })], false)).toBe(false);
  });
});
