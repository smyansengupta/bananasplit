import { Clock, PauseCircle } from "@/components/icons";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { spaceStatus, trialDaysLeft, type SpaceInfo } from "@/lib/billing/space";

/** Owners and admins hear about the trial from this many days before it ends. */
export const TRIAL_NOTICE_DAYS = 7;

/**
 * The line above every page of a club about its plan (the org layout):
 * - paused (the trial ended before a plan was picked): owners and admins
 *   get "Choose a plan"; members a calm note that the officers were asked.
 *   Nothing is deleted and everything still opens.
 * - the trial's last TRIAL_NOTICE_DAYS days: owners and admins only.
 * Members never see a price, a trial or a paywall. Nothing for Personal or
 * a paid club.
 */
export function SpaceBanner({
  space,
  orgSlug,
  canChoosePlan,
  now = new Date(),
}: {
  space: SpaceInfo;
  orgSlug: string;
  /** Owners and admins (settings.view): they see the trial and the way to a plan. */
  canChoosePlan: boolean;
  now?: Date;
}) {
  const status = spaceStatus(space, now);
  const planHref = `/app/${orgSlug}/settings/plan`;

  if (status === "paused") {
    return (
      <div
        role="status"
        className="bg-muted/60 mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border px-4 py-3 text-sm"
      >
        <PauseCircle className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
        <p className="min-w-0 flex-1">
          {canChoosePlan
            ? "Your club's free trial has ended, so it's paused: everything is still here to read, but nothing can be added or changed until you choose a plan."
            : "This club is paused for now. Your officers have been asked to choose a plan. You can still open and read everything."}
        </p>
        {canChoosePlan && (
          <Button asChild size="sm">
            <Link href={planHref}>Choose a plan</Link>
          </Button>
        )}
      </div>
    );
  }

  const days = trialDaysLeft(space, now);
  if (status === "trial" && canChoosePlan && days !== null && days <= TRIAL_NOTICE_DAYS) {
    return (
      <div
        role="status"
        className="bg-muted/40 mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border px-4 py-3 text-sm"
      >
        <Clock className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
        <p className="min-w-0 flex-1">
          Your club&apos;s free trial ends in {days} {days === 1 ? "day" : "days"}. Choose Team or
          Team Advanced to keep going without a pause.
        </p>
        <Button asChild size="sm" variant="outline">
          <Link href={planHref}>See plans</Link>
        </Button>
      </div>
    );
  }
  return null;
}
