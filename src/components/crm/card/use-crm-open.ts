"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";

import { crmRecordHref, type CrmTargetKind } from "@/lib/crm/href";
import {
  hrefWithOpen,
  opensInstantly,
  OPEN_PARAM,
  parseOpen,
  rendersOverlays,
  type CrmOpen,
} from "@/lib/crm/overlay";

/**
 * The card being opened (its `open` value) before the page with it arrives:
 * CrmPendingCard draws the card's frame at once, and the card on screen
 * gives way to it. Set by setOpen and by any click on a link to another
 * card; cleared when the URL has it, or when its frame is closed. Never set
 * for a create dialog (opensInstantly): those need no frame.
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
 * closing replaces, removing `open` and keeping the rest of the URL. A
 * create dialog does both shallowly: the URL changes, the server isn't asked.
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
      const value = new URL(href, "http://x").searchParams.get(OPEN_PARAM);
      if (rendersOverlays(pathname) && opensInstantly(parseOpen(value))) {
        window.history.pushState(null, "", href);
        return;
      }
      setPendingOpen(value);
      router.push(href, { scroll: false });
    },
    [router, pathname, params],
  );
  const close = useCallback(() => {
    const href = hrefWithOpen(pathname, params, null);
    if (opensInstantly(open)) window.history.replaceState(null, "", href);
    else router.replace(href, { scroll: false });
  }, [router, pathname, params, open]);
  return { open, raw, hrefFor, setOpen, close };
}

/**
 * Whether a card is showing, and how it moves. Closing hides it on the
 * click; the URL catches up after. It gives way, at once, to another card on
 * its way (CrmPendingCard) and to a create dialog opened over it, which
 * moves the URL without replacing the page this card came with. A card
 * landing on its frame doesn't fade in: the frame is already there, so one
 * popup takes the other's place and nothing shows behind it.
 */
export function useCardPresence(onClose?: () => void) {
  const { close, raw } = useCrmOpen();
  const pending = usePendingOpen();
  const [closing, setClosing] = useState(false);
  const [mine] = useState(raw);
  const [landed] = useState(pending !== null && pending === raw);
  const replaced = (pending !== null && pending !== raw) || (mine !== null && raw !== mine);
  const shown = !closing && !replaced;
  return {
    shown,
    motion: replaced || (landed && shown) ? ("none" as const) : ("full" as const),
    shut: () => {
      setClosing(true);
      (onClose ?? close)();
    },
  };
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
