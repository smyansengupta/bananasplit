import { voteOnQuestionPoll } from "@/app/app/[orgSlug]/calendar/polls/question-actions";
import { Users } from "@/components/icons";
import Link from "next/link";
import { redirect } from "next/navigation";

import { EmptyState } from "@/components/empty-state";
import { PersonalHome } from "@/components/personal/personal-home";
import { CardControls, OpenLink } from "@/components/overview/bits";
import { GettingStarted } from "@/components/overview/getting-started";
import { RsvpGoalBlock } from "@/components/overview/goal-blocks";
import { MyTasksCard, type DueDay } from "@/components/overview/my-tasks-card";
import { OverviewBoard } from "@/components/overview/overview-board";
import { OverviewStats } from "@/components/overview/overview-stats";
import { PinnedGrid } from "@/components/overview/pinned-grid";
import { UpNext } from "@/components/overview/up-next";
import { UpcomingEventsCard } from "@/components/overview/upcoming-events-card";
import { WeeklyPulseCard } from "@/components/overview/weekly-pulse-card";
import {
  FileList,
  NoteList,
  PeopleList,
  PollList,
  RecentList,
} from "@/components/overview/widget-bodies";
import { WeekTimeline, type WeekDay } from "@/components/overview/week-timeline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getUpcomingEvents, getViewerRsvps } from "@/app/app/[orgSlug]/calendar/queries";
import { getRecentNotes } from "@/app/app/[orgSlug]/notes/queries";
import { absoluteAppUrl } from "@/lib/app-url";
import { can } from "@/lib/auth/permissions";
import { spaceIncludes } from "@/lib/billing/space";
import { handleAuthErrorInPage } from "@/lib/auth/handle-auth-error";
import { safeTimeZone } from "@/lib/calendar/dates";
import { timeWord } from "@/lib/overview/format";
import { startedProgress } from "@/lib/overview/getting-started";
import { overviewWidgetsFor, resolveOverview } from "@/lib/overview/widgets";
import { DEFAULT_PULSE_DAY, DEFAULT_PULSE_HOUR } from "@/lib/pulse/settings";
import {
  addDaysToKey,
  dueDateKey,
  effectiveTimezone,
  fromDateKey,
  localDateKey,
  mondayOfKey,
  zonedInstant,
} from "@/lib/tasks/dates";
import { loadSavedBoard } from "@/server/boards";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { listNoteFiles } from "@/server/notes/files";
import { getOrCreateJoinCode } from "@/server/onboarding/join-code";
import {
  loadEventGoing,
  loadOpenForms,
  loadPollStats,
  loadTaskExtras,
  nextRsvpGoalEvent,
  rsvpSeatsTaken,
} from "@/server/overview/queries";
import { buildUpNext } from "@/server/overview/up-next";
import { hideUpNextCard, showHiddenUpNextCards, unhideUpNextCard } from "./up-next-actions";
import { rsvpToEvent } from "./calendar/actions";
import { setTaskStatus } from "./tasks/actions";
import { listPins, listRecent } from "@/server/pins";
import { listOpenPolls } from "@/server/polls/open-polls";
import {
  getPulseIssue,
  latestSentPulse,
  nextPulseLabel,
  weeklyDoneTrend,
} from "@/server/pulse/queries";
import { upcomingPulseSend } from "@/server/pulse/schedule";
import { onlineNow } from "@/server/presence";
import { OnlineNow } from "@/components/overview/online-now";
import { loadPersonalHome } from "@/server/personal/home";
import { getMyOpenTasks, getTaskStats, taskFilterWhere } from "@/server/tasks/queries";

const MY_TASKS_LIMIT = 8;
/** "Next 14 days" in the stat strip. */
const UPCOMING_DAYS = 14;
const EVENTS_LIMIT = 6;
const RECENT_LIMIT = 8;

/** Minutes after midnight for `at`, in `timeZone`. */
function minutesOfDay(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
    timeZone,
  }).formatToParts(at);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return part("hour") * 60 + part("minute");
}

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
 * The Overview (redesign guide 9): each member's own board of widgets,
 * arranged to answer "what needs me?". Always on top, whatever the board:
 * the greeting, the stat strip (due this week, overdue, coming up in two
 * weeks, as on the Personal home), Up next, and for owners and admins
 * "Get your organization started" until every step is done or checked
 * off. Then the member's widgets. Nothing about the organization's money
 * is on it.
 */
export default async function OrgOverviewPage({ params }: PageProps<"/app/[orgSlug]">) {
  const { orgSlug } = await params;
  const { organization: org, user, role, settings } = await getOrgContextBySlug(orgSlug);
  // A Personal space's home is the Personal dashboard, not a club's board.
  if (org.kind === "PERSONAL") {
    return <PersonalHome data={await loadPersonalHome(user.id)} orgSlug={org.slug} />;
  }
  // A club whose plan has no Overview board lands on its events.
  if (!spaceIncludes(org, "overview")) {
    if (!can({ role }, "events.write")) redirect(`/app/${org.slug}/calendar`);
    redirect(`/app/${org.slug}/meetings`);
  }
  const isAdmin = can({ role }, "settings.view");
  const canAddEvents = can({ role }, "events.write");
  const orgZone = safeTimeZone(org.timezone);
  const pulseOn = settings?.pulseEnabled ?? true;
  const pulseDay = settings?.pulseDay ?? DEFAULT_PULSE_DAY;
  const pulseHour = settings?.pulseHourLocal ?? DEFAULT_PULSE_HOUR;

  // One transaction as the member: the reads run one after another on its
  // connection, and RLS bounds each to the org.
  const now = new Date();
  const data = await withOrgTx(org.id, async ({ db }) => {
    const me = await db.user.findUnique({
      where: { id: user.id },
      select: { timezone: true, name: true, image: true, avatar: true },
    });
    const tz = effectiveTimezone(me, org);
    const dayKey = localDateKey(now, tz);
    const today = fromDateKey(dayKey);
    const mine = taskFilterWhere(org.id, { assigneeId: user.id, status: "open" });
    const events = await getUpcomingEvents(db, org.id, now, EVENTS_LIMIT, "events");
    const meetings = await getUpcomingEvents(db, org.id, now, EVENTS_LIMIT, "meetings");
    const weekEvents = await getUpcomingEvents(db, org.id, now, 100);
    const myTasks = await getMyOpenTasks(db, org.id, user.id, { limit: MY_TASKS_LIMIT, today });
    const memberCount = await db.membership.count({ where: { organizationId: org.id } });
    const polls = await loadPollStats(
      db,
      org.id,
      user.id,
      await listOpenPolls(db, org.id, now, 5),
      memberCount,
    );
    // Cards this member hid from their own Up next (own-row RLS).
    const dismissed = await db.upNextDismissal.findMany({
      where: { organizationId: org.id, userId: user.id },
      select: { kind: true, refId: true },
    });
    const upcomingSend = upcomingPulseSend(now, orgZone, pulseDay, pulseHour);
    return {
      timeZone: tz,
      todayKey: dayKey,
      hiddenUpNext: dismissed.map((d) => `${d.kind}:${d.refId}`),
      // Your face for "members online" when you're the only one here.
      you: { id: user.id, name: me?.name ?? null, image: me?.image ?? null, avatar: me?.avatar },
      firstName: me?.name?.trim().split(/\s+/)[0] ?? null,
      myTasks,
      taskExtras: await loadTaskExtras(
        db,
        org.id,
        myTasks.tasks.map((t) => t.id),
      ),
      // Tasks' own stat strip numbers (no filters), for the phone's bar.
      taskBar: await getTaskStats(
        db,
        org.id,
        {},
        {
          today,
          weekEnd: fromDateKey(addDaysToKey(mondayOfKey(dayKey), 6)),
          weekStart: zonedInstant(mondayOfKey(dayKey), 0, tz),
        },
      ),
      stats: {
        // Due today through the sixth day from now: "this week".
        dueSoon: await db.task.count({
          where: {
            AND: [mine, { dueDate: { gte: today, lte: fromDateKey(addDaysToKey(dayKey, 6)) } }],
          },
        }),
        today: await db.task.count({ where: { AND: [mine, { dueDate: today }] } }),
        overdue: await db.task.count({ where: { AND: [mine, { dueDate: { lt: today } }] } }),
      },
      // My open tasks due each of the next seven days, for My tasks' strip.
      dueByDay: await db.task.groupBy({
        by: ["dueDate"],
        where: {
          AND: [mine, { dueDate: { gte: today, lte: fromDateKey(addDaysToKey(dayKey, 6)) } }],
        },
        _count: { _all: true },
      }),
      events,
      meetings,
      weekEvents,
      rsvps: await getViewerRsvps(
        db,
        org.id,
        user.id,
        [...events, ...meetings].map((e) => e.id),
      ),
      going: await loadEventGoing(
        db,
        org.id,
        [...events, ...meetings].map((e) => e.id),
      ),
      pins: await listPins(db, org.id, org.slug, user.id),
      recent: await listRecent(db, org.id, org.slug, user.id, RECENT_LIMIT),
      notes: await getRecentNotes(db, org.id, user.id, 6),
      files: (await listNoteFiles(db, org.id)).slice(0, 6),
      // Questions and find-a-time polls still taking answers, newest first (Up next).
      polls,
      // What the Forms list shows as open: forms, member polls, website polls.
      openForms: await loadOpenForms(db, org.id, user.id, `/app/${org.slug}`, polls, now, 5),
      goal: await nextRsvpGoalEvent(db, org.id, now),
      pulse: await latestSentPulse(db, org.id),
      trend: await weeklyDoneTrend(db, org.id, { timeZone: orgZone, pulseDay, now }),
      draft:
        isAdmin && pulseOn
          ? await getPulseIssue(db, org.id, upcomingSend.weekStart, { drafts: true })
          : null,
      people: await db.membership.findMany({
        where: { organizationId: org.id },
        select: {
          userId: true,
          title: true,
          user: { select: { id: true, name: true, email: true, image: true, avatar: true } },
        },
        orderBy: { joinedAt: "desc" },
        take: 12,
      }),
      memberCount,
      saved: await loadSavedBoard(db, org.id, user.id, "overview"),
      started: isAdmin
        ? {
            picture: org.logo != null,
            members: memberCount > 1,
            event:
              (await db.event.count({ where: { organizationId: org.id, deletedAt: null } })) > 0,
            types: settings?.eventTypes != null,
            teams: (await db.orgChartVersion.count({ where: { organizationId: org.id } })) > 0,
            // Epics and stories are tasks too.
            task: (await db.task.count({ where: { organizationId: org.id, deletedAt: null } })) > 0,
            budget: (await db.budgetPeriod.count({ where: { organizationId: org.id } })) > 0,
            database:
              (await db.databaseDefinition.count({
                where: { organizationId: org.id, kind: "CUSTOM" },
              })) > 0,
          }
        : null,
    };
  }).catch(handleAuthErrorInPage);

  const { timeZone, todayKey } = data;
  const zones = { viewer: timeZone, org: orgZone };
  const base = `/app/${orgSlug}`;
  const calendarHref = `${base}/calendar`;
  const dateLine = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone,
  }).format(now);

  // Seats for the RSVP goal: counted on the service path (the page's own number).
  const goal = data.goal;
  const seats = goal && (!goal.hideCount || isAdmin) ? await rsvpSeatsTaken(org.id, goal.id) : null;

  // "This week": the next seven days in the viewer's timezone, each event
  // placed at its time of day (an event running past midnight stops there).
  const weekdayFmt = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });
  const week: WeekDay[] = Array.from({ length: 7 }, (_, i) => {
    const key = addDaysToKey(todayKey, i);
    const date = new Date(`${key}T00:00:00Z`);
    return {
      key,
      weekday: weekdayFmt.format(date),
      date: String(date.getUTCDate()),
      isToday: i === 0,
      events: data.weekEvents
        .filter((e) => localDateKey(e.startsAt, e.allDay ? orgZone : timeZone) === key)
        .map((e) => {
          const start = e.allDay ? 0 : minutesOfDay(e.startsAt, timeZone);
          const sameDay = localDateKey(e.endsAt, timeZone) === key;
          return {
            id: e.id,
            title: e.title,
            kind: e.kind,
            allDay: e.allDay,
            time: e.allDay ? "All day" : timeWord(e.startsAt, timeZone),
            start,
            end: e.allDay ? 24 * 60 : sameDay ? minutesOfDay(e.endsAt, timeZone) : 24 * 60,
          };
        }),
    };
  });

  // My tasks' strip: what's late, then today and the six days after it.
  const dueCounts = new Map(
    data.dueByDay.flatMap((g) => (g.dueDate ? [[dueDateKey(g.dueDate), g._count._all]] : [])),
  );
  const dueStrip: DueDay[] = [
    { key: "late", label: "Late", count: data.stats.overdue, tone: "late" },
    ...week.map((d, i) => ({
      key: d.key,
      label: i === 0 ? "Today" : d.weekday,
      count: dueCounts.get(d.key) ?? 0,
      tone: (i === 0 ? "today" : "day") as DueDay["tone"],
    })),
  ];

  const upcomingUntil = new Date(now.getTime() + UPCOMING_DAYS * 24 * 60 * 60 * 1000);
  const stats = (
    <OverviewStats
      dueSoon={data.stats.dueSoon}
      dueToday={data.stats.today}
      overdue={data.stats.overdue}
      upcoming={data.weekEvents.filter((e) => e.startsAt < upcomingUntil).length}
      upcomingDays={UPCOMING_DAYS}
      taskBar={data.taskBar}
      tasksHref={`${base}/tasks`}
      calendarHref={calendarHref}
    />
  );

  const eventEmpty = (title: string, cta: string) => (
    <EmptyState
      size="compact"
      title={title}
      action={
        canAddEvents ? (
          <Button asChild size="sm" variant="outline">
            <Link href={calendarHref}>{cta}</Link>
          </Button>
        ) : undefined
      }
    />
  );

  const upNext = buildUpNext({
    orgSlug,
    now,
    todayKey,
    zones,
    tasks: data.myTasks.tasks,
    taskExtras: data.taskExtras,
    meetings: data.meetings,
    events: data.events,
    rsvps: data.rsvps,
    going: data.going,
    polls: data.polls,
    hidden: new Set(data.hiddenUpNext),
  });

  const pulseHref = `${base}/pulse`;
  const sentLabel = data.pulse?.sentAt
    ? `Sent ${new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: orgZone }).format(data.pulse.sentAt)}`
    : null;

  const bodies = {
    pinned: <PinnedGrid orgId={org.id} pins={data.pins} />,
    "my-tasks": (
      <MyTasksCard
        orgId={org.id}
        orgSlug={orgSlug}
        tasks={data.myTasks.tasks}
        extras={data.taskExtras}
        todayKey={todayKey}
        strip={dueStrip}
      />
    ),
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
        empty={eventEmpty("No meetings coming up", "Schedule a meeting")}
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
        empty={eventEmpty("No events coming up", "Add an event")}
      />
    ),
    "rsvp-goal": (
      <RsvpGoalBlock
        event={goal}
        when={
          goal
            ? new Intl.DateTimeFormat("en-US", {
                weekday: "short",
                month: "short",
                day: "numeric",
                timeZone: goal.allDay ? orgZone : timeZone,
              }).format(goal.startsAt)
            : null
        }
        taken={seats}
        href={goal ? `${base}/calendar/${goal.id}` : null}
        createHref={canAddEvents ? `${base}/meetings` : null}
      />
    ),
    week: <WeekTimeline orgSlug={orgSlug} days={week} nowMinutes={minutesOfDay(now, timeZone)} />,
    polls: <PollList orgSlug={orgSlug} forms={data.openForms} now={now} timeZone={timeZone} />,
    "weekly-pulse": (
      <WeeklyPulseCard
        issue={data.pulse}
        trend={data.trend}
        archiveHref={pulseHref}
        issueHref={data.pulse ? `${pulseHref}/${data.pulse.weekStart}` : null}
        nextSend={pulseOn ? nextPulseLabel(now, orgZone, pulseDay, pulseHour) : null}
        draftHref={data.draft && !data.draft.sentAt ? `${pulseHref}/${data.draft.weekStart}` : null}
      />
    ),
    notes: <NoteList orgSlug={orgSlug} notes={data.notes} />,
    files: <FileList orgSlug={orgSlug} files={data.files} />,
    people: <PeopleList orgSlug={orgSlug} people={data.people} total={data.memberCount} />,
  };

  // Shown until every step is done or checked off, then gone by itself.
  const startedSkipped = settings?.startedSkipped ?? [];
  const showStarted =
    data.started !== null && !startedProgress(data.started, startedSkipped).complete;
  // The invite tile copies the join link right there, while members is still to do.
  const joinCode =
    showStarted &&
    !data.started?.members &&
    !startedSkipped.includes("members") &&
    can({ role }, "members.invite")
      ? await withOrgTx(org.id, ({ db }) => getOrCreateJoinCode(db, org.id, user.id))
      : null;
  const started =
    showStarted && data.started ? (
      <GettingStarted
        orgId={org.id}
        orgSlug={orgSlug}
        state={data.started}
        skipped={startedSkipped}
        joinLink={joinCode?.enabled ? absoluteAppUrl(`/join/${joinCode.code}`) : null}
      />
    ) : null;

  const { total, overdue } = data.myTasks;
  const headerActions = {
    "my-tasks": (
      <CardControls
        count={`${total} open`}
        chips={overdue > 0 ? <Badge variant="destructive">{overdue} overdue</Badge> : null}
      >
        <OpenLink
          href={`${base}/tasks?view=list&scope=mine`}
          label={total > data.myTasks.tasks.length ? `View all ${total}` : "View all"}
        />
      </CardControls>
    ),
    polls: (
      <CardControls count={data.openForms.length || undefined}>
        <OpenLink href={`${base}/forms`} label="Forms" />
      </CardControls>
    ),
    "weekly-pulse": (
      <CardControls count={sentLabel ?? undefined}>
        <OpenLink href={pulseHref} label="Pulse" />
      </CardControls>
    ),
    meetings: (
      <CardControls>
        <OpenLink href={calendarHref} label="Calendar" />
      </CardControls>
    ),
    events: (
      <CardControls>
        <OpenLink href={calendarHref} label="Calendar" />
      </CardControls>
    ),
    week: (
      <CardControls>
        <OpenLink href={`${calendarHref}?view=week`} label="Calendar" />
      </CardControls>
    ),
    people: (
      <CardControls count={data.memberCount}>
        <OpenLink href={`${base}/people`} label="People" />
      </CardControls>
    ),
    pinned: <CardControls count={data.pins.length || undefined} />,
    notes: (
      <CardControls>
        <OpenLink href={`${base}/notes`} label="Files" />
      </CardControls>
    ),
    files: (
      <CardControls>
        <OpenLink href={`${base}/notes`} label="Files" />
      </CardControls>
    ),
  };

  // Who's here now, beside the date (the shell's heartbeat keeps it fresh).
  // Its own transaction: if it fails, the line goes and the board stays.
  const online = await withOrgTx(org.id, ({ db }) => onlineNow(db, org.id, user.id)).catch(
    () => null,
  );

  const greetingBlock = (
    <h1 className="page-title">
      {greeting(now, timeZone)}
      {data.firstName ? `, ${data.firstName}` : ""}
    </h1>
  );

  return (
    <div className="space-y-6">
      <OverviewBoard
        orgId={org.id}
        types={overviewWidgetsFor(isAdmin)}
        initialLayout={resolveOverview(data.saved, isAdmin)}
        customized={data.saved !== null}
        bodies={bodies}
        headerActions={headerActions}
        intro={greetingBlock}
        introDescription={
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>{`${dateLine}, ${org.name}`}</span>
            {online && (
              <OnlineNow orgId={org.id} orgSlug={org.slug} you={data.you} initial={online} />
            )}
          </span>
        }
        stats={
          <div className="space-y-[30px]">
            {stats}
            <UpNext
              slots={upNext}
              calendarHref={calendarHref}
              onHide={hideUpNextCard.bind(null, org.id)}
              onUnhide={unhideUpNextCard.bind(null, org.id)}
              onShowAll={showHiddenUpNextCards.bind(null, org.id)}
              onDone={setTaskStatus.bind(null, org.id)}
              onRsvp={rsvpToEvent.bind(null, org.id)}
              onVote={voteOnQuestionPoll.bind(null, org.id)}
              hiddenCount={data.hiddenUpNext.length}
            />
            {started}
          </div>
        }
      />
    </div>
  );
}
