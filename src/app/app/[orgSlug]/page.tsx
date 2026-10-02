import { CalendarDays, CheckSquare, Users } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { JoinCodeCard } from "@/components/onboarding/join-code-card";
import { GettingStartedCard } from "@/components/overview/getting-started-card";
import { MyTasksCard } from "@/components/overview/my-tasks-card";
import { OverviewBoard } from "@/components/overview/overview-board";
import { PinnedGrid } from "@/components/overview/pinned-grid";
import { UpcomingEventsCard } from "@/components/overview/upcoming-events-card";
import {
  FileList,
  NoteList,
  PeopleList,
  PollList,
  RecentList,
  Shortcuts,
  TaskStats,
  WeekStrip,
  type WeekDay,
} from "@/components/overview/widget-bodies";
import { SetupPrompt } from "@/components/setup/setup-prompt";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getUpcomingEvents, getViewerRsvps } from "@/app/app/[orgSlug]/calendar/queries";
import { getRecentNotes } from "@/app/app/[orgSlug]/notes/queries";
import { absoluteAppUrl } from "@/lib/app-url";
import { can } from "@/lib/auth/permissions";
import { handleAuthErrorInPage } from "@/lib/auth/handle-auth-error";
import { safeTimeZone } from "@/lib/calendar/dates";
import { visibleSidebar } from "@/lib/nav/sidebar";
import { overviewWidgetsFor, resolveOverview } from "@/lib/overview/widgets";
import { addDaysToKey, effectiveTimezone, fromDateKey, localDateKey } from "@/lib/tasks/dates";
import { loadSavedBoard } from "@/server/boards";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { listNoteFiles } from "@/server/notes/files";
import { getOrCreateJoinCode } from "@/server/onboarding/join-code";
import { listPins, listRecent } from "@/server/pins";
import { listOpenPolls } from "@/server/polls/open-polls";
import { loadSetupState } from "@/server/setup/progress";
import { getMyOpenTasks, taskFilterWhere } from "@/server/tasks/queries";

const MY_TASKS_LIMIT = 8;
const EVENTS_LIMIT = 6;
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
 * The Overview: each member's own board of widgets (their tasks, meetings,
 * events, pins, recent pages, notes, files, people...). Nothing about the
 * club's money is on it. The setup checklist is an admin-only widget.
 */
export default async function OrgOverviewPage({ params, searchParams }: PageProps<"/app/[orgSlug]">) {
  const { orgSlug } = await params;
  // ?welcome=1: the end of org setup. The admin's first look at their org
  // shows the invite code and link to share (the flowchart's END).
  const welcome = (await searchParams).welcome === "1";
  const { organization: org, user, role, settings } = await getOrgContextBySlug(orgSlug);
  const canSetUp = can({ role }, "integrations.write");
  const isAdmin = can({ role }, "settings.view");
  const canAddEvents = can({ role }, "events.write");

  // One transaction as the member: the reads run one after another on its
  // connection, and RLS bounds each to the org.
  const now = new Date();
  const data = await withOrgTx(org.id, async ({ db }) => {
    const me = await db.user.findUnique({
      where: { id: user.id },
      select: { timezone: true, name: true },
    });
    const tz = effectiveTimezone(me, org);
    const dayKey = localDateKey(now, tz);
    const today = fromDateKey(dayKey);
    const mine = taskFilterWhere(org.id, { assigneeId: user.id, status: "open" });
    const events = await getUpcomingEvents(db, org.id, now, EVENTS_LIMIT, "events");
    const meetings = await getUpcomingEvents(db, org.id, now, EVENTS_LIMIT, "meetings");
    const weekEvents = await getUpcomingEvents(db, org.id, now, 60);
    return {
      timeZone: tz,
      todayKey: dayKey,
      firstName: me?.name?.trim().split(/\s+/)[0] ?? null,
      myTasks: await getMyOpenTasks(db, org.id, user.id, { limit: MY_TASKS_LIMIT, today }),
      stats: {
        open: await db.task.count({ where: mine }),
        today: await db.task.count({ where: { AND: [mine, { dueDate: today }] } }),
        overdue: await db.task.count({ where: { AND: [mine, { dueDate: { lt: today } }] } }),
        blocked: await db.task.count({ where: { AND: [mine, { status: "BLOCKED" }] } }),
      },
      events,
      meetings,
      weekEvents,
      rsvps: await getViewerRsvps(
        db,
        org.id,
        user.id,
        [...events, ...meetings].map((e) => e.id),
      ),
      pins: await listPins(db, org.id, org.slug, user.id),
      recent: await listRecent(db, org.id, org.slug, user.id, RECENT_LIMIT),
      notes: await getRecentNotes(db, org.id, user.id, 6),
      files: (await listNoteFiles(db, org.id)).slice(0, 6),
      // Questions and find-a-time polls still taking answers, newest first.
      polls: await listOpenPolls(db, org.id, now, 5),
      people: await db.membership.findMany({
        where: { organizationId: org.id },
        select: {
          userId: true,
          title: true,
          user: { select: { id: true, name: true, email: true, image: true, avatar: true } },
        },
        orderBy: { joinedAt: "desc" },
        take: 6,
      }),
      memberCount: await db.membership.count({ where: { organizationId: org.id } }),
      saved: await loadSavedBoard(db, org.id, user.id, "overview"),
      setup: canSetUp ? await loadSetupState(db, org.id) : null,
      joinCode:
        welcome && can({ role }, "members.invite")
          ? await getOrCreateJoinCode(db, org.id, user.id)
          : null,
      started: isAdmin
        ? {
            members: (await db.membership.count({ where: { organizationId: org.id } })) > 1,
            picture: org.logo != null,
            event: (await db.event.count({ where: { organizationId: org.id, deletedAt: null } })) > 0,
            task: (await db.task.count({ where: { organizationId: org.id, deletedAt: null } })) > 0,
            budget: (await db.budgetPeriod.count({ where: { organizationId: org.id } })) > 0,
            note: (await db.note.count({ where: { organizationId: org.id, deletedAt: null } })) > 0,
          }
        : null,
    };
  }).catch(handleAuthErrorInPage);

  const { timeZone, todayKey } = data;
  const zones = { viewer: timeZone, org: safeTimeZone(org.timezone) };
  const dateLine = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone,
  }).format(now);
  const calendarHref = `/app/${orgSlug}/calendar`;

  // "This week": the next seven days in the viewer's timezone.
  const dayFmt = new Intl.DateTimeFormat("en-US", { weekday: "short", day: "numeric", timeZone: "UTC" });
  const timeFmt = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone });
  const week: WeekDay[] = Array.from({ length: 7 }, (_, i) => {
    const key = addDaysToKey(todayKey, i);
    return {
      key,
      label: i === 0 ? "Today" : dayFmt.format(new Date(`${key}T00:00:00Z`)),
      isToday: i === 0,
      events: data.weekEvents
        .filter((e) => localDateKey(e.startsAt, timeZone) === key)
        .map((e) => ({ id: e.id, title: e.title, time: e.allDay ? "All day" : timeFmt.format(e.startsAt) })),
    };
  });

  const shortcuts = visibleSidebar(settings?.sidebar)
    .flatMap((g) => g.items)
    .filter((i) => i.id !== "overview")
    .map((i) => ({ id: i.id, label: i.label, href: `/app/${orgSlug}${i.path}` }));

  const eventEmpty = (title: string, description: string, cta: string) => (
    <EmptyState
      size="compact"
      icon={CalendarDays}
      title={title}
      description={description}
      action={
        canAddEvents ? (
          <Button asChild size="sm" variant="outline">
            <Link href={calendarHref}>{cta}</Link>
          </Button>
        ) : undefined
      }
    />
  );

  const bodies = {
    pinned: <PinnedGrid orgId={org.id} pins={data.pins} />,
    "my-tasks": (
      <MyTasksCard
        bare
        orgSlug={orgSlug}
        tasks={data.myTasks.tasks}
        total={data.myTasks.total}
        overdue={data.myTasks.overdue}
        todayKey={todayKey}
      />
    ),
    "task-stats": <TaskStats orgSlug={orgSlug} stats={data.stats} />,
    recent: <RecentList items={data.recent} now={now} />,
    meetings: (
      <UpcomingEventsCard
        bare
        orgSlug={orgSlug}
        icon={Users}
        events={data.meetings}
        rsvps={data.rsvps}
        zones={zones}
        now={now}
        empty={eventEmpty("No meetings coming up", "Team and board meetings on the calendar show here.", "Schedule a meeting")}
      />
    ),
    events: (
      <UpcomingEventsCard
        bare
        orgSlug={orgSlug}
        events={data.events}
        rsvps={data.rsvps}
        zones={zones}
        now={now}
        empty={eventEmpty("No events coming up", "Socials, workshops and everything else show here.", "Add an event")}
      />
    ),
    week: <WeekStrip orgSlug={orgSlug} days={week} />,
    polls: <PollList orgSlug={orgSlug} polls={data.polls} now={now} />,
    notes: <NoteList orgSlug={orgSlug} notes={data.notes} />,
    files: <FileList orgSlug={orgSlug} files={data.files} />,
    people: <PeopleList orgSlug={orgSlug} people={data.people} total={data.memberCount} />,
    shortcuts: <Shortcuts links={shortcuts} />,
    ...(data.started ? { "getting-started": <GettingStartedCard bare orgSlug={orgSlug} state={data.started} /> } : {}),
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow text-muted-foreground mb-2">{dateLine}</p>
          <h1 className="page-title">
            {greeting(now, timeZone)}
            {data.firstName ? `, ${data.firstName}` : ""}
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
      {data.joinCode && (
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader className="space-y-3">
            <div>
              <CardTitle>{org.name} is ready</CardTitle>
              <CardDescription>
                Invite your members: share this code or link. They set up their profile, enter it,
                and see {org.name} before they join. Manage it any time in{" "}
                <Link href={`/app/${orgSlug}/settings/members`} className="underline underline-offset-4">
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
                code: data.joinCode.code,
                enabled: data.joinCode.enabled,
                allowedDomain: data.joinCode.allowedDomain,
                useCount: data.joinCode.useCount,
              }}
            />
          </CardHeader>
        </Card>
      )}
      {data.setup ? <SetupPrompt orgSlug={orgSlug} state={data.setup} /> : null}

      <OverviewBoard
        orgId={org.id}
        types={overviewWidgetsFor(isAdmin)}
        initialLayout={resolveOverview(data.saved, isAdmin)}
        customized={data.saved !== null}
        bodies={bodies}
      />
    </div>
  );
}
