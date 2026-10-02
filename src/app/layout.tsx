import type { Metadata } from "next";
import { Anybody, Atkinson_Hyperlegible_Next, Martian_Mono } from "next/font/google";
import { SessionProvider } from "next-auth/react";
import "./globals.css";
import { TooltipProvider } from "@/components/ui/tooltip";
import { auth } from "@/lib/auth/config";

/*
 * The type system (globals.css, "Riso bulletin"): one expressive display
 * face pushed to the ends of its width and weight axes for headings and
 * figures, a body face built for legibility in dense tables and forms, and
 * a mono for money, dates and labels. All three are variable.
 */
const display = Anybody({
  variable: "--font-anybody",
  subsets: ["latin"],
  axes: ["wdth"],
});

const body = Atkinson_Hyperlegible_Next({
  variable: "--font-atkinson",
  subsets: ["latin"],
  // next/font has no metrics for this face yet, so it can't size-match a
  // fallback; say so instead of warning on every compile.
  adjustFontFallback: false,
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
});

const mono = Martian_Mono({
  variable: "--font-martian",
  subsets: ["latin"],
  axes: ["wdth"],
});

export const metadata: Metadata = {
  title: "Bananasplit",
  description: "A workspace for student club executive boards.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const session = await auth();

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${display.variable} ${body.variable} ${mono.variable} h-full antialiased`}
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
      </body>
    </html>
  );
}
