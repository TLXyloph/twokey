import type { Metadata } from "next";
import { Bricolage_Grotesque, Geist } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

// Two faces, fetched at build time and served from this site (no runtime requests to Google).
// Display: Bricolage Grotesque with its optical-size axis. Text and interface: Geist Sans.
const display = Bricolage_Grotesque({ subsets: ["latin"], axes: ["opsz"], variable: "--font-display" });
const text = Geist({ subsets: ["latin"], variable: "--font-text" });

export const metadata: Metadata = {
  title: "TwoKey",
  description: "Two-key payouts and an AI-watched ledger for volunteer clubs (demo data, PayPal sandbox).",
};

/**
 * Design-feedback toolbar (Agentation), development only. The import sits inside a branch that the
 * production build folds to `false`, so the package never reaches the deployed bundle (it is a
 * licence-restricted dev tool). Manual copy/paste mode: no endpoint, notes stay in the browser.
 */
async function devToolbar(): Promise<ReactNode> {
  if (process.env.NODE_ENV === "development") {
    const { Agentation } = await import("agentation");
    return <Agentation />;
  }
  return null;
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const toolbar = await devToolbar();
  return (
    // The landing page adds a "js" class to <html> before first paint (it gates the load motion),
    // so the class attribute differs from the server's by design.
    <html lang="en" className={`${display.variable} ${text.variable}`} suppressHydrationWarning>
      <body>
        {children}
        {toolbar}
      </body>
    </html>
  );
}
