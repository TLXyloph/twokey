"use client";

/**
 * The judge-mode panel: a slim band across the top of the board, above its header, so it never
 * covers Studio's controls or the AI panel at any width. It names the mode, holds the role switch,
 * links to the parent's ticket page and says, in one line, what the keys are.
 */
import Link from "next/link";
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
      <p className="judge-bar__note">Signatures use demo keys held by the server. A real club would give each officer a passkey.</p>
    </aside>
  );
}
