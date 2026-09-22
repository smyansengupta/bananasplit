import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SessionProvider } from "next-auth/react";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { auth } from "@/lib/auth/config";
import { getNonce } from "@/lib/security/nonce";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CBC Portal",
  description: "A workspace for student club executive boards.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const session = await auth();
  // The theme's inline script needs the request's CSP nonce on the nonce
  // routes (0A Fix 13). The layout is already dynamic (auth()), so reading
  // it costs nothing; Phase 9 moves this into a route-group layout.
  const nonce = await getNonce();

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <SessionProvider session={session}>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
            nonce={nonce}
          >
            <TooltipProvider>{children}</TooltipProvider>
          </ThemeProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
