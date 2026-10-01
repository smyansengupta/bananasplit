"use client";

import { ChevronDown, Pin, PinOff, Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { recordVisitAction, togglePinAction } from "@/app/app/[orgSlug]/_shell/pin-actions";
import { usePins } from "@/components/pins/pins-context";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { canonicalHref } from "@/lib/pins/pages";

/**
 * The top bar's Pin button: pins whatever is on screen (a note, a folder, a
 * task, a Tasks board, a database, any page) to the sidebar and the
 * Overview. The arrow opens "Pin something", to pin anything else.
 */
export function PinButton() {
  const pins = usePins();
  const pathname = usePathname().replace(/\/+$/, "");
  const search = useSearchParams().toString();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (!pins) return null;
  const address = search ? `${pathname}?${search}` : pathname;
  const href = canonicalHref(pins.orgSlug, address);
  const pinned = href ? pins.pinned.has(href) : false;
  // The Overview is where pins show; pinning it would only point at itself.
  const canPinHere = Boolean(href) && href !== `/app/${pins.orgSlug}`;

  return (
    <div className="flex items-center">
      {canPinHere && (
        <Button
          variant={pinned ? "secondary" : "ghost"}
          size="sm"
          aria-pressed={pinned}
          disabled={pending}
          title={error ?? (pinned ? "Unpin this page" : "Pin this page to your sidebar and Overview")}
          onClick={() =>
            start(async () => {
              setError(null);
              const result = await togglePinAction(pins.orgId, address);
              if (!result.ok) setError(result.error);
              router.refresh();
            })
          }
          className="rounded-r-none"
        >
          {pinned ? (
            <Pin className="size-4 fill-current" aria-hidden="true" />
          ) : (
            <Pin className="size-4" aria-hidden="true" />
          )}
          <span className="hidden sm:inline">{pinned ? "Pinned" : "Pin"}</span>
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            aria-label="More pin options"
            className={canPinHere ? "rounded-l-none px-1.5" : undefined}
          >
            {canPinHere ? <ChevronDown className="size-3.5" aria-hidden="true" /> : <Pin className="size-4" aria-hidden="true" />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => pins.openPicker()}>
            <Search className="size-4" aria-hidden="true" />
            Pin something…
          </DropdownMenuItem>
          {canPinHere && (
            <DropdownMenuItem
              onSelect={() =>
                start(async () => {
                  await togglePinAction(pins.orgId, address);
                  router.refresh();
                })
              }
            >
              {pinned ? <PinOff className="size-4" aria-hidden="true" /> : <Pin className="size-4" aria-hidden="true" />}
              {pinned ? "Unpin this page" : "Pin this page"}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/**
 * Records the page for "Recently visited" once the member has stayed on it
 * for a moment (so clicking through doesn't fill the list).
 */
export function VisitTracker({ orgId }: { orgId: string }) {
  const pathname = usePathname();
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (last.current === pathname) return;
    const timer = setTimeout(() => {
      last.current = pathname;
      void recordVisitAction(orgId, pathname).catch(() => undefined);
    }, 1500);
    return () => clearTimeout(timer);
  }, [orgId, pathname]);
  return null;
}
