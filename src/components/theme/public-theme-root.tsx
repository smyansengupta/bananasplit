import { ThemeProvider } from "@/components/theme-provider";
import { getNonce } from "@/lib/security/nonce";

/**
 * Light/dark for pages that belong to no org (sign-in, sign-up, onboarding,
 * email verification, the home page, /dev): the device preference or the
 * visitor's stored choice, with the default globals.css tokens. Passes the
 * request's CSP nonce to next-themes' inline script on the nonce routes
 * (undefined on static-policy routes, which allow inline scripts).
 */
export async function PublicThemeRoot({ children }: { children: React.ReactNode }) {
  const nonce = await getNonce();
  return (
    <ThemeProvider defaultTheme="system" nonce={nonce}>
      {children}
    </ThemeProvider>
  );
}
