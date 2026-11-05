import { describe, expect, it, vi } from "vitest";
import { createRoleStore, ROLE_STORAGE_KEY } from "@/ui/judge/role-store";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => void values.set(key, value)),
    values,
  };
}

describe("the judge's role", () => {
  it("starts as the Treasurer", () => {
    expect(createRoleStore(() => memoryStorage()).get()).toBe("treasurer");
  });

  it("comes back from this tab's storage", () => {
    const storage = memoryStorage({ [ROLE_STORAGE_KEY]: "president" });
    expect(createRoleStore(() => storage).get()).toBe("president");
  });

  it("ignores a stored value that is not a role", () => {
    const storage = memoryStorage({ [ROLE_STORAGE_KEY]: "admin" });
    expect(createRoleStore(() => storage).get()).toBe("treasurer");
  });

  it("stores a new role and tells subscribers once", () => {
    const storage = memoryStorage();
    const store = createRoleStore(() => storage);
    const listener = vi.fn();
    store.subscribe(listener);

    store.set("parent");
    store.set("parent");

    expect(store.get()).toBe("parent");
    expect(storage.values.get(ROLE_STORAGE_KEY)).toBe("parent");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("keeps working when storage is blocked or throws", () => {
    const throwing = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    const store = createRoleStore(() => throwing);
    expect(store.get()).toBe("treasurer");
    store.set("secretary");
    expect(store.get()).toBe("secretary");

    const missing = createRoleStore(() => {
      throw new Error("Access to storage is not allowed");
    });
    expect(missing.get()).toBe("treasurer");
    missing.set("president");
    expect(missing.get()).toBe("president");
  });

  it("stops telling a subscriber after it unsubscribes", () => {
    const store = createRoleStore(() => null);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();
    store.set("president");
    expect(listener).not.toHaveBeenCalled();
  });
});
