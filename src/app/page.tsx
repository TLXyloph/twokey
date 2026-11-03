import type { Metadata, Viewport } from "next";
import { SUPPORTING } from "@/ui/landing/content";
import { LandingPage } from "@/ui/landing/landing-page";

export const metadata: Metadata = {
  title: "TwoKey: club money takes two keys",
  description: SUPPORTING,
};

export const viewport: Viewport = { themeColor: "#3d0012" };

/** The landing page. Static: it makes no AI calls and reads no secrets; the demo lives at /demo. */
export default function Home() {
  return <LandingPage />;
}
