"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useSyncExternalStore } from "react";

import { crmRecordHref, type CrmTargetKind } from "@/lib/crm/href";
import {
  hrefWithOpen,
  OPEN_PARAM,
  parseOpen,
  rendersOverlays,
  type CrmOpen,
} from "@/lib/crm/overlay";

/**
 * The card being opened (its `open` value) before the page with it arrives:
 * CrmPendingCard draws the card's frame at once, and the card on screen
 * gives way to it. Set by setOpen and by any click on a link to another
 * card; cleared when the URL has it, or when its frame is closed.
 */
let pendingOpen: string | null = null;
const pendingListeners = new Set<() => void>();

export function setPendingOpen(value: string | null) {
  if (pendingOpen === value) return;
  pendingOpen = value;
  for (const l of pendingListeners) l();
}

export function usePendingOpen(): string | null {
  return useSyncExternalStore(
    (l) => {
      pendingListeners.add(l);
      return () => pendingListeners.delete(l);
    },
    () => pendingOpen,
    () => null,
  );
}

/**
 * The card that's open over this CRM page (`?open=`, src/lib/crm/overlay.ts)
 * and the ways to change it. Opening pushes (Back closes the card);
 * closing replaces, removing `open` and keeping the rest of the URL.
 */
export function useCrmOpen() {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const params = useSearchParams();
  const raw = params.get(OPEN_PARAM);
  const open = useMemo(() => parseOpen(raw), [raw]);
  const hrefFor = useCallback(
    (next: CrmOpen | string | null) => hrefWithOpen(pathname, params, next),
    [pathname, params],
  );
  const setOpen = useCallback(
    (next: CrmOpen | string) => {
      const href = hrefWithOpen(pathname, params, next);
      setPendingOpen(new URL(href, "http://x").searchParams.get(OPEN_PARAM));
      router.push(href, { scroll: false });
    },
    [router, pathname, params],
  );
  const close = useCallback(
    () => router.replace(hrefWithOpen(pathname, params, null), { scroll: false }),
    [router, pathname, params],
  );
  return { open, raw, hrefFor, setOpen, close };
}

/**
 * A link to a person, company or deal from inside the CRM: on a page that
 * renders overlays it opens the card over that page (keeping its filters);
 * anywhere else it goes to the record's list with the card open.
 */
export function useCrmRecordHref(orgSlug: string) {
  const pathname = usePathname() ?? "";
  const params = useSearchParams();
  return useCallback(
    (kind: CrmTargetKind, id: string) =>
      rendersOverlays(pathname)
        ? hrefWithOpen(pathname, params, { kind, id })
        : crmRecordHref(orgSlug, kind, id),
    [pathname, params, orgSlug],
  );
}
