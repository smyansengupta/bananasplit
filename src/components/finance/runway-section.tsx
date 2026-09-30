import { Info } from "lucide-react";
import type { ReactNode } from "react";

import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCents } from "@/lib/finance/money";
import { formatFinanceDate, type Runway } from "@/lib/finance/stats";

import { RunwayStatusLabel } from "./runway-status";

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
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <CardDescription className="text-foreground text-2xl font-semibold">
          {value}
        </CardDescription>
        {children}
      </CardHeader>
    </Card>
  );
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
      <h2 id="runway-heading" className={hideHeading ? "sr-only" : "text-sm font-medium"}>
        Runway
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">When the money runs out</CardTitle>
            <RunwayStatusLabel runway={runway} periodEndsOn={period.endsOn} className="text-base" />
            <CardDescription>{detail}</CardDescription>
            {withExpected && <CardDescription>{withExpected}</CardDescription>}
          </CardHeader>
        </Card>
        <StatCard
          title="Projected at period end"
          value={formatCents(runway.projectedEndBalanceCents)}
        >
          <CardDescription>
            {runway.daysLeftInPeriod > 0
              ? `${plural(runway.daysLeftInPeriod, "day")} left, through ${periodEnd}`
              : `${period.label} ended ${periodEnd}`}
          </CardDescription>
        </StatCard>
        <StatCard
          title="Average spend per meeting"
          value={
            runway.avgSpendPerMeetingCents === null
              ? "—"
              : formatCents(runway.avgSpendPerMeetingCents)
          }
        >
          <CardDescription>
            {runway.meetingsHeld > 0
              ? `${formatCents(runway.spentCents)} over ${plural(runway.meetingsHeld, "meeting")} held`
              : "No meetings held yet this period"}
          </CardDescription>
        </StatCard>
        <StatCard title="Meetings still scheduled" value={runway.meetingsScheduled}>
          <CardDescription>
            {runway.meetingsScheduled === 0
              ? "None left on this period's calendar"
              : runway.projectedMeetingCostCents === null
                ? "No average to project from yet"
                : `About ${formatCents(runway.projectedMeetingCostCents)} at the current average`}
          </CardDescription>
        </StatCard>
      </div>
      {runway.limitedHistory && (
        <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
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
