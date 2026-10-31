"use client";

import { Pin } from "@/components/icons";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { recordVisitAction, togglePinAction } from "@/app/app/[orgSlug]/_shell/pin-actions";
import { usePins } from "@/components/pins/pins-context";
import { canonicalHref } from "@/lib/pins/pages";
import { cn } from "@/lib/utils";

/**
 * The page on screen, as a pin: its canonical address and whether it's
 * pinned, or null where there's nothing to pin (outside a space, or the
 * Overview, which is where pins show).
 */
export function usePinTarget(): { address: string; pinned: boolean } | null {
  const pins = usePins();
  const pathname = usePathname().replace(/\/+$/, "");
  const search = useSearchParams().toString();
  if (!pins) return null;
  const address = search ? `${pathname}?${search}` : pathname;
  const href = canonicalHref(pins.orgSlug, address);
  if (!href || href === `/app/${pins.orgSlug}`) return null;
  return { address, pinned: pins.pinned.has(href) };
}

/**
 * Pins whatever is on screen (a note, a folder, a task, a Tasks board, a
 * database, any page) to the sidebar and the Overview, and unpins it again.
 * It sits on the line above the sidebar's pins. `className` styles the
 * button; `iconClassName` sizes the pin.
 */
export function PinButton({
  className,
  iconClassName = "size-5",
  showLabel = false,
}: {
  className?: string;
  iconClassName?: string;
  /** Says "Pin this page" beside the pin (Pinned's empty state). */
  showLabel?: boolean;
}) {
  const pins = usePins();
  const target = usePinTarget();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (!pins || !target) return null;
  const { address, pinned } = target;
  const label = pinned ? "Unpin this page" : "Pin this page";

  return (
    <button
      type="button"
      aria-pressed={pinned}
      aria-label={label}
      disabled={pending}
      title={error ?? (pinned ? "Unpin this page" : "Pin this page to your sidebar and Overview")}
      className={className}
      onClick={() =>
        start(async () => {
          setError(null);
          const result = await togglePinAction(pins.orgId, address);
          if (!result.ok) setError(result.error);
          router.refresh();
        })
      }
    >
      <Pin
        className={cn(iconClassName, pinned && "fill-current")}
        strokeWidth={1.75}
        aria-hidden="true"
      />
      {showLabel && label}
    </button>
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
