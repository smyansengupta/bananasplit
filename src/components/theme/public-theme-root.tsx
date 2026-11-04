import { ThemeProvider } from "@/components/theme-provider";
import { getNonce } from "@/lib/security/nonce";

/**
 * Light/dark for pages that belong to no org and don't mount BrandRoot
 * (/dev, and a poll or invite link that matches no org): light, like the
 * rest of the app with nothing saved, unless the visitor stored a choice
 * ("system" follows the device), with the default globals.css tokens.
 * Passes the request's CSP nonce to next-themes' inline script on the nonce
 * routes (undefined on static-policy routes, which allow inline scripts).
 */
export async function PublicThemeRoot({ children }: { children: React.ReactNode }) {
  const nonce = await getNonce();
  return (
    <ThemeProvider defaultTheme="light" nonce={nonce}>
      {children}
    </ThemeProvider>
  );
}
