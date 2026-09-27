"use client";

import { useCallback, useSyncExternalStore } from "react";

import { localDayKey } from "@/lib/calendar/grid";

/**
 * The three things the calendar needs from outside React: the viewport
 * width, the viewer's current day, and the current minute.
 *
 * All three are read with useSyncExternalStore rather than an effect that
 * sets state. That is what the API is for, and it matters here: the server
 * renders the grid, so each hook declares the value the server used
 * (the org's day, "not narrow", "no now line") and swaps in the real one on
 * hydration without a second render pass or a hydration mismatch.
 */

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query]);
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

function subscribeToMinute(onChange: () => void) {
  const timer = setInterval(onChange, 30_000);
  return () => clearInterval(timer);
}

/**
 * Today in the VIEWER's timezone. `serverKey` is today in the org's
 * timezone, which is what the server rendered; the two differ only for a
 * viewer who is in a different day from the club right now.
 */
export function useTodayKey(serverKey: string): string {
  return useSyncExternalStore(subscribeToMinute, () => localDayKey(new Date()), () => serverKey);
}

/** Minutes since local midnight, or null on the server and before hydration. */
export function useNowMinutes(): number | null {
  return useSyncExternalStore(subscribeToMinute, getNowMinutes, () => null);
}

function getNowMinutes(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function subscribeNever() {
  return () => {};
}

function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/**
 * The viewer's own timezone. `serverZone` is what the server rendered in
 * (for a poll, the poll's zone), so the first paint matches the HTML and the
 * browser's zone is swapped in on hydration.
 */
export function useViewerTimeZone(serverZone: string): string {
  return useSyncExternalStore(subscribeNever, deviceTimeZone, () => serverZone);
}
