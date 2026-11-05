"use client";

/**
 * The demo's screens, in the judge band right after "Judge mode": Board · Parent ledger · Monthly
 * close · Key setup. Plain links; the current screen takes the band's grey pill and
 * `aria-current="page"`. The parent's pay page is reached from its own link in the band, since it
 * is a page a parent opens, not a screen of the club's.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";

export interface SitePage {
  href: string;
  label: string;
}

export const SITE_PAGES: readonly SitePage[] = [
  { href: "/demo", label: "Board" },
  { href: "/demo/ledger", label: "Parent ledger" },
  { href: "/demo/close", label: "Monthly close" },
  { href: "/demo/keys", label: "Key setup" },
];

/** The page a path belongs to: `/demo` exactly, the others with anything under them. */
export function currentPage(pathname: string | null): SitePage | null {
  if (!pathname) return null;
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return SITE_PAGES.find((page) => (page.href === "/demo" ? path === "/demo" : path === page.href || path.startsWith(`${page.href}/`))) ?? null;
}

export function SiteNav({ pathname }: { pathname?: string | null }) {
  const routerPath = usePathname();
  const current = currentPage(pathname === undefined ? routerPath : pathname);
  return (
    <nav className="judge-nav" aria-label="Demo screens">
      <ul className="judge-nav__list">
        {SITE_PAGES.map((page) => (
          <li key={page.href}>
            <Link className="judge-nav__link" href={page.href} aria-current={page === current ? "page" : undefined}>
              {page.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
