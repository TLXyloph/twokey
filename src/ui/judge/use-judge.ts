/**
 * React's view of the judge stores: the live board view, the acting role and the drawer. Each is an
 * external store read with `useSyncExternalStore`; the server (and hydration) see the defaults, so
 * the first paint matches the server's markup and the seed data.
 */
import { useSyncExternalStore } from "react";
import type { ActingRole } from "@/ledger/contracts";
import { EMPTY_SNAPSHOT, type BoardViewSnapshot } from "./board-view-client";
import { boardViewClient } from "./board-view-source";
import { drawerStore } from "./drawer-store";
import { DEFAULT_ROLE } from "./judge-model";
import { roleStore } from "./role-store";

const noSubscription = () => () => {};

export function useBoardView(): BoardViewSnapshot {
  const client = boardViewClient();
  return useSyncExternalStore(
    client ? client.subscribe : noSubscription,
    client ? client.getSnapshot : () => EMPTY_SNAPSHOT,
    () => EMPTY_SNAPSHOT,
  );
}

export function useActingRole(): ActingRole {
  return useSyncExternalStore(roleStore.subscribe, roleStore.get, () => DEFAULT_ROLE);
}

export function useDrawerOpen(): boolean {
  return useSyncExternalStore(drawerStore.subscribe, drawerStore.isOpen, () => false);
}
