"use client";

import { useSyncExternalStore } from "react";

/**
 * The shortcut modifier to print: "⌘" on Apple devices, "Ctrl" elsewhere.
 * The server (and the first render) say "⌘"; the platform never changes,
 * so there is nothing to subscribe to.
 */

function isApple(): boolean {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform || nav.platform || nav.userAgent;
  return /mac|iphone|ipad|ipod/i.test(platform);
}

const subscribe = () => () => {};

export function useModKey(): "⌘" | "Ctrl" {
  return useSyncExternalStore(
    subscribe,
    () => (isApple() ? "⌘" : "Ctrl"),
    () => "⌘",
  );
}
