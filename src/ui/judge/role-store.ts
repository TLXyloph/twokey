/**
 * Who the judge is acting as: President, Treasurer, Secretary or Parent. Client state only: the
 * role is sent as `actingAs` on each action and the server decides what it may do (spec §6).
 *
 * Kept per tab in sessionStorage, so a reload keeps the role and a second tab can act as another
 * officer. Storage can be blocked (private windows, embedded previews), so every access is guarded
 * and the role still works in memory.
 */
import type { ActingRole } from "@/ledger/contracts";
import { DEFAULT_ROLE, isActingRole } from "./judge-model";

export const ROLE_STORAGE_KEY = "twokey.judge.role";

type RoleStorage = Pick<Storage, "getItem" | "setItem">;

export interface RoleStore {
  get(): ActingRole;
  set(role: ActingRole): void;
  subscribe(listener: () => void): () => void;
}

export function createRoleStore(storage: () => RoleStorage | null): RoleStore {
  let role: ActingRole | null = null;
  const listeners = new Set<() => void>();

  const read = (): ActingRole => {
    try {
      const stored = storage()?.getItem(ROLE_STORAGE_KEY);
      return isActingRole(stored) ? stored : DEFAULT_ROLE;
    } catch {
      return DEFAULT_ROLE;
    }
  };

  return {
    get() {
      role ??= read();
      return role;
    },
    set(next) {
      if (next === role) return;
      role = next;
      try {
        storage()?.setItem(ROLE_STORAGE_KEY, next);
      } catch {
        // Blocked storage: the role lasts until the page reloads.
      }
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The page's one role store. On the server there is no storage, so it reads the default. */
export const roleStore = createRoleStore(() => (typeof window === "undefined" ? null : window.sessionStorage));
