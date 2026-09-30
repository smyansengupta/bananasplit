import Link from "next/link";

import { CalendarDays, CheckSquare, Users } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { FinanceSnapshotCard } from "@/components/overview/finance-snapshot-card";
import { MyTasksCard } from "@/components/overview/my-tasks-card";
import { PinnedCard, RecentlyVisitedCard } from "@/components/overview/pinned-card";
import { UpcomingEventsCard } from "@/components/overview/upcoming-events-card";
import { JoinCodeCard } from "@/components/onboarding/join-code-card";
import { SetupPrompt } from "@/components/setup/setup-prompt";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getUpcomingEvents, getViewerRsvps } from "@/app/app/[orgSlug]/calendar/queries";
import { getDashboardData } from "@/app/app/[orgSlug]/finance/queries";
import { absoluteAppUrl } from "@/lib/app-url";
import { can } from "@/lib/auth/permissions";
import { handleAuthErrorInPage } from "@/lib/auth/handle-auth-error";
import { safeTimeZone } from "@/lib/calendar/dates";
import { effectiveTimezone, fromDateKey, localDateKey } from "@/lib/tasks/dates";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { getOrCreateJoinCode } from "@/server/onboarding/join-code";
import { listPins, listRecent } from "@/server/pins";
import { loadSetupState } from "@/server/setup/progress";
import { getMyOpenTasks } from "@/server/tasks/queries";

const MY_TASKS_LIMIT = 6;
const EVENTS_LIMIT = 5;
const RECENT_LIMIT = 8;

function greeting(now: Date, timeZone: string): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone }).format(now),
  );
  if (hour < 5) return "Working late";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/**
 * The Overview: what matters to every member (their tasks, meetings, what's
 * coming up, pins and recent pages). Finance shows only to finance roles;
 * the setup checklist only to admins.
 */
export default async function OrgOverviewPage({ params, searchParams }: PageProps<"/app/[orgSlug]">) {
  const { orgSlug } = await params;
  // ?welcome=1: the end of org setup. The admin's first look at their org
  // shows the invite code and link to share (the flowchart's END).
  const welcome = (await searchParams).welcome === "1";
  const { organization: org, user, role } = await getOrgContextBySlug(orgSlug);
  // Only owners and admins can act on it, and RLS hides the integration
  // rows from everyone else anyway.
  const canSetUp = can({ role }, "integrations.write");
  // The org's money is for OWNER/TREASURER, as on the finance dashboard.
  const canSeeFinance = can({ role }, "finance.manage");
  const canAddEvents = can({ role }, "events.write");

  // One transaction as the member: the reads run one after another on its
  // connection, and RLS bounds each to the org. Private tasks and other
  // people's private notes are simply not there.
  const now = new Date();
  const {
    timeZone,
    todayKey,
    firstName,
    myTasks,
    events,
    meetings,
    rsvps,
    pins,
    recent,
    finance,
    setup,
    joinCode,
  } = await withOrgTx(org.id, async ({ db }) => {
    const me = await db.user.findUnique({
      where: { id: user.id },
      select: { timezone: true, name: true },
    });
    const tz = effectiveTimezone(me, org);
    // Due dates are floating calendar days, compared with the viewer's today.
    const dayKey = localDateKey(now, tz);
    const today = fromDateKey(dayKey);
    const events = await getUpcomingEvents(db, org.id, now, EVENTS_LIMIT, "events");
    const meetings = await getUpcomingEvents(db, org.id, now, EVENTS_LIMIT, "meetings");
    return {
      timeZone: tz,
      todayKey: dayKey,
      firstName: me?.name?.trim().split(/\s+/)[0] ?? null,
      myTasks: await getMyOpenTasks(db, org.id, user.id, { limit: MY_TASKS_LIMIT, today }),
      events,
      meetings,
      rsvps: await getViewerRsvps(
        db,
        org.id,
        user.id,
        [...events, ...meetings].map((e) => e.id),
      ),
      pins: await listPins(db, org.id, org.slug, user.id),
      recent: await listRecent(db, org.id, org.slug, user.id, RECENT_LIMIT),
      finance: canSeeFinance ? await getDashboardData(db, org.id, now) : null,
      setup: canSetUp ? await loadSetupState(db, org.id) : null,
      joinCode:
        welcome && can({ role }, "members.invite")
          ? await getOrCreateJoinCode(db, org.id, user.id)
          : null,
    };
  }).catch(handleAuthErrorInPage);

  const zones = { viewer: timeZone, org: safeTimeZone(org.timezone) };
  const dateLine = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone,
  }).format(now);
  const calendarHref = `/app/${orgSlug}/calendar`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-muted-foreground text-sm">{dateLine}</p>
          <h1 className="text-2xl font-semibold tracking-tight">
            {greeting(now, timeZone)}
            {firstName ? `, ${firstName}` : ""}
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/app/${orgSlug}/tasks`}>
              <CheckSquare className="size-4" aria-hidden="true" />
              Tasks
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={calendarHref}>
              <CalendarDays className="size-4" aria-hidden="true" />
              Calendar
            </Link>
          </Button>
        </div>
      </div>
      {joinCode && (
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader className="space-y-3">
            <div>
              <CardTitle>{org.name} is ready</CardTitle>
              <CardDescription>
                Invite your members: share this code or link. They set up their profile, enter it,
                and see {org.name} before they join. Manage it any time in{" "}
                <Link
                  href={`/app/${orgSlug}/settings/members`}
                  className="underline underline-offset-4"
                >
                  Settings › Members
                </Link>
                .
              </CardDescription>
            </div>
            <JoinCodeCard
              orgId={org.id}
              compact
              joinUrlBase={absoluteAppUrl("/onboarding/join")}
              initial={{
                code: joinCode.code,
                enabled: joinCode.enabled,
                allowedDomain: joinCode.allowedDomain,
                useCount: joinCode.useCount,
              }}
            />
          </CardHeader>
        </Card>
      )}
      {setup ? <SetupPrompt orgSlug={orgSlug} state={setup} /> : null}

      <PinnedCard pins={pins} />

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
          title="Meetings"
          icon={Users}
          events={meetings}
          rsvps={rsvps}
          zones={zones}
          now={now}
          className="lg:col-span-2"
          empty={
            <EmptyState
              size="compact"
              icon={Users}
              title="No meetings coming up"
              description="Team and board meetings on the calendar show here."
              action={
                canAddEvents ? (
                  <Button asChild size="sm" variant="outline">
                    <Link href={calendarHref}>Schedule a meeting</Link>
                  </Button>
                ) : undefined
              }
            />
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <UpcomingEventsCard
          orgSlug={orgSlug}
          title="Events"
          icon={CalendarDays}
          events={events}
          rsvps={rsvps}
          zones={zones}
          now={now}
          className="lg:col-span-3"
          empty={
            <EmptyState
              size="compact"
              icon={CalendarDays}
              title="No events coming up"
              description="Socials, workshops and everything else on the calendar show here."
              action={
                canAddEvents ? (
                  <Button asChild size="sm" variant="outline">
                    <Link href={calendarHref}>Add an event</Link>
                  </Button>
                ) : undefined
              }
            />
          }
        />
        <RecentlyVisitedCard items={recent} now={now} className="lg:col-span-2" />
      </div>

      {finance && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <FinanceSnapshotCard orgSlug={orgSlug} dashboard={finance} />
        </div>
      )}
    </div>
  );
}
