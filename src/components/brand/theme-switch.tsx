"use client";

import { Monitor, Moon, Sun } from "@/components/icons";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";

import { Segmented, type SegmentedOption } from "@/components/ui/segmented";

const OPTIONS: readonly SegmentedOption[] = [
  { value: "light", label: "Light", icon: Sun, compact: true },
  { value: "dark", label: "Dark", icon: Moon, compact: true },
  { value: "system", label: "System", icon: Monitor, compact: true },
];

const subscribe = () => () => {};

/**
 * Light, dark or the device's choice on Bananasplit's own pages (the
 * footer). It stores the same choice as the user menu in the app. The
 * stored theme is only known in the browser, so the server renders the
 * default (dark) and the switch catches up once hydrated.
 */
export function ThemeSwitch({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  return (
    <Segmented
      label="Theme"
      options={OPTIONS}
      value={hydrated ? (theme ?? "dark") : "dark"}
      onSelect={setTheme}
      className={className}
    />
  );
}
