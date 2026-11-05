"use client";

/**
 * The judge-mode panel: a slim band across the top of the board, above its header, so it never
 * covers Studio's controls or the AI panel at any width. It names the mode, holds the role switch,
 * links to the parent's ticket page, replays a real outside send through the Watchtower, and says,
 * in one line, what the keys are.
 */
import Link from "next/link";
import { ReplayButton } from "@/ui/watchtower/replay-button";
import { RoleSwitch } from "./role-switch";
import "./judge-panel.css";

export const PARENT_PAGE_HREF = "/demo/pay/banquet?judge=1";

export function JudgePanel() {
  return (
    <aside className="judge-bar" aria-label="Judge mode">
      <p className="judge-bar__title">Judge mode</p>
      <RoleSwitch name="judge-role-bar" />
      <Link className="judge-bar__link" href={PARENT_PAGE_HREF}>
        Buy banquet tickets (parent page)
      </Link>
      <ReplayButton />
      {/* Short enough that the band stays one line at 1440 with the replay button. */}
      <p className="judge-bar__note">Signatures use the server&apos;s demo keys. A real club would use passkeys.</p>
    </aside>
  );
}
