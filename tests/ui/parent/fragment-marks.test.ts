import { describe, expect, it, vi } from "vitest";
import { markFragments, STUDIO_WIDGET_SELECTOR, watchFragments, type FragmentObserverCtor } from "@/ui/parent/fragment-marks";

/** A stand-in element: only the attribute calls the marker makes. */
function fakeElement(marked = false) {
  const attrs = new Map<string, string>(marked ? [["data-ui", ""]] : []);
  return {
    hasAttribute: vi.fn((name: string) => attrs.has(name)),
    setAttribute: vi.fn((name: string, value: string) => void attrs.set(name, value)),
  };
}

/** A stand-in root whose widgets can be added to between calls, as Studio renders them. */
function fakeRoot(initial: ReturnType<typeof fakeElement>[]) {
  const widgets = [...initial];
  return {
    widgets,
    querySelectorAll: vi.fn(() => widgets),
  };
}

/** A stand-in MutationObserver that records its callback, what it watches and whether it stopped. */
function fakeObserver() {
  const record: { callback: MutationCallback | null; target: unknown; options: MutationObserverInit | undefined; disconnected: boolean } = {
    callback: null,
    target: null,
    options: undefined,
    disconnected: false,
  };
  const Observer = vi.fn(function (this: unknown, callback: MutationCallback) {
    record.callback = callback;
    return {
      observe: (target: unknown, options?: MutationObserverInit) => {
        record.target = target;
        record.options = options;
      },
      disconnect: () => {
        record.disconnected = true;
      },
    };
  }) as unknown as FragmentObserverCtor;
  return { Observer, record };
}

describe("marking Studio's widgets as interface fragments", () => {
  it("looks for Studio's widget boxes, not the whole canvas", () => {
    expect(STUDIO_WIDGET_SELECTOR).toBe(".ag-studio-layout-widget");
    const root = fakeRoot([]);
    markFragments(root as unknown as ParentNode);
    expect(root.querySelectorAll).toHaveBeenCalledWith(".ag-studio-layout-widget");
  });

  it("marks each unmarked widget with data-ui once, and counts what it marked", () => {
    const fresh = fakeElement();
    const done = fakeElement(true);
    const root = fakeRoot([fresh, done]);
    expect(markFragments(root as unknown as ParentNode)).toBe(1);
    expect(fresh.setAttribute).toHaveBeenCalledWith("data-ui", "");
    expect(done.setAttribute).not.toHaveBeenCalled();
    expect(markFragments(root as unknown as ParentNode)).toBe(0);
    expect(fresh.setAttribute).toHaveBeenCalledTimes(1);
  });

  it("marks what is there at once, then each widget Studio adds later", () => {
    const first = fakeElement();
    const root = fakeRoot([first]);
    const { Observer, record } = fakeObserver();

    watchFragments(root as unknown as Element, Observer);
    expect(first.setAttribute).toHaveBeenCalledWith("data-ui", "");

    const later = fakeElement();
    root.widgets.push(later);
    record.callback?.([], {} as MutationObserver);
    expect(later.setAttribute).toHaveBeenCalledWith("data-ui", "");
  });

  it("watches only for added and removed nodes under the root, so its own marks never re-trigger it", () => {
    const root = fakeRoot([]);
    const { Observer, record } = fakeObserver();
    watchFragments(root as unknown as Element, Observer);
    expect(record.target).toBe(root);
    expect(record.options).toEqual({ childList: true, subtree: true });
  });

  it("stops watching when the books unmount", () => {
    const { Observer, record } = fakeObserver();
    const stop = watchFragments(fakeRoot([]) as unknown as Element, Observer);
    expect(record.disconnected).toBe(false);
    stop();
    expect(record.disconnected).toBe(true);
  });
});
