/**
 * Whether the payout drawer is open, and what opened it. A tiny external store, because the button
 * that opens it lives in the board's header (a server component's client island) and the drawer
 * lives beside the board. The opener is kept so closing can return focus to it: a mouse click does
 * not focus a button in every browser, so the drawer can't rely on `document.activeElement`.
 */
let open = false;
let opener: Element | null = null;
const listeners = new Set<() => void>();

const notify = () => {
  for (const listener of [...listeners]) listener();
};

export const drawerStore = {
  isOpen: () => open,
  /** The element focus goes back to on close. */
  opener: () => opener,
  open(from: Element | null = null) {
    if (open) return;
    opener = from ?? (typeof document === "undefined" ? null : document.activeElement);
    open = true;
    notify();
  },
  close() {
    if (!open) return;
    open = false;
    notify();
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
