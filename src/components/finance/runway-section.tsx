import { Info } from "@/components/icons";
import type { ReactNode } from "react";

import { formatCents } from "@/lib/finance/money";
import { formatFinanceDate, type Runway } from "@/lib/finance/stats";
import { cn } from "@/lib/utils";

import { RunwayStatusLabel } from "./runway-status";

/** One runway figure: an inset tile with a plain label, the figure, and what it counts. */
export function StatCard({
  title,
  value,
  className,
  children,
}: {
  title: string;
  value: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={cn("bg-muted/50 rounded-tile min-w-0 space-y-1.5 p-4", className)}>
      <p className="text-muted-foreground text-[13px]">{title}</p>
      <div className="numeral text-[26px]">{value}</div>
      {children}
    </div>
  );
}

function Detail({ children }: { children: ReactNode }) {
  return <p className="text-muted-foreground text-[13px] leading-snug">{children}</p>;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * The projection: the trailing burn rate run forward from today's balance,
 * and what the period's meetings cost on average. The copy under the cards
 * says exactly what each figure counts.
 */
export function RunwaySection({
  runway,
  period,
  expectedIncomeCents,
  hideHeading = false,
}: {
  runway: Runway;
  period: { label: string; endsOn: Date };
  expectedIncomeCents: number;
  /** Inside a widget, whose frame already says "Runway". */
  hideHeading?: boolean;
}) {
  const periodEnd = formatFinanceDate(period.endsOn);
  const rate = `${formatCents(runway.weeklyBurnCents)} a week`;
  const detail = {
    out: "Money out has caught up with money in this period.",
    short: `At ${rate}, before the period ends on ${periodEnd}.`,
    lasts: runway.runOutDate
      ? `At ${rate}, it lasts until about ${formatFinanceDate(runway.runOutDate)}.`
      : `At ${rate}.`,
    idle: `Nothing spent in the last ${plural(runway.burnWindowDays, "day")}, so there is no rate to project.`,
  }[runway.status];
  const sponsorships = `${formatCents(expectedIncomeCents)} in committed sponsorships`;
  const withExpected =
    expectedIncomeCents <= 0 || runway.status === "idle"
      ? null
      : {
          out: `Still out of funds with ${sponsorships}.`,
          short: runway.runOutDateWithExpected
            ? `With ${sponsorships}: runs out ${formatFinanceDate(runway.runOutDateWithExpected)}.`
            : null,
          lasts: `With ${sponsorships}: lasts past ${periodEnd}.`,
          idle: null,
        }[runway.statusWithExpected];

  return (
    <section aria-labelledby="runway-heading" className="space-y-3">
      <h2 id="runway-heading" className={hideHeading ? "sr-only" : "heading text-[17px]"}>
        Runway
      </h2>
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        <div className="bg-muted/50 rounded-tile min-w-0 space-y-1.5 p-4">
          <p className="text-muted-foreground text-[13px]">When the money runs out</p>
          <RunwayStatusLabel runway={runway} periodEndsOn={period.endsOn} className="text-base" />
          <Detail>{detail}</Detail>
          {withExpected && <Detail>{withExpected}</Detail>}
        </div>
        <StatCard
          title="Projected at period end"
          value={formatCents(runway.projectedEndBalanceCents)}
        >
          <Detail>
            {runway.daysLeftInPeriod > 0
              ? `${plural(runway.daysLeftInPeriod, "day")} left, through ${periodEnd}`
              : `${period.label} ended ${periodEnd}`}
          </Detail>
        </StatCard>
        <StatCard
          title="Average spend per meeting"
          value={
            runway.avgSpendPerMeetingCents === null
              ? "—"
              : formatCents(runway.avgSpendPerMeetingCents)
          }
        >
          <Detail>
            {runway.meetingsHeld > 0
              ? `${formatCents(runway.spentCents)} over ${plural(runway.meetingsHeld, "meeting")} held`
              : "No meetings held yet this period"}
          </Detail>
        </StatCard>
        <StatCard title="Meetings still scheduled" value={runway.meetingsScheduled}>
          <Detail>
            {runway.meetingsScheduled === 0
              ? "None left on this period's calendar"
              : runway.projectedMeetingCostCents === null
                ? "No average to project from yet"
                : `About ${formatCents(runway.projectedMeetingCostCents)} at the current average`}
          </Detail>
        </StatCard>
      </div>
      {runway.limitedHistory && (
        <p className="text-muted-foreground bg-muted/50 rounded-tile flex items-center gap-2 px-3 py-2 text-[13px]">
          <Info className="size-4 shrink-0" aria-hidden="true" />
          Only {plural(runway.burnWindowDays, "day")} of history so far: treat the projection as
          rough.
        </p>
      )}
      <p className="text-muted-foreground text-xs">
        Spending is money out that counts toward the balance: submitted, approved and reimbursed
        expenses and other outgoing transactions. Drafts, rejected expenses and voided transactions
        never count. The rate averages the last {plural(runway.burnWindowDays, "day")} of spending.
        Meetings are this period&apos;s calendar events other than board meetings.
      </p>
    </section>
  );
}
