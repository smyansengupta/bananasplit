"use client";

import { Moon, Sun } from "@/components/icons";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";

import { capsuleButtonClass } from "@/components/shell/capsule";
import { cn } from "@/lib/utils";

const subscribe = () => () => {};

/**
 * Light or dark, one click from anywhere (the tool capsule). It sets the
 * member's own choice, as the user menu's Light and Dark do; System stays
 * in that menu. When the club locks the mode (Settings › Theme), next-themes
 * reports it as forcedTheme and the button only says so.
 *
 * The icon follows the `dark` class through CSS, so the server's render and
 * the first client render agree; the pressed state waits for hydration.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, forcedTheme, setTheme } = useTheme();
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const locked = Boolean(forcedTheme);
  const dark = (forcedTheme ?? resolvedTheme) === "dark";
  const label = locked ? "Dark mode (set by your organization)" : "Dark mode";

  return (
    <button
      type="button"
      aria-label={label}
      title={locked ? "Your organization set light or dark for everyone" : "Switch light and dark"}
      aria-pressed={hydrated ? dark : undefined}
      aria-disabled={locked || undefined}
      onClick={() => {
        if (!locked) setTheme(dark ? "light" : "dark");
      }}
      className={cn(capsuleButtonClass, className)}
    >
      <Sun className="size-5 dark:hidden" strokeWidth={1.75} aria-hidden="true" />
      <Moon className="hidden size-5 dark:block" strokeWidth={1.75} aria-hidden="true" />
    </button>
  );
}
