import { Clock, Sparkles } from "@/components/icons";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  spaceStatus,
  TRIAL_NOTICE_DAYS,
  trialDaysLeft,
  trialPlanName,
  type SpaceInfo,
} from "@/lib/billing/space";

/**
 * The line above every page of a space about its plan (the org layout), for
 * owners and admins only:
 * - the trial's last TRIAL_NOTICE_DAYS days: when it ends, what it moves to,
 *   and the plans. A Personal space's trial (Personal Plus) too.
 * - an organization's trial ended before a plan was picked: it is on Free,
 *   nothing was deleted, and the paid features are a click away. It stops
 *   once the owner picks a plan (Free included). A Personal space hears it
 *   once, from TrialEndedDialog, since it has no plan to pick to stop it.
 * Members never see a price, a trial or a paywall. Nothing for a space that
 * picked its plan.
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
  if (!canChoosePlan) return null;

  if (status === "free" && space.plan === "TRIAL") {
    return (
      <div
        role="status"
        className="bg-muted/40 mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border px-4 py-3 text-sm"
      >
        <Sparkles className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
        <p className="min-w-0 flex-1">Trial ended: you&apos;re on Free. Nothing was deleted.</p>
        <Button asChild size="sm" variant="outline">
          <Link href={planHref}>See plans</Link>
        </Button>
      </div>
    );
  }

  const days = trialDaysLeft(space, now);
  if (days !== null && days > 0 && days <= TRIAL_NOTICE_DAYS) {
    const personal = space.kind === "PERSONAL";
    return (
      <div
        role="status"
        className="bg-muted/40 mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border px-4 py-3 text-sm"
      >
        <Clock className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
        <p className="min-w-0 flex-1">
          {trialPlanName(space)} trial ends in {days} {days === 1 ? "day" : "days"}.
        </p>
        <Button asChild size="sm" variant="outline">
          <Link href={planHref}>Keep {personal ? trialPlanName(space) : "everything"}</Link>
        </Button>
      </div>
    );
  }
  return null;
}
