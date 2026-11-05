import { describe, expect, it, vi } from "vitest";
import { clearStoredKeySteps, createKeyStepsStore, KEY_STEPS_STORAGE_KEY, wantsSteps } from "@/ui/keys/keys-store";

function memoryStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((key: string) => items.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => void items.set(key, value)),
    removeItem: vi.fn((key: string) => void items.delete(key)),
    items,
  };
}

describe("the key-setup steps store", () => {
  it("starts at 0, steps forward in order up to 5, and back down to 0", () => {
    const storage = memoryStorage();
    const store = createKeyStepsStore({ storage: () => storage });
    expect(store.get()).toBe(0);
    for (let i = 0; i < 7; i++) store.advance();
    expect(store.get()).toBe(5);
    expect(storage.items.get(KEY_STEPS_STORAGE_KEY)).toBe("5");
    store.back();
    expect(store.get()).toBe(4);
    store.reset();
    expect(store.get()).toBe(0);
    expect(storage.items.has(KEY_STEPS_STORAGE_KEY)).toBe(false);
  });

  it("keeps the judge's place across a reload of the tab", () => {
    const storage = memoryStorage({ [KEY_STEPS_STORAGE_KEY]: "3" });
    expect(createKeyStepsStore({ storage: () => storage }).get()).toBe(3);
  });

  it("ignores a stored value it can't read, and uses the development starting count only when nothing is stored", () => {
    expect(createKeyStepsStore({ storage: () => memoryStorage({ [KEY_STEPS_STORAGE_KEY]: "lots" }), initial: () => 4 }).get()).toBe(0);
    expect(createKeyStepsStore({ storage: () => memoryStorage(), initial: () => 4 }).get()).toBe(4);
    expect(wantsSteps("?fixture=1&steps=5")).toBe(5);
    expect(wantsSteps("?steps=99")).toBe(5);
    expect(wantsSteps("?fixture=1")).toBeNull();
  });

  it("still works in memory when storage is blocked", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    const store = createKeyStepsStore({ storage: () => blocked });
    store.advance();
    store.advance();
    expect(store.get()).toBe(2);
    expect(() => clearStoredKeySteps(blocked)).not.toThrow();
  });

  it("tells subscribers once per real change", () => {
    const store = createKeyStepsStore({ storage: () => null });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.back();
    store.advance();
    store.reset();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    store.advance();
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
