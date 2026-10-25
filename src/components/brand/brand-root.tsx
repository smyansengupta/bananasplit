import { ThemeProvider } from "@/components/theme-provider";
import { getNonce } from "@/lib/security/nonce";
import { cn } from "@/lib/utils";

/**
 * Bananasplit's own pages (the home page, sign-in, sign-up, password help,
 * email confirmation, checkout, the 404): Graphite, never a club's theme.
 * They use the app's own tokens (globals.css), so a page here and a page
 * in the app are built from the same colours, and they open light, as the
 * app does. A visitor's stored choice (the footer's switch, or
 * the user menu in the app) still wins, and "system" follows the device.
 * `.corona` lights the top of the page with the drifting banana glow.
 *
 * `look="cream"` keeps the older cream-and-banana look for a page that
 * hasn't moved to Moonstone yet: always light, with the tokens pointed at
 * the cream palette (src/app/brand.css).
 */
export async function BrandRoot({
  children,
  className,
  look = "moonstone",
}: {
  children: React.ReactNode;
  className?: string;
  look?: "moonstone" | "cream";
}) {
  const nonce = await getNonce();
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
    <ThemeProvider defaultTheme="light" nonce={nonce}>
      <div className={cn("brand corona flex min-h-svh flex-1 flex-col", className)}>{children}</div>
    </ThemeProvider>
  );
}
