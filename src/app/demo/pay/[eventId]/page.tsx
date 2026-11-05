import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { findCollectionEvent } from "@/collections/events";
import { payPagePublicConfig } from "@/collections/wiring";
import { PayPage } from "@/ui/pay/pay-page";
import { isJudgeMode } from "@/ui/pay/pay-model";

export const metadata: Metadata = {
  title: "End-of-season banquet tickets · Riverbend Youth Football League",
  description: "Buy tickets for the Riverbend Youth Football League's end-of-season banquet with PayPal (demo data, PayPal sandbox).",
};

export const viewport: Viewport = { themeColor: "#3d0012" };

/**
 * The parent's ticket page (/demo/pay/banquet). A server component: it reads the PayPal app's
 * client id (public by design: the JS SDK sends it from the browser) and the sandbox test-buyer
 * login from the Worker env at request time, and hands only those to the page. Secrets never leave
 * the server. Only events in src/collections/events.ts exist; anything else is a 404.
 */
export default async function PayEventPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Render per request, so the env is read at runtime rather than baked in at build time.
  await connection();
  const event = findCollectionEvent((await params).eventId);
  if (!event) notFound();
  const config = payPagePublicConfig();
  return (
    <PayPage
      event={{ id: event.id, ticketPriceCents: event.ticketPriceCents, minTickets: event.minTickets, maxTickets: event.maxTickets }}
      paypalClientId={config.paypalClientId}
      testBuyer={config.testBuyer}
      judge={isJudgeMode(await searchParams)}
    />
  );
}
