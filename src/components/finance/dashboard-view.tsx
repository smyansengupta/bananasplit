import { AlertTriangle } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { DashboardData } from "@/app/app/[orgSlug]/finance/queries";
import { formatCents } from "@/lib/finance/money";

import { BurnChart } from "./burn-chart";

export function DashboardView({
  data,
  orgSlug,
  moneyOwedToYouCents,
}: {
  data: DashboardData;
  orgSlug: string;
  moneyOwedToYouCents: number;
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
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Balance</CardTitle>
            <CardDescription className="text-foreground text-2xl font-semibold">
              {formatCents(data.balanceCents)}
            </CardDescription>
            <CardDescription>{data.period.label}</CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Allocated</CardTitle>
            <CardDescription className="text-foreground text-2xl font-semibold">
              {formatCents(data.totalAllocatedCents)}
            </CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Owed to members</CardTitle>
            <CardDescription className="text-foreground text-2xl font-semibold">
              {formatCents(data.outstandingReimbursementsCents)}
            </CardDescription>
          </CardHeader>
        </Card>
        <Link href={`/app/${orgSlug}/finance/my-reimbursements`}>
          <Card className="hover:bg-accent/50 h-full transition-colors">
            <CardHeader>
              <CardTitle className="text-sm font-medium">Owed to you</CardTitle>
              <CardDescription className="text-foreground text-2xl font-semibold">
                {formatCents(moneyOwedToYouCents)}
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>
      </div>

      {data.unreconciledOver60DaysCount > 0 && (
        <div className="border-destructive/30 bg-destructive/10 text-destructive flex items-center gap-2 rounded-md border p-3 text-sm">
          <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
          {data.unreconciledOver60DaysCount} transaction(s) are unreconciled and over 60 days old.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
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
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Burn by month</CardTitle>
        </CardHeader>
        <CardContent>
          <BurnChart data={data.burnByMonth} />
        </CardContent>
      </Card>
    </div>
  );
}
