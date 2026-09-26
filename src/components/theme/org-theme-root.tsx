import { ThemeProvider } from "@/components/theme-provider";
import { themeStyleSheet } from "@/lib/theme/css";
import { themeProviderMode, type ResolvedTheme } from "@/lib/theme/resolve";
import { getNonce } from "@/lib/security/nonce";

/**
 * The org theme for a subtree (server component): next-themes with the org's
 * default mode (and forced mode when locked), plus the org's design tokens
 * as a server-rendered <style>.
 *
 * - The <style> uses `html:root{...}` / `html.dark{...}`, which beat the
 *   globals.css defaults and reach Radix portals on <body>. It is rendered in
 *   place (no `precedence`), so it leaves the document with the layout when
 *   the viewer switches org, and a Server Action refresh() swaps it in place.
 * - Every value was re-checked as strict hex by themeStyleSheet(); one bad
 *   value drops the sheet and the default theme shows instead.
 * - No nonce on the <style>: the CSP allows inline styles
 *   (style-src 'self' 'unsafe-inline'). next-themes' inline script gets the
 *   request nonce.
 */
export async function OrgThemeRoot({
  theme,
  children,
}: {
  theme: ResolvedTheme;
  children: React.ReactNode;
}) {
  const nonce = await getNonce();
  const { defaultTheme, forcedTheme } = themeProviderMode(theme);
  const css = theme.isDefault ? "" : themeStyleSheet(theme.tokens);

  return (
    <ThemeProvider defaultTheme={defaultTheme} forcedTheme={forcedTheme} nonce={nonce}>
      {css && <style data-org-theme="" dangerouslySetInnerHTML={{ __html: css }} />}
      {children}
    </ThemeProvider>
  );
}
