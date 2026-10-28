import { Clock, Sparkles } from "@/components/icons";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { spaceStatus, trialDaysLeft, type SpaceInfo } from "@/lib/billing/space";

/** Owners and admins hear about the trial from this many days before it ends. */
export const TRIAL_NOTICE_DAYS = 7;

/**
 * The line above every page of an organization about its plan (the org
 * layout), for owners and admins only:
 * - the trial's last TRIAL_NOTICE_DAYS days: when it ends and the plans.
 * - the trial ended before a plan was picked: the organization is on Free,
 *   nothing was deleted, and the paid features are a click away. It stops
 *   once the owner picks a plan (Free included).
 * Members never see a price, a trial or a paywall. Nothing for Personal or
 * an organization that picked its plan.
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
        <p className="min-w-0 flex-1">
          Your free trial of Team Advanced has ended, so your organization is on Free. Nothing was
          deleted: finance, reports, the org chart and AI come back with Team or Team Advanced.
        </p>
        <Button asChild size="sm" variant="outline">
          <Link href={planHref}>See plans</Link>
        </Button>
      </div>
    );
  }

  const days = trialDaysLeft(space, now);
  if (status === "trial" && days !== null && days <= TRIAL_NOTICE_DAYS) {
    return (
      <div
        role="status"
        className="bg-muted/40 mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border px-4 py-3 text-sm"
      >
        <Clock className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
        <p className="min-w-0 flex-1">
          Your organization&apos;s free trial ends in {days} {days === 1 ? "day" : "days"}. After
          that it moves to Free, or keep everything with Team or Team Advanced.
        </p>
        <Button asChild size="sm" variant="outline">
          <Link href={planHref}>See plans</Link>
        </Button>
      </div>
    );
  }
  return null;
}
