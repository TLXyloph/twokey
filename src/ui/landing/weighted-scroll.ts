/**
 * The landing page's weighted scroll, desktop only. The wheel moves a target and the page eases
 * toward it every frame (WHEEL_K); after a quiet moment the page settles softly on a screen start when
 * one is within a quarter of the viewport (SNAP_K), and anywhere else it stays where it was left.
 * Keys, the scrollbar, find-in-page and focus stay native; the scroller only follows them, then offers
 * the same soft settle in the direction they went. In-page anchors glide with the snap's easing.
 *
 * Attached only for a fine pointer on a window at least 900x640 with no reduced-motion preference,
 * re-checked when any of those change; otherwise it is fully detached and the CSS's proximity snap
 * applies. No library: rAF and window.scrollTo.
 */
import {
  IDLE_MS,
  MAX_DT,
  NEAR_PX,
  SETTLE_PX,
  SNAP_K,
  WHEEL_K,
  clamp,
  normaliseDelta,
  shouldHijack,
  smoothStep,
  softSnapTarget,
  type ScrollBox,
  type SnapArea,
} from "./weighted-scroll-math";

export const WEIGHTED_QUERY =
  "(min-width: 900px) and (min-height: 640px) and (pointer: fine) and (prefers-reduced-motion: no-preference)";
/** On <html> while attached: the CSS turns its own snap off so the two never pull against each other. */
export const WEIGHTED_CLASS = "lp-weighted";
const SCREENS = ".lp-banner, .lp-screen, .lp-foot";

type Mode = "idle" | "wheel" | "settle" | "snap";

function createScroller() {
  const root = document.documentElement;
  let mode: Mode = "idle";
  let current = scrollY;
  let target = scrollY;
  let k = WHEEL_K;
  let raf = 0;
  let lastFrame = 0;
  let lastWheel = 0;
  let lastSet = Number.NaN;
  let nativeFrom: number | null = null;
  let nativeTimer = 0;
  let pointerHeld = false;

  const maxScroll = () => Math.max(0, root.scrollHeight - innerHeight);

  const areas = (): SnapArea[] => {
    const starts = [...document.querySelectorAll<HTMLElement>(SCREENS)]
      .map((el) => el.getBoundingClientRect().top + scrollY)
      .sort((a, b) => a - b);
    return starts.map((start, i) => ({ start, end: starts[i + 1] ?? root.scrollHeight }));
  };

  const setScroll = (y: number) => {
    lastSet = y;
    window.scrollTo({ top: y, left: 0, behavior: "instant" });
  };

  // A settle must not carry a focused control out of view (Tab scrolls it in; the snap could undo that).
  const keepsFocus = (to: number) => {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement) || el === document.body) return true;
    const r = el.getBoundingClientRect();
    if (r.height >= innerHeight || r.bottom <= 0 || r.top >= innerHeight) return true;
    const shift = to - scrollY;
    return r.top - shift >= 0 && r.bottom - shift <= innerHeight;
  };

  const run = () => {
    if (raf) return;
    lastFrame = performance.now();
    raf = requestAnimationFrame(frame);
  };

  const stop = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    mode = "idle";
  };

  function frame(now: number) {
    raf = 0;
    const dt = clamp((now - lastFrame) / 1000, 0, MAX_DT);
    lastFrame = now;
    current = smoothStep(current, target, k, dt);
    if (Math.abs(target - current) < SETTLE_PX) current = target;
    setScroll(current);
    // The soft snap: once the wheel has been quiet and the glide has nearly arrived, settle on a
    // screen start within reach, with the gentler easing for that leg only.
    if (mode === "wheel" && now - lastWheel >= IDLE_MS && Math.abs(target - current) < NEAR_PX) {
      const snap = softSnapTarget(target, areas(), innerHeight, maxScroll());
      if (snap !== null && keepsFocus(snap)) {
        target = snap;
        k = SNAP_K;
        mode = "snap";
      } else mode = "settle";
    }
    if (current === target && mode !== "wheel") {
      mode = "idle";
      return;
    }
    raf = requestAnimationFrame(frame);
  }

  const chain = (start: EventTarget | null): ScrollBox[] => {
    const boxes: ScrollBox[] = [];
    for (let el = start instanceof Element ? start : null; el && el !== document.body && el !== root; el = el.parentElement) {
      if (el.scrollHeight <= el.clientHeight + 1) continue;
      const cs = getComputedStyle(el);
      boxes.push({ scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, overflowY: cs.overflowY, overscrollY: cs.overscrollBehaviorY });
    }
    return boxes;
  };

  const onWheel = (e: WheelEvent) => {
    if (e.defaultPrevented || !shouldHijack(e, chain(e.target), !!document.querySelector(".lp-menu[open]"))) return;
    e.preventDefault();
    if (mode === "idle") current = target = scrollY;
    // New input cancels a snap leg at once and carries on from where the page is.
    if (mode === "snap" || mode === "settle") target = current;
    mode = "wheel";
    k = WHEEL_K;
    target = clamp(target + normaliseDelta(e.deltaY, e.deltaMode, innerHeight), 0, maxScroll());
    lastWheel = performance.now();
    run();
  };

  // After a native scroll (keys, scrollbar, find-in-page, focus, restoration) has been quiet, offer
  // the soft settle, looking only ahead in the direction it went.
  const afterNative = () => {
    nativeTimer = 0;
    if (pointerHeld || nativeFrom === null) return;
    const direction = Math.sign(scrollY - nativeFrom);
    nativeFrom = null;
    const snap = softSnapTarget(scrollY, areas(), innerHeight, maxScroll(), { direction });
    if (snap === null || !keepsFocus(snap)) return;
    current = scrollY;
    target = snap;
    k = SNAP_K;
    mode = "snap";
    run();
  };

  const onScroll = () => {
    if (Math.abs(scrollY - lastSet) < 1) return; // our own frame
    // Someone else moved the page: follow it, and let it finish before offering a settle. The burst's
    // direction is measured from the last position we knew; our last value is forgotten, so a later
    // native scroll that happens to land on it is not mistaken for ours.
    stop();
    if (nativeFrom === null) nativeFrom = current;
    current = target = scrollY;
    lastSet = Number.NaN;
    clearTimeout(nativeTimer);
    nativeTimer = window.setTimeout(afterNative, IDLE_MS);
  };

  const onPointerDown = () => {
    pointerHeld = true;
  };
  const onPointerUp = () => {
    pointerHeld = false;
    if (nativeFrom !== null && !nativeTimer) nativeTimer = window.setTimeout(afterNative, IDLE_MS);
  };

  // In-page anchors (the navigation, the wordmark, "Back to top") glide with the snap's easing, update
  // the address and hand focus to the section they name.
  const onClick = (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const link = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>('.lp a[href^="#"]') : null;
    const id = link?.getAttribute("href")?.slice(1);
    const section = id ? document.getElementById(id) : null;
    if (!link || !section) return;
    e.preventDefault();
    link.closest("details")?.removeAttribute("open");
    stop();
    current = scrollY;
    target = clamp(section.getBoundingClientRect().top + scrollY, 0, maxScroll());
    k = SNAP_K;
    mode = "snap";
    run();
    history.pushState(null, "", `#${id}`);
    if (!section.hasAttribute("tabindex")) section.setAttribute("tabindex", "-1");
    section.focus({ preventScroll: true });
  };

  return {
    attach() {
      current = target = scrollY;
      root.classList.add(WEIGHTED_CLASS);
      addEventListener("wheel", onWheel, { passive: false });
      addEventListener("scroll", onScroll, { passive: true });
      addEventListener("pointerdown", onPointerDown, { passive: true });
      addEventListener("pointerup", onPointerUp, { passive: true });
      addEventListener("pointercancel", onPointerUp, { passive: true });
      document.addEventListener("click", onClick);
    },
    detach() {
      stop();
      clearTimeout(nativeTimer);
      nativeTimer = 0;
      nativeFrom = null;
      root.classList.remove(WEIGHTED_CLASS);
      removeEventListener("wheel", onWheel);
      removeEventListener("scroll", onScroll);
      removeEventListener("pointerdown", onPointerDown);
      removeEventListener("pointerup", onPointerUp);
      removeEventListener("pointercancel", onPointerUp);
      document.removeEventListener("click", onClick);
    },
  };
}

/** Mounts the weighted scroll; it attaches and detaches with the media query. Returns the cleanup. */
export function mountWeightedScroll(): () => void {
  const query = matchMedia(WEIGHTED_QUERY);
  const scroller = createScroller();
  let attached = false;
  const sync = () => {
    if (query.matches && !attached) scroller.attach();
    if (!query.matches && attached) scroller.detach();
    attached = query.matches;
  };
  sync();
  query.addEventListener("change", sync);
  return () => {
    query.removeEventListener("change", sync);
    if (attached) scroller.detach();
    attached = false;
  };
}
