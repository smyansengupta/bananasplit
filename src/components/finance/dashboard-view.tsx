import { AlertTriangle, Info } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { DashboardData } from "@/app/app/[orgSlug]/finance/queries";
import { FINANCE_CARD_IDS, type FinanceCardId } from "@/lib/finance/dashboard-cards";
import { formatCents } from "@/lib/finance/money";
import { formatFinanceDate, type Runway } from "@/lib/finance/stats";

import { BurnChart } from "./burn-chart";
import { RunwayStatusLabel } from "./runway-status";

export function DashboardView({
  data,
  orgSlug,
  moneyOwedToYouCents,
  cards = new Set(FINANCE_CARD_IDS),
}: {
  data: DashboardData;
  orgSlug: string;
  moneyOwedToYouCents: number;
  /** The optional sections to show (OrgSettings.financeDashboardCards). */
  cards?: ReadonlySet<FinanceCardId>;
}) {
  if (!data.period) {
    return (
      <div className="space-y-4">
        <p className="text-muted-foreground text-sm">
          No active budget period yet.{" "}
          <Link href={`/app/${orgSlug}/finance/budget`} className="text-primary hover:underline">
            Create one
          </Link>{" "}
          to start tracking.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Balance" value={formatCents(data.balanceCents)}>
          <CardDescription>{data.period.label}</CardDescription>
        </StatCard>
        <StatCard title="Allocated" value={formatCents(data.totalAllocatedCents)} />
        <StatCard
          title="Owed to members"
          value={formatCents(data.outstandingReimbursementsCents)}
        />
        <Link href={`/app/${orgSlug}/finance/my-reimbursements`}>
          <StatCard
            title="Owed to you"
            value={formatCents(moneyOwedToYouCents)}
            className="hover:bg-accent/50 h-full transition-colors"
          />
        </Link>
      </div>

      {data.unreconciledOver60DaysCount > 0 && (
        <div className="border-destructive/30 bg-destructive/10 text-destructive flex items-center gap-2 rounded-md border p-3 text-sm">
          <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
          {data.unreconciledOver60DaysCount} transaction(s) are unreconciled and over 60 days old.
        </div>
      )}

      {cards.has("runway") && data.runway && (
        <RunwaySection
          runway={data.runway}
          period={data.period}
          expectedIncomeCents={data.sponsorshipCommittedCents}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {cards.has("categories") && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Spent by category</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.categories.length === 0 && (
              <p className="text-muted-foreground text-sm">No categories yet.</p>
            )}
            {data.categories.map((c) => {
              const pct =
                c.allocatedCents > 0
                  ? Math.min(100, Math.round((c.spentCents / c.allocatedCents) * 100))
                  : 0;
              const over = c.spentCents > c.allocatedCents;
              return (
                <div key={c.id} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span>{c.name}</span>
                    <span className={over ? "text-destructive" : "text-muted-foreground"}>
                      {formatCents(c.spentCents)} / {formatCents(c.allocatedCents)}
                    </span>
                  </div>
                  <div className="bg-muted h-2 overflow-hidden rounded-full">
                    <div
                      className={`h-full rounded-full ${over ? "bg-destructive" : "bg-primary"}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
        )}

        {cards.has("sponsorships") && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Sponsorships</CardTitle>
            <CardDescription>Pledged money never counts toward the balance above.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2">
                <Badge variant="secondary">Committed</Badge>
                Not yet received
              </span>
              <span className="font-medium">{formatCents(data.sponsorshipCommittedCents)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2">
                <Badge>Received</Badge>
                In the ledger
              </span>
              <span className="font-medium">{formatCents(data.sponsorshipReceivedCents)}</span>
            </div>
          </CardContent>
        </Card>
        )}
      </div>

      {cards.has("burn") && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Burn by month</CardTitle>
          </CardHeader>
          <CardContent>
            <BurnChart data={data.burnByMonth} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatCard({
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
function RunwaySection({
  runway,
  period,
  expectedIncomeCents,
}: {
  runway: Runway;
  period: { label: string; endsOn: Date };
  expectedIncomeCents: number;
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
      <h2 id="runway-heading" className="text-sm font-medium">
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
