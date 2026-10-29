import { Analytics } from "@vercel/analytics/next";
import type { Metadata } from "next";
import { Bricolage_Grotesque, Hanken_Grotesk, JetBrains_Mono, Young_Serif } from "next/font/google";
import { SessionProvider } from "next-auth/react";
import "./globals.css";
import { IconMotion } from "@/components/icons/icon-motion";
import { TooltipProvider } from "@/components/ui/tooltip";
import { auth } from "@/lib/auth/config";
import { metadataBase, SITE_NAME } from "@/lib/metadata/share";

/*
 * The type system (the Moonstone redesign; globals.css maps these to
 * font-heading, font-sans and font-mono): Bricolage Grotesque for display
 * (page titles, big figures, block titles), Hanken Grotesk for the
 * interface and body, JetBrains Mono only for codes and shortcuts. Young
 * Serif stays loaded for the logo's wordmark and the "Serif" heading choice
 * in Look and feel.
 */
const display = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
  axes: ["opsz"],
});

const serif = Young_Serif({
  variable: "--font-young-serif",
  subsets: ["latin"],
  weight: "400",
});

const body = Hanken_Grotesk({
  variable: "--font-hanken",
  subsets: ["latin"],
});

const mono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
});

/*
 * What every Bananasplit link looks like where it is pasted. The pages
 * worth sharing set their own title, line and card over the top of this
 * (src/lib/metadata/share.ts); this is the floor, and it has to stay true
 * of pages nobody thought about.
 */
export const metadata: Metadata = {
  // Relative metadata URLs (every opengraph-image.png) resolve against
  // this; without it Next falls back to the deployment's own host, so a
  // shared link previews with a picture on a vercel.app URL.
  metadataBase: metadataBase(),
  title: "Bananasplit: the workspace that runs itself",
  description:
    "Your team's tasks, docs, meetings and money in one place. Bananasplit listens where you already work, handles the busywork, and texts you only when something needs you.",
  // Only what is true of every page: Next fills og:title and og:description
  // per route from that route's own title and description, so naming them
  // here would make every page preview as the home page.
  openGraph: { siteName: SITE_NAME, type: "website" },
  twitter: { card: "summary_large_image" },
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const session = await auth();

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${display.variable} ${serif.variable} ${body.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        {/*
          No ThemeProvider here (Phase 8): next-themes makes a nested provider
          a pass-through, so each page family mounts its own with the right
          default and the request's CSP nonce: the org layout (org mode and
          lock), the org-owned public pages, and PublicThemeRoot elsewhere.
          See src/components/theme-provider.tsx.
        */}
        <SessionProvider session={session}>
          <TooltipProvider>{children}</TooltipProvider>
        </SessionProvider>
        {/*
          Vercel Web Analytics: cookieless page views and the funnel's custom
          events (src/lib/analytics). Production only: in development it loads a
          debug script from Vercel's CDN, which the CSP (rightly) blocks.
        */}
        {process.env.NODE_ENV === "production" && <Analytics />}
        <IconMotion />
      </body>
    </html>
  );
}
