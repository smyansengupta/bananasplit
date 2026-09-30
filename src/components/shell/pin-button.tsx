"use client";

import { Pin, PinOff } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { recordVisitAction, togglePinAction } from "@/app/app/[orgSlug]/_shell/pin-actions";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * The top bar's pin toggle: pins the page being viewed (a note, a task, a
 * database, any section) to the sidebar and the Overview.
 */
export function PinButton({ orgId, pinnedHrefs }: { orgId: string; pinnedHrefs: string[] }) {
  const pathname = usePathname().replace(/\/+$/, "");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const pinned = pinnedHrefs.includes(pathname);
  // The Overview is where pins show; pinning it would only point at itself.
  const isOverview = /^\/app\/[^/]+$/.test(pathname);
  if (isOverview) return null;

  const label = pinned ? "Unpin this page" : "Pin this page";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={label}
          aria-pressed={pinned}
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError(null);
              const result = await togglePinAction(orgId, pathname);
              if (!result.ok) setError(result.error);
              router.refresh();
            })
          }
          className={pinned ? "text-primary" : undefined}
        >
          {pinned ? (
            <Pin className="size-4 fill-current" aria-hidden="true" />
          ) : (
            <Pin className="size-4" aria-hidden="true" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {error ?? (
          <span className="inline-flex items-center gap-1">
            {pinned ? <PinOff className="size-3" aria-hidden="true" /> : null}
            {label}
          </span>
        )}
      </TooltipContent>
    </Tooltip>
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
