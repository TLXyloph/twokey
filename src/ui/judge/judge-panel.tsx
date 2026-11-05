"use client";

/**
 * The judge-mode panel: a slim band across the top of every demo screen, above its header, so it
 * never covers Studio's controls or the AI panel at any width. One line at 1440:
 *
 *   Judge mode  Board · Parent ledger · Monthly close · Key setup   ...   Acting as [roles]
 *   Buy tickets (parent page)   [Replay an outside send] [Start over]
 *
 * Where you are on the left (the mode and the screens), what you can do on the right (who you act
 * as, the parent's page, the two judge actions). The demo-keys note lives where keys are shown:
 * "Who holds the keys" on /demo/keys, and each signature's "demo key" line in the drawer.
 *
 * No props: every demo page renders the same band (`<JudgePanel />`); the nav marks the current
 * screen from the URL.
 */
import Link from "next/link";
import { ReplayButton } from "@/ui/watchtower/replay-button";
import { RoleSwitch } from "./role-switch";
import { SiteNav } from "./site-nav";
import { StartOver } from "./start-over";
import "./judge-panel.css";

export const PARENT_PAGE_HREF = "/demo/pay/banquet?judge=1";

export function JudgePanel() {
  return (
    <aside className="judge-bar" aria-label="Judge mode">
      <p className="judge-bar__title">Judge mode</p>
      <SiteNav />
      <RoleSwitch name="judge-role-bar" />
      <Link className="judge-bar__link" href={PARENT_PAGE_HREF}>
        Buy tickets (parent page)
      </Link>
      <StartOver>
        <ReplayButton />
      </StartOver>
    </aside>
  );
}
