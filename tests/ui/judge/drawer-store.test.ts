import { afterEach, describe, expect, it, vi } from "vitest";
import { boardViewClient, wantsDrawerOpen, wantsFixture } from "@/ui/judge/board-view-source";
import { drawerStore } from "@/ui/judge/drawer-store";

afterEach(() => {
  drawerStore.close();
});

describe("the drawer store", () => {
  it("opens once, remembers what opened it, and tells subscribers", () => {
    const listener = vi.fn();
    const unsubscribe = drawerStore.subscribe(listener);
    const button = { id: "review" } as unknown as Element;

    drawerStore.open(button);
    drawerStore.open(null);
    expect(drawerStore.isOpen()).toBe(true);
    expect(drawerStore.opener()).toBe(button);

    drawerStore.close();
    drawerStore.close();
    expect(drawerStore.isOpen()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });
});

describe("the board-view source", () => {
  it("reads the dev-only URL flags", () => {
    expect(wantsFixture("?fixture=1")).toBe(true);
    expect(wantsFixture("?fixture=0")).toBe(false);
    expect(wantsFixture("")).toBe(false);
    expect(wantsDrawerOpen("?fixture=1&drawer=open")).toBe(true);
    expect(wantsDrawerOpen("?fixture=1")).toBe(false);
  });

  it("has no client on the server", () => {
    expect(boardViewClient()).toBeNull();
  });
});
