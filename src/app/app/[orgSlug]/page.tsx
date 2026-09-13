import { notFound } from "next/navigation";
import Link from "next/link";

import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { handleAuthErrorInPage } from "@/lib/auth/handle-auth-error";
import { requireOrgMembership } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";

export default async function OrgOverviewPage({ params }: PageProps<"/app/[orgSlug]">) {
  const { orgSlug } = await params;

  const org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
  if (!org) {
    notFound();
  }

  try {
    await requireOrgMembership(org.id);
  } catch (error) {
    handleAuthErrorInPage(error);
  }

  const [openTaskCount, overdueTaskCount, upcomingEventCount] = await Promise.all([
    prisma.task.count({
      where: { organizationId: org.id, deletedAt: null, status: { not: "COMPLETED" } },
    }),
    prisma.task.count({
      where: {
        organizationId: org.id,
        deletedAt: null,
        status: { not: "COMPLETED" },
        dueDate: { lt: new Date() },
      },
    }),
    prisma.event.count({
      where: { organizationId: org.id, deletedAt: null, startsAt: { gte: new Date() } },
    }),
  ]);

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
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Money owed to you</CardTitle>
            <CardDescription>Coming in Phase 5.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    </div>
  );
}
