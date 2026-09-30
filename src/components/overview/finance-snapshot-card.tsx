import { Wallet } from "lucide-react";
import Link from "next/link";

import { RunwayStatusLabel } from "@/components/finance/runway-status";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { DashboardData } from "@/app/app/[orgSlug]/finance/queries";
import { formatCents } from "@/lib/finance/money";
import { formatFinanceDate } from "@/lib/finance/stats";

/**
 * The overview's finance card, for finance roles only (OWNER/TREASURER):
 * the balance and when it runs out, from the same figures as the finance
 * dashboard. Nobody else sees finance on the Overview.
 */
export function FinanceSnapshotCard({
  orgSlug,
  dashboard,
}: {
  orgSlug: string;
  dashboard: DashboardData;
}) {
  const { period, runway } = dashboard;
  return (
    <Link href={`/app/${orgSlug}/finance`}>
      <Card className="hover:bg-accent/50 h-full transition-colors">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <Wallet className="text-muted-foreground size-4" aria-hidden="true" />
            Club balance
          </CardTitle>
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
        </CardHeader>
      </Card>
    </Link>
  );
}
