import type { Metadata } from "next";
import { Bricolage_Grotesque, Hanken_Grotesk, JetBrains_Mono, Young_Serif } from "next/font/google";
import { SessionProvider } from "next-auth/react";
import "./globals.css";
import { IconMotion } from "@/components/icons/icon-motion";
import { TooltipProvider } from "@/components/ui/tooltip";
import { auth } from "@/lib/auth/config";

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

export const metadata: Metadata = {
  title: "Bananasplit",
  description:
    "The all-in-one workspace for student clubs: tasks, polls, RSVPs, notes, databases and the club budget.",
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
        <IconMotion />
      </body>
    </html>
  );
}
