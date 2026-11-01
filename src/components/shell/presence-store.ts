"use client";

import { useSyncExternalStore } from "react";

/**
 * Who's online, as the sidebar's last heartbeat answered it
 * (SidebarPeople), for anything else on screen that shows it: People's
 * dots and its Online filter stay live without asking the server again.
 * null until the first beat answers (use what the page was rendered with).
 */

interface LiveOnline {
  orgId: string;
  /** The other members online now (you're always online to yourself). */
  ids: ReadonlySet<string>;
}

let current: LiveOnline | null = null;
const listeners = new Set<() => void>();

export function publishOnline(orgId: string, ids: readonly string[]) {
  current = { orgId, ids: new Set(ids) };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The online members of `orgId` from the last beat, or null before one. */
export function useLiveOnline(orgId: string): ReadonlySet<string> | null {
  const live = useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
  return live?.orgId === orgId ? live.ids : null;
}
