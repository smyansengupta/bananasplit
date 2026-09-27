import Link from "next/link";

import { FinanceSnapshotCard } from "@/components/overview/finance-snapshot-card";
import { MyTasksCard } from "@/components/overview/my-tasks-card";
import { RecentNotesCard } from "@/components/overview/recent-notes-card";
import { UpcomingEventsCard } from "@/components/overview/upcoming-events-card";
import { SetupPrompt } from "@/components/setup/setup-prompt";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getUpcomingEvents, getViewerRsvps } from "@/app/app/[orgSlug]/calendar/queries";
import { getDashboardData, getMoneyOwedToUser } from "@/app/app/[orgSlug]/finance/queries";
import { getRecentNotes } from "@/app/app/[orgSlug]/notes/queries";
import { can } from "@/lib/auth/permissions";
import { handleAuthErrorInPage } from "@/lib/auth/handle-auth-error";
import { safeTimeZone } from "@/lib/calendar/dates";
import { formatCents } from "@/lib/finance/money";
import { effectiveTimezone, fromDateKey, localDateKey } from "@/lib/tasks/dates";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { loadSetupState } from "@/server/setup/progress";
import { getMyOpenTasks } from "@/server/tasks/queries";

const MY_TASKS_LIMIT = 6;
const EVENTS_LIMIT = 5;
const NOTES_LIMIT = 5;

export default async function OrgOverviewPage({ params }: PageProps<"/app/[orgSlug]">) {
  const { orgSlug } = await params;
  const { organization: org, user, role } = await getOrgContextBySlug(orgSlug);
  // Only owners and admins can act on it, and RLS hides the integration
  // rows from everyone else anyway.
  const canSetUp = can({ role }, "integrations.write");
  // The org's money is for OWNER/TREASURER, as on the finance dashboard.
  const canSeeFinance = can({ role }, "finance.manage");

  // One transaction as the member: the reads run one after another on its
  // connection, and RLS bounds each to the org. Private tasks and other
  // people's private notes are simply not there.
  const now = new Date();
  const {
    timeZone,
    todayKey,
    openTaskCount,
    overdueTaskCount,
    upcomingEventCount,
    myTasks,
    events,
    rsvps,
    notes,
    moneyOwedToYouCents,
    finance,
    setup,
  } = await withOrgTx(org.id, async ({ db }) => {
    const me = await db.user.findUnique({ where: { id: user.id }, select: { timezone: true } });
    const tz = effectiveTimezone(me, org);
    // Due dates are floating calendar days, compared with the viewer's today.
    const dayKey = localDateKey(now, tz);
    const today = fromDateKey(dayKey);
    const upcoming = await getUpcomingEvents(db, org.id, now, EVENTS_LIMIT);
    return {
      timeZone: tz,
      todayKey: dayKey,
      openTaskCount: await db.task.count({
        where: { organizationId: org.id, deletedAt: null, status: { not: "COMPLETED" } },
      }),
      overdueTaskCount: await db.task.count({
        where: {
          organizationId: org.id,
          deletedAt: null,
          status: { not: "COMPLETED" },
          dueDate: { lt: today },
        },
      }),
      upcomingEventCount: await db.event.count({
        where: { organizationId: org.id, deletedAt: null, startsAt: { gte: now } },
      }),
      myTasks: await getMyOpenTasks(db, org.id, user.id, { limit: MY_TASKS_LIMIT, today }),
      events: upcoming,
      rsvps: await getViewerRsvps(
        db,
        org.id,
        user.id,
        upcoming.map((e) => e.id),
      ),
      notes: await getRecentNotes(db, org.id, user.id, NOTES_LIMIT),
      moneyOwedToYouCents: await getMoneyOwedToUser(db, org.id, user.id),
      finance: canSeeFinance ? await getDashboardData(db, org.id, now) : null,
      setup: canSetUp ? await loadSetupState(db, org.id) : null,
    };
  }).catch(handleAuthErrorInPage);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="text-muted-foreground text-sm">
          Organization: <span className="font-mono">{orgSlug}</span>
        </p>
      </div>
      {setup ? <SetupPrompt orgSlug={orgSlug} state={setup} /> : null}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Link href={`/app/${orgSlug}/tasks`}>
          <Card className="hover:bg-accent/50 h-full transition-colors">
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
          <Card className="hover:bg-accent/50 h-full transition-colors">
            <CardHeader>
              <CardTitle className="text-sm font-medium">Upcoming events</CardTitle>
              <CardDescription>
                {upcomingEventCount} upcoming event{upcomingEventCount === 1 ? "" : "s"}
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>
        {finance ? (
          <FinanceSnapshotCard
            orgSlug={orgSlug}
            dashboard={finance}
            moneyOwedToYouCents={moneyOwedToYouCents}
          />
        ) : (
          <Link href={`/app/${orgSlug}/finance/my-reimbursements`}>
            <Card className="hover:bg-accent/50 h-full transition-colors">
              <CardHeader>
                <CardTitle className="text-sm font-medium">Money owed to you</CardTitle>
                <CardDescription>{formatCents(moneyOwedToYouCents)}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        )}
      </div>
      <div className="grid gap-4 lg:grid-cols-5">
        <MyTasksCard
          orgSlug={orgSlug}
          tasks={myTasks.tasks}
          total={myTasks.total}
          overdue={myTasks.overdue}
          todayKey={todayKey}
          className="lg:col-span-3"
        />
        <UpcomingEventsCard
          orgSlug={orgSlug}
          events={events}
          rsvps={rsvps}
          zones={{ viewer: timeZone, org: safeTimeZone(org.timezone) }}
          now={now}
          className="lg:col-span-2"
        />
      </div>
      <RecentNotesCard orgSlug={orgSlug} notes={notes} />
    </div>
  );
}
