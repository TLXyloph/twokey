/**
 * The pure parts of the landing page's weighted scroll (weighted-scroll.ts): how far a wheel event
 * asks to go, how the page eases toward that, where a soft snap settles, and when the page leaves a
 * wheel to the browser. No DOM here, so every rule is tested on its own.
 */

/** Easing rate while following the wheel, per second: about Lenis's lerp of 0.1 at 60fps, a little heavier than native. */
export const WHEEL_K = 6;
/** Easing rate of the soft snap's leg, and of anchor jumps: gentler, so the settle reads as a settle. */
export const SNAP_K = 4.5;
/** A screen start pulls the page only from within this share of the viewport's height. */
export const SNAP_REACH = 0.25;
/** Quiet time after the last wheel or native scroll before the soft snap is considered, in ms. */
export const IDLE_MS = 160;
/** The page counts as nearly settled, so the snap may take over, within this many pixels of its target. */
export const NEAR_PX = 24;
/** Below this distance the glide stops and jumps to its target. */
export const SETTLE_PX = 0.5;
/** One wheel "line" in pixels (deltaMode 1). The distance multiplier stays 1: the weight is the easing. */
export const LINE_PX = 16;
/** Longest frame step the easing will take, in seconds, so a stalled tab does not jump on return. */
export const MAX_DT = 0.1;

export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** A wheel delta in pixels: deltaMode 0 is pixels, 1 is lines, 2 is pages. */
export function normaliseDelta(delta: number, deltaMode: number, viewport: number): number {
  if (deltaMode === 1) return delta * LINE_PX;
  if (deltaMode === 2) return delta * viewport;
  return delta;
}

/**
 * One frame of exponential easing toward the target, independent of the frame rate: k is the rate
 * per second and dt the frame's length in seconds, so two 16ms steps equal one 32ms step.
 */
export function smoothStep(current: number, target: number, k: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-k * dt));
}

/** A snap area: one screen, from its start to where the next screen starts (document pixels). */
export interface SnapArea {
  start: number;
  end: number;
}

/**
 * Where a soft snap would settle from `position`, or null to stay put. Each screen offers its start
 * (clamped to the page's end, so the footer's start becomes the page's last position); a screen taller
 * than the window also offers its end-aligned position, and anywhere between the two is left free.
 * The nearest offer within `reach` of the viewport wins. With a direction (a keyboard scroll), only
 * offers ahead in that direction count, so a 40px arrow step is never pulled back.
 */
export function softSnapTarget(
  position: number,
  areas: readonly SnapArea[],
  viewport: number,
  maxScroll: number,
  { direction = 0, reach = SNAP_REACH }: { direction?: number; reach?: number } = {},
): number | null {
  const offers: number[] = [];
  for (const area of areas) {
    const start = clamp(area.start, 0, maxScroll);
    const end = clamp(area.end - viewport, start, maxScroll);
    const tall = end - start > 1;
    if (tall && position > start + SETTLE_PX && position < end - SETTLE_PX) return null;
    offers.push(start);
    if (tall) offers.push(end);
  }
  let best: number | null = null;
  let distance = Infinity;
  for (const offer of offers) {
    const d = offer - position;
    if ((direction > 0 && d < 0) || (direction < 0 && d > 0)) continue;
    if (Math.abs(d) < distance) {
      distance = Math.abs(d);
      best = offer;
    }
  }
  if (best === null || distance <= SETTLE_PX || distance > reach * viewport) return null;
  return best;
}

/** What the predicate needs of a wheel event. */
export interface WheelLike {
  ctrlKey: boolean;
  metaKey: boolean;
  deltaX: number;
  deltaY: number;
}

/** What the predicate needs of one ancestor of the wheel's target. */
export interface ScrollBox {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  overflowY: string;
  overscrollY: string;
}

const isScrollBox = (box: ScrollBox): boolean =>
  /^(auto|scroll|overlay)$/.test(box.overflowY) && box.scrollHeight > box.clientHeight + 1;

const hasRoom = (box: ScrollBox, dy: number): boolean =>
  dy > 0 ? box.scrollTop + box.clientHeight < box.scrollHeight - 1 : box.scrollTop > 1;

/**
 * Whether the page takes this wheel event. It never takes zoom (ctrl or cmd), a mostly horizontal
 * wheel, a wheel while the phone menu is open, a wheel over a scroll box that keeps its scrolling to
 * itself, or a wheel over a scroll box with room left in that direction (`chain` runs from the target
 * up to, not including, the body).
 */
export function shouldHijack(event: WheelLike, chain: readonly ScrollBox[], menuOpen: boolean): boolean {
  if (menuOpen || event.ctrlKey || event.metaKey) return false;
  if (event.deltaY === 0 || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return false;
  for (const box of chain) {
    if (!isScrollBox(box)) continue;
    if (box.overscrollY === "contain" || box.overscrollY === "none") return false;
    if (hasRoom(box, event.deltaY)) return false;
  }
  return true;
}
