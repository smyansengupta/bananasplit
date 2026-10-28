import { Geist } from "next/font/google";

import { ThemeProvider } from "@/components/theme-provider";
import { getNonce } from "@/lib/security/nonce";
import { themeStyleSheet } from "@/lib/theme/css";
import { deriveTheme } from "@/lib/theme/derive";
import { GRAPHITE_PRESET } from "@/lib/theme/presets";
import { cn } from "@/lib/utils";

/** Bananasplit's own pages' display face: Geist, a clean grotesk for headlines (the app keeps Bricolage). */
const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });

/** Points the display face (page titles, display-title, numerals) at Geist, and sets it at 600. */
const GEIST_HEADINGS =
  "[--font-display:var(--font-geist)] [--font-heading:var(--font-geist),ui-sans-serif,system-ui,sans-serif] [--heading-weight:600]";

/**
 * Bananasplit's own pages (the home page, /pricing, sign-in, sign-up,
 * password help, email confirmation, onboarding, checkout, the 404), never
 * an organization's theme.
 *
 * `look="graphite"` (the default) is the marketing site's look, so a
 * visitor moves from the home page to sign-up without the brand changing:
 * the Graphite preset's tokens, derived like an org theme (neutral greys, a
 * near-black primary), light by default, no banana glow, and headlines in
 * Geist. A visitor's stored choice (the footer's switch, or the user menu
 * in the app) still wins, and "system" follows the device.
 *
 * `look="moonstone"` keeps the app's own tokens (globals.css), dark by
 * default, with `.corona` lighting the top of the page with the banana glow.
 *
 * `look="cream"` keeps the older cream-and-banana look for a page that
 * hasn't moved to Moonstone yet: always light, with the tokens pointed at
 * the cream palette (src/app/brand.css).
 */
export async function BrandRoot({
  children,
  className,
  look = "graphite",
}: {
  children: React.ReactNode;
  className?: string;
  look?: "moonstone" | "cream" | "graphite";
}) {
  const nonce = await getNonce();
  if (look === "graphite") {
    const { light, dark } = GRAPHITE_PRESET;
    const css = themeStyleSheet(deriveTheme(light, dark));
    return (
      <ThemeProvider defaultTheme="light" nonce={nonce}>
        {css && <style data-brand-theme="" dangerouslySetInnerHTML={{ __html: css }} />}
        <div
          data-look="graphite"
          className={cn(
            "brand flex min-h-svh flex-1 flex-col",
            geist.variable,
            GEIST_HEADINGS,
            className,
          )}
        >
          {children}
        </div>
      </ThemeProvider>
    );
  }
  if (look === "cream") {
    return (
      <ThemeProvider forcedTheme="light" defaultTheme="light" nonce={nonce}>
        <div data-look="cream" className={cn("brand flex min-h-svh flex-1 flex-col", className)}>
          {children}
        </div>
      </ThemeProvider>
    );
  }
  return (
    <ThemeProvider defaultTheme="dark" nonce={nonce}>
      <div className={cn("brand corona flex min-h-svh flex-1 flex-col", className)}>{children}</div>
    </ThemeProvider>
  );
}
