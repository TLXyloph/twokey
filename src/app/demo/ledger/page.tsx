import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import { PAGE } from "@/ui/parent/content";
import { ParentLedgerPage } from "@/ui/parent/parent-page";

export const metadata: Metadata = { title: PAGE.title, description: PAGE.description };

export const viewport: Viewport = { themeColor: "#3d0012" };

/**
 * The parent ledger (/demo/ledger): the club's money in and out as every parent sees it, in the
 * team's colours, on a second AG Studio. A server component, so it can read the AG Studio licence key
 * from the server's environment at request time (a client-side licence by design, as on /demo; never
 * logged, never a NEXT_PUBLIC_ variable).
 */
export default async function ParentLedgerRoute() {
  // Render per request, so the key is read at runtime rather than baked in at build time.
  await connection();
  return <ParentLedgerPage licenseKey={process.env.AG_STUDIO_LICENSE_KEY} />;
}
