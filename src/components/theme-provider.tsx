"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

/**
 * next-themes with the app's settings (the `dark` class on <html>, the
 * device preference as "system", no transition flash on switch).
 *
 * Mounted per route subtree, never in the root layout: next-themes 0.4.6
 * turns a nested provider into a pass-through, so the org layout could not
 * apply the org's default mode or lock under a root provider. Mount points:
 * - src/app/app/[orgSlug]/layout.tsx: the org's default mode and lock
 *   (src/components/theme/org-theme-root.tsx);
 * - the org-owned public pages (/poll/[pollId], /invite/[token]): the org's
 *   default and lock again;
 * - every other page family (sign-in, sign-up, onboarding, verify-email,
 *   the home page, /dev): the device preference
 *   (src/components/theme/public-theme-root.tsx).
 *
 * On the nonce routes the server passes the request's CSP nonce, which
 * next-themes puts on its inline script (and its transition-blocking style).
 */
export function ThemeProvider({ children, ...props }: ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider attribute="class" enableSystem disableTransitionOnChange {...props}>
      {children}
    </NextThemesProvider>
  );
}
