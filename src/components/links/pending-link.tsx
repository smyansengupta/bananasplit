"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { addLinkAction } from "@/app/app/[orgSlug]/links/actions";
import { toast } from "@/components/ui/toaster";
import { refFromPath, type LinkKind, type LinkRef } from "@/lib/links";

/**
 * Whatever New makes links to the page it was made from (a task started on
 * a meeting's page links to that meeting). New remembers the page it was
 * opened on; when the new thing exists (its own page opens, or a dialog
 * says it made one with announceCreated), this links the two and says so.
 * The memory is per tab and lasts ten minutes, so an abandoned New never
 * links something made much later.
 */

const KEY = "bananasplit:link-from";
const FRESH_MS = 10 * 60_000;
const CREATED = "bananasplit:created";

interface Pending {
  from: LinkRef;
  expects: LinkKind;
  at: number;
}

/** What each New action makes, as a link kind. */
const EXPECTS: Record<string, LinkKind | undefined> = {
  task: "task",
  event: "event",
  meeting: "event",
  poll: "form",
  form: "form",
  note: "note",
  expense: "transaction",
};

function read(): Pending | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Pending;
    return Date.now() - p.at < FRESH_MS ? p : null;
  } catch {
    return null;
  }
}

function clear() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Storage off: nothing was remembered.
  }
}

/** Called by New as an action is picked: remember this page, if it's one thing. */
export function rememberLinkOrigin(actionId: string) {
  const expects = EXPECTS[actionId];
  const from = refFromPath(window.location.pathname);
  if (!expects || !from) {
    clear();
    return;
  }
  try {
    sessionStorage.setItem(
      KEY,
      JSON.stringify({ from, expects, at: Date.now() } satisfies Pending),
    );
  } catch {
    // Storage off: the new thing just won't be linked.
  }
}

/** Called by a create dialog that stays on its page (tasks, expenses). */
export function announceCreated(ref: LinkRef) {
  window.dispatchEvent(new CustomEvent<LinkRef>(CREATED, { detail: ref }));
}

async function linkIfPending(orgId: string, orgSlug: string, made: LinkRef) {
  const pending = read();
  if (!pending || pending.expects !== made.kind) return;
  if (pending.from.kind === made.kind && pending.from.id === made.id) return;
  clear();
  const result = await addLinkAction(orgId, orgSlug, pending.from, made);
  if (!result.error) toast({ title: "Linked to the page you came from" });
}

/** Mounted once in the shell: links what New made to where it was opened. */
export function PendingLinkWatcher({ orgId, orgSlug }: { orgId: string; orgSlug: string }) {
  const pathname = usePathname() ?? "";
  useEffect(() => {
    const made = refFromPath(pathname);
    if (made) void linkIfPending(orgId, orgSlug, made);
  }, [pathname, orgId, orgSlug]);
  useEffect(() => {
    const onCreated = (event: Event) => {
      const made = (event as CustomEvent<LinkRef>).detail;
      if (made) void linkIfPending(orgId, orgSlug, made);
    };
    window.addEventListener(CREATED, onCreated);
    return () => window.removeEventListener(CREATED, onCreated);
  }, [orgId, orgSlug]);
  return null;
}
