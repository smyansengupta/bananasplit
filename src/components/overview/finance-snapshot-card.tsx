import Link from "next/link";

import { RunwayStatusLabel } from "@/components/finance/runway-status";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { DashboardData } from "@/app/app/[orgSlug]/finance/queries";
import { formatCents } from "@/lib/finance/money";
import { formatFinanceDate } from "@/lib/finance/stats";

/**
 * The overview's finance card for OWNER/TREASURER: the balance and when it
 * runs out, from the same figures as the finance dashboard. Everyone else
 * sees what the club owes them instead.
 */
export function FinanceSnapshotCard({
  orgSlug,
  dashboard,
  moneyOwedToYouCents,
}: {
  orgSlug: string;
  dashboard: DashboardData;
  moneyOwedToYouCents: number;
}) {
  const { period, runway } = dashboard;
  return (
    <Link href={`/app/${orgSlug}/finance`}>
      <Card className="hover:bg-accent/50 h-full transition-colors">
        <CardHeader>
          <CardTitle className="text-sm font-medium">Club balance</CardTitle>
          {period && runway ? (
            <>
              <CardDescription>
                {formatCents(dashboard.balanceCents)} · {period.label}
              </CardDescription>
              <RunwayStatusLabel runway={runway} periodEndsOn={period.endsOn} />
              {runway.status === "lasts" && runway.runOutDate && (
                <CardDescription>
                  At this rate, until about {formatFinanceDate(runway.runOutDate)}
                </CardDescription>
              )}
            </>
          ) : (
            <CardDescription>No active budget period yet</CardDescription>
          )}
          {moneyOwedToYouCents > 0 && (
            <CardDescription>{formatCents(moneyOwedToYouCents)} owed to you</CardDescription>
          )}
        </CardHeader>
      </Card>
    </Link>
  );
}
