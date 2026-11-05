/**
 * Whether the payout drawer is open. A tiny external store, because the button that opens it lives
 * in the board's header (a server component's client island) and the drawer lives beside the board.
 */
let open = false;
const listeners = new Set<() => void>();

const notify = () => {
  for (const listener of [...listeners]) listener();
};

export const drawerStore = {
  isOpen: () => open,
  open() {
    if (open) return;
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
