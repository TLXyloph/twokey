"use client";

/**
 * The board's one primary action: open the payout drawer. "Review N payouts" counts the waiting
 * requests in the session's live view ("No payouts waiting" at zero); until the first view arrives it
 * counts the seed's, so the first paint matches the server's. A parent's reads "See payouts", and
 * the drawer it opens is read-only.
 */
import { drawerStore } from "@/ui/judge/drawer-store";
import { reviewButtonLabel, waitingCount } from "@/ui/judge/judge-model";
import { useActingRole, useBoardView } from "@/ui/judge/use-judge";

export function ReviewButton({ seedCount }: { seedCount: number }) {
  const { view } = useBoardView();
  const role = useActingRole();
  const label = reviewButtonLabel(role, waitingCount(view) ?? seedCount);
  return (
    <button type="button" className="board-button" aria-haspopup="dialog" onClick={(event) => drawerStore.open(event.currentTarget)}>
      {label}
    </button>
  );
}
