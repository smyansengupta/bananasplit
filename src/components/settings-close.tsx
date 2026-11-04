"use client";

import { X } from "@/components/icons";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";

/**
 * The way out of settings (the Admin panel and CRM settings): the round
 * black Close every dialog has, kept in view at the top right of the page.
 * It goes back to the page you came from, however many sections you looked
 * at on the way. BeforeSettings notes that page as you move around the app;
 * a tab that opened straight on settings gets `fallback` (Home, or Today).
 */

const KEY = "bananasplit:before-settings";

const SETTINGS_PATH = /^\/app\/[^/]+\/(?:crm\/)?settings(?:\/|$)/;

export function isSettingsPath(pathname: string): boolean {
  return SETTINGS_PATH.test(pathname);
}

/** Notes the last page that wasn't settings. Once, in the app's layout. */
export function BeforeSettings() {
  const pathname = usePathname() ?? "";
  const search = useSearchParams()?.toString() ?? "";
  useEffect(() => {
    if (!pathname || isSettingsPath(pathname)) return;
    try {
      sessionStorage.setItem(KEY, search ? `${pathname}?${search}` : pathname);
    } catch {
      // Storage off: Close uses its fallback.
    }
  }, [pathname, search]);
  return null;
}

function readBefore(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

const noSubscribe = () => () => undefined;

/** Another organization's page in this tab isn't a way back from this one. */
function inOrg(href: string, orgSlug: string): boolean {
  const base = `/app/${orgSlug}`;
  return href === base || href.startsWith(`${base}/`) || href.startsWith(`${base}?`);
}

export function SettingsClose({
  orgSlug,
  fallback,
  label = "Close settings",
}: {
  orgSlug: string;
  /** Where Close goes when there's no page to go back to. */
  fallback: string;
  label?: string;
}) {
  const before = useSyncExternalStore(noSubscribe, readBefore, () => null);
  const href = before && inOrg(before, orgSlug) ? before : fallback;
  return (
    <Link
      href={href}
      aria-label={label}
      title={label}
      className="bg-foreground text-background focus-visible:outline-foreground inline-grid size-9 shrink-0 place-items-center rounded-full shadow-sm transition-[background-color,transform] duration-150 outline-none hover:bg-[color-mix(in_oklab,var(--foreground)_80%,var(--background))] focus-visible:outline-2 focus-visible:outline-offset-2 active:scale-[0.94]"
    >
      <X className="size-4" aria-hidden="true" />
    </Link>
  );
}

/**
 * Close, floating at the top right of a settings page: the page's title row
 * makes room for it, and it stays in view as the page scrolls. Put it first
 * in the column it belongs to.
 */
export function SettingsCloseFloat(props: Parameters<typeof SettingsClose>[0]) {
  return (
    <div className="sticky top-6 z-20 float-right ms-3 h-9">
      <SettingsClose {...props} />
    </div>
  );
}
