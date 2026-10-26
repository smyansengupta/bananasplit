import { HardDrive } from "@/components/icons";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { formatStorage, formatUsed, storageLevel } from "@/lib/billing/storage";
import { cn } from "@/lib/utils";

/**
 * The storage line for owners and admins (or the Personal owner), from 80%
 * of the plan's storage (redesign guide 11.2): on the storage page and the
 * Files page's header. At 100% it says uploads have stopped. Nothing for
 * anyone else, and nothing under 80%. Plain props, so it renders anywhere;
 * <SpaceStorageBanner orgSlug> (./space-storage-banner.tsx) loads them on
 * the server.
 */
export function StorageBanner({
  orgSlug,
  usedBytes,
  limitBytes,
  canManage,
  personal = false,
  /** Leave out the link when the banner is on the storage page itself. */
  showLink = true,
  className,
}: {
  orgSlug: string;
  usedBytes: number;
  limitBytes: number;
  /** Owners and admins, or the Personal owner. */
  canManage: boolean;
  personal?: boolean;
  showLink?: boolean;
  className?: string;
}) {
  const level = storageLevel(usedBytes, limitBytes);
  if (!canManage || level === "ok") return null;
  const used = `${formatUsed(usedBytes, limitBytes)} of ${formatStorage(limitBytes)}`;
  const whose = personal ? "Your space" : "Your club";
  const percent = Math.min(100, Math.floor((usedBytes / limitBytes) * 100));
  return (
    <div
      role="status"
      className={cn(
        "rounded-tile flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm",
        level === "full" ? "bg-tint-danger text-tint-danger-foreground" : "bg-tint-accent text-tint-accent-foreground",
        className,
      )}
    >
      <HardDrive className="size-4 shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1">
        {level === "full" ? (
          <>
            <strong className="font-semibold">Storage is full: {used} used.</strong> Uploads have
            stopped; everything else works and nothing is deleted. Empty the trash or change plan to
            upload again.
          </>
        ) : (
          <>
            <strong className="font-semibold">
              {whose} is using {percent}% of its storage
            </strong>{" "}
            ({used}). Uploads stop at 100%. Empty the trash or change plan for more room.
          </>
        )}
      </p>
      {showLink && (
        <Button asChild size="sm" variant="outline">
          <Link href={`/app/${orgSlug}/settings/plan/storage`}>See storage</Link>
        </Button>
      )}
    </div>
  );
}
