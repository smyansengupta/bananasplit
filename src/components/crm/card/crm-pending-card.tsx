"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

import { Dialog, DialogContent, DialogDescription, DialogHead } from "@/components/ui/dialog";
import { PHONE_FULL_SCREEN } from "@/components/ui/form-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { hrefWithOpen, OPEN_PARAM, rendersOverlays } from "@/lib/crm/overlay";
import { cn } from "@/lib/utils";

import { CRM_CARD_FRAME } from "./crm-card";
import { setPendingOpen, usePendingOpen } from "./use-crm-open";

/**
 * A card's frame the moment you ask for it (docs/features/crm.md, "Cards"):
 * clicking a link to a card, or setOpen, marks it pending; this draws the
 * same 680px frame with a loading body over the page you're on, which stays
 * put, until the page with the real card arrives. It lives in the CRM's
 * layout, so it outlasts the navigation. Closing it before the card comes
 * cancels: the card is closed again as soon as it lands.
 */
export function CrmPendingCard() {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const params = useSearchParams();
  const current = params.get(OPEN_PARAM);
  const pending = usePendingOpen();
  const cancelled = useRef<string | null>(null);

  // A click on a link to another card over this page: show its frame now.
  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const a = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(a instanceof HTMLAnchorElement) || (a.target && a.target !== "_self")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname !== window.location.pathname) return;
      if (!rendersOverlays(url.pathname)) return;
      const next = url.searchParams.get(OPEN_PARAM);
      const now = new URLSearchParams(window.location.search).get(OPEN_PARAM);
      if (next && next !== now) setPendingOpen(next);
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  // The page with the card is here (or you went somewhere else): done.
  useEffect(() => {
    if (pending && pending === current) setPendingOpen(null);
  }, [pending, current]);
  useEffect(() => setPendingOpen(null), [pathname]);
  // Never stuck: a navigation that went nowhere lets the frame go.
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => setPendingOpen(null), 20_000);
    return () => clearTimeout(t);
  }, [pending]);
  // Closed before it came: close the card as soon as it lands.
  useEffect(() => {
    if (current && cancelled.current === current) {
      cancelled.current = null;
      router.replace(hrefWithOpen(pathname, params, null), { scroll: false });
    }
  }, [current, pathname, params, router]);

  const open = Boolean(pending && pending !== current);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) return;
        cancelled.current = pending;
        setPendingOpen(null);
      }}
    >
      <DialogContent showCloseButton={false} className={cn(CRM_CARD_FRAME, PHONE_FULL_SCREEN)}>
        <DialogDescription className="sr-only">Opening</DialogDescription>
        <header className="border-border/60 flex shrink-0 flex-col gap-4 border-b ps-6 pe-4 pt-4 pb-3.5 max-sm:ps-4">
          <DialogHead
            leading={<Skeleton className="size-[52px] rounded-full max-sm:size-10" />}
            title={
              <span className="bg-muted block h-7 w-52 max-w-full animate-pulse rounded-full motion-reduce:animate-none">
                <span className="sr-only">Opening</span>
              </span>
            }
            subtitle={<Skeleton className="h-3.5 w-36 rounded-full" />}
            onClose={() => {
              cancelled.current = pending;
              setPendingOpen(null);
            }}
          />
          <Skeleton className="h-10 w-64 max-w-full rounded-full" />
        </header>
        <div className="flex min-h-0 flex-1 flex-col gap-3 px-6 py-5 max-sm:px-4" aria-busy="true">
          <Skeleton className="h-11 w-full rounded-2xl" />
          {[92, 78, 85, 60].map((w) => (
            <Skeleton key={w} className="h-4 rounded-full" style={{ width: `${w}%` }} />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
