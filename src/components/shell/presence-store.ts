"use client";

import { useSyncExternalStore } from "react";

import type { OnlineNow } from "@/server/presence";

/**
 * Who's online, as the shell's last heartbeat answered it (PresenceBeat),
 * for anything on screen that shows it: Overview's "members online" and
 * People's dots and Online filter stay live without asking the server
 * again. null until the first beat answers (use what the page was rendered
 * with).
 */

/** What a heartbeat answers (src/server/presence.ts). */
export type OnlinePeople = OnlineNow;

interface LiveOnline {
  orgId: string;
  people: OnlinePeople;
  /** The other members online now (you're always online to yourself). */
  ids: ReadonlySet<string>;
}

let current: LiveOnline | null = null;
const listeners = new Set<() => void>();

export function publishOnline(orgId: string, people: OnlinePeople) {
  current = { orgId, people, ids: new Set(people.ids) };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function useCurrent(): LiveOnline | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
}

/** The online members of `orgId` from the last beat, or null before one. */
export function useLiveOnline(orgId: string): ReadonlySet<string> | null {
  const live = useCurrent();
  return live?.orgId === orgId ? live.ids : null;
}

/** Everything the last beat said about `orgId`, or null before one. */
export function useLivePeople(orgId: string): OnlinePeople | null {
  const live = useCurrent();
  return live?.orgId === orgId ? live.people : null;
}
