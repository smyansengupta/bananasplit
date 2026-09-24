import Link from "next/link";

import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getMoneyOwedToUser } from "@/app/app/[orgSlug]/finance/queries";
import { handleAuthErrorInPage } from "@/lib/auth/handle-auth-error";
import { formatCents } from "@/lib/finance/money";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";

export default async function OrgOverviewPage({ params }: PageProps<"/app/[orgSlug]">) {
  const { orgSlug } = await params;
  const { organization: org, user } = await getOrgContextBySlug(orgSlug);

  // One transaction as the member: the counts run one after another on its
  // connection, and RLS bounds each to the org.
  const now = new Date();
  const { openTaskCount, overdueTaskCount, upcomingEventCount, moneyOwedToYouCents } =
    await withOrgTx(org.id, async ({ db }) => ({
      openTaskCount: await db.task.count({
        where: { organizationId: org.id, deletedAt: null, status: { not: "COMPLETED" } },
      }),
      overdueTaskCount: await db.task.count({
        where: {
          organizationId: org.id,
          deletedAt: null,
          status: { not: "COMPLETED" },
          dueDate: { lt: now },
        },
      }),
      upcomingEventCount: await db.event.count({
        where: { organizationId: org.id, deletedAt: null, startsAt: { gte: now } },
      }),
      moneyOwedToYouCents: await getMoneyOwedToUser(db, org.id, user.id),
    })).catch(handleAuthErrorInPage);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="text-muted-foreground text-sm">
          Organization: <span className="font-mono">{orgSlug}</span>
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Link href={`/app/${orgSlug}/tasks`}>
          <Card className="hover:bg-accent/50 transition-colors">
            <CardHeader>
              <CardTitle className="text-sm font-medium">Tasks</CardTitle>
              <CardDescription>
                {openTaskCount} open
                {overdueTaskCount > 0 && (
                  <span className="text-destructive"> · {overdueTaskCount} overdue</span>
                )}
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>
        <Link href={`/app/${orgSlug}/calendar`}>
          <Card className="hover:bg-accent/50 transition-colors">
            <CardHeader>
              <CardTitle className="text-sm font-medium">Upcoming events</CardTitle>
              <CardDescription>
                {upcomingEventCount} upcoming event{upcomingEventCount === 1 ? "" : "s"}
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>
        <Link href={`/app/${orgSlug}/finance/my-reimbursements`}>
          <Card className="hover:bg-accent/50 transition-colors">
            <CardHeader>
              <CardTitle className="text-sm font-medium">Money owed to you</CardTitle>
              <CardDescription>{formatCents(moneyOwedToYouCents)}</CardDescription>
            </CardHeader>
          </Card>
        </Link>
      </div>
    </div>
  );
}
