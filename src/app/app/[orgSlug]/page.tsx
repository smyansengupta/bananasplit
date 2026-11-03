import { voteOnQuestionPoll } from "@/app/app/[orgSlug]/calendar/polls/question-actions";
import Link from "next/link";
import { redirect } from "next/navigation";

import { EmptyState } from "@/components/empty-state";
import { PersonalHome } from "@/components/personal/personal-home";
import { KIND_META } from "@/components/calendar/kinds";
import { CardControls, OpenLink } from "@/components/overview/bits";
import { Insight, LinkChip, type ItemRef } from "@/components/overview/connections";
import { GettingStarted } from "@/components/overview/getting-started";
import { MyTasksCard } from "@/components/overview/my-tasks-card";
import { OverviewBoard } from "@/components/overview/overview-board";
import { PinnedGrid } from "@/components/overview/pinned-grid";
import { TodayStrip } from "@/components/overview/today-strip";
import { UpNext } from "@/components/overview/up-next";
import {
  EventsList,
  MeetingsList,
  type EventExtras,
} from "@/components/overview/upcoming-events-card";
import { WeeklyPulseCard } from "@/components/overview/weekly-pulse-card";
import { PollList, RecentList } from "@/components/overview/widget-bodies";
import { WeekTimeline, type WeekDay } from "@/components/overview/week-timeline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  getRecentlyEnded,
  getUpcomingEvents,
  getViewerRsvps,
} from "@/app/app/[orgSlug]/calendar/queries";
import { absoluteAppUrl } from "@/lib/app-url";
import { can } from "@/lib/auth/permissions";
import { spaceIncludes } from "@/lib/billing/space";
import { handleAuthErrorInPage } from "@/lib/auth/handle-auth-error";
import { safeTimeZone } from "@/lib/calendar/dates";
import { timeWord } from "@/lib/overview/format";
import {
  agendaItems,
  crowdedEventWeek,
  dayLoad,
  expectedHeadcount,
  myTasksFinding,
  percent,
  pulseFinding,
  weekFinding,
  type DueTask,
  type Finding,
} from "@/lib/overview/insights";
import { startedProgress } from "@/lib/overview/getting-started";
import { todayStrip } from "@/lib/overview/today-strip";
import { overviewWidgetsFor, resolveOverview } from "@/lib/overview/widgets";
import { DEFAULT_PULSE_DAY, DEFAULT_PULSE_HOUR } from "@/lib/pulse/settings";
import {
  addDaysToKey,
  dueDateKey,
  effectiveTimezone,
  fromDateKey,
  localDateKey,
} from "@/lib/tasks/dates";
import { loadHomeMode, loadSavedBoard } from "@/server/boards";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { homeWidgetCards } from "@/components/overview/home-widget-cards";
import { HereNowAlone } from "@/components/overview/here-now";
import { HERE_NOW_RECENT } from "@/server/overview/here-now";
import { loadMainWidgets, loadOwnTxWidgets, readHomeShared } from "@/server/overview/home-widgets";
import { markHomeVisit } from "@/server/overview/since-you-were-here";
import { sidebarCounts } from "@/server/inbox/counts";
import { getOrCreateJoinCode } from "@/server/onboarding/join-code";
import {
  loadEventDetails,
  loadEventGoing,
  loadEventTurnout,
  loadFormResponsesSince,
  loadLastInSeries,
  loadLinkedChips,
  loadOpenForms,
  loadPickUpChanges,
  loadPinStates,
  loadTaskExtras,
  type LinkedChip,
} from "@/server/overview/queries";
import { JUST_ENDED_MS, buildUpNext, type LastMeetingActions } from "@/server/overview/up-next";
import { reportTier } from "@/server/reports/tier";
import { hideUpNextCard, showHiddenUpNextCards, unhideUpNextCard } from "./up-next-actions";
import { rsvpToEvent } from "./calendar/actions";
import { setTaskStatus } from "./tasks/actions";
import { listPins, listRecent } from "@/server/pins";
import {
  getPulseIssue,
  latestSentPulse,
  nextPulseLabel,
  weeklyDoneTrend,
} from "@/server/pulse/queries";
import { upcomingPulseSend } from "@/server/pulse/schedule";
import { websiteSyncConnected } from "@/server/integrations/website-sync";
import { onlineNow } from "@/server/presence";
import { OnlineNow } from "@/components/overview/online-now";
import { loadPersonalHome } from "@/server/personal/home";
import { getMyOpenTasks, taskFilterWhere } from "@/server/tasks/queries";

const MY_TASKS_LIMIT = 8;
/** "Events, next 14 days" in the Today strip. */
const UPCOMING_DAYS = 14;
const EVENTS_LIMIT = 6;
const RECENT_LIMIT = 8;
/** My deadlines read for the week view and the crowded-week warning: this far ahead. */
const DEADLINE_DAYS = 27;
const DAY_MS = 24 * 60 * 60 * 1000;

/** A finding as Home draws it. */
function FindingLine({ finding, after }: { finding: Finding | null; after?: React.ReactNode }) {
  if (!finding) return null;
  return (
    <Insight tone={finding.tone}>
      {finding.lead && <b>{finding.lead}</b>} {finding.text}
      {after && <span className="mt-2 flex flex-wrap gap-1.5">{after}</span>}
    </Insight>
  );
}

/** Chips as Home shows them: what's still open, no more than `max`. */
function chipsOf(list: readonly LinkedChip[] | undefined, max = 3): ItemRef[] {
  return (list ?? [])
    .filter((c) => !c.done)
    .slice(0, max)
    .map(({ kind, label, href }) => ({ kind, label, href }));
}

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

/** The part of the day Home's top light follows (.home-glow in globals.css). */
function timeOfDay(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    hourCycle: "h23",
    weekday: "short",
    timeZone,
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 12);
  const weekday = parts.find((p) => p.type === "weekday")?.value;
  if (weekday === "Sat" || weekday === "Sun") return "weekend";
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 22) return "evening";
  return "night";
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
 * the greeting, the Today strip (overdue, waiting on you, due this week,
 * events in the next two weeks), Up next, and for owners and admins
 * "Get your organization started" until every step is done or checked
 * off. Then the member's widgets. Nothing about the organization's money
 * is on it.
 */
export default async function OrgOverviewPage({ params }: PageProps<"/app/[orgSlug]">) {
  const { orgSlug } = await params;
  const { organization: org, user, role, settings } = await getOrgContextBySlug(orgSlug);
  // A Personal space's home is the Personal dashboard, not an organization's board.
  if (org.kind === "PERSONAL") {
    return <PersonalHome data={await loadPersonalHome(user.id)} orgSlug={org.slug} />;
  }
  // An organization whose plan has no Overview board lands on its events.
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
  // connection, and RLS bounds each to the org. The newer widgets' shared
  // reads and the cheap ones among them run here too
  // (src/server/overview/home-widgets.ts).
  const now = new Date();
  // Website polls (elections) come from the website data sync; without it
  // they're stale leftovers nobody can update or remove, so Home leaves them out.
  const websitePolls = await websiteSyncConnected(org.id, user.id).catch(() => false);
  const data = await withOrgTx(org.id, async ({ db }) => {
    const saved = await loadSavedBoard(db, org.id, user.id, "overview");
    const homeMode = await loadHomeMode(db, org.id, user.id);
    const placed = new Set(resolveOverview(saved, isAdmin, settings?.addOns).map((w) => w.type));
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
    const ended = await getRecentlyEnded(db, org.id, now, JUST_ENDED_MS, 4);
    const myTasks = await getMyOpenTasks(db, org.id, user.id, { limit: MY_TASKS_LIMIT, today });
    // My deadlines up to four weeks out, late ones first: This week's dashed
    // boxes, the crowded-week warning and the Today strip's lines.
    // Deadlines and Focus time read the same list.
    const myDue = await db.task.findMany({
      where: {
        AND: [
          mine,
          { dueDate: { not: null, lte: fromDateKey(addDaysToKey(dayKey, DEADLINE_DAYS)) } },
        ],
      },
      select: { id: true, title: true, dueDate: true, status: true, priority: true },
      orderBy: [{ dueDate: "asc" }, { id: "asc" }],
      take: 60,
    });
    const memberCount = await db.membership.count({ where: { organizationId: org.id } });
    // What's open in Forms and the member polls, read once for every widget.
    const shared = await readHomeShared(db, {
      orgId: org.id,
      userId: user.id,
      now,
      memberCount,
      myDue,
      addOns: settings?.addOns,
      elections: websitePolls,
    });
    const polls = shared.upNextPolls;
    // Cards this member hid from their own Up next (own-row RLS).
    const dismissed = await db.upNextDismissal.findMany({
      where: { organizationId: org.id, userId: user.id },
      select: { kind: true, refId: true },
    });
    const upcomingSend = upcomingPulseSend(now, orgZone, pulseDay, pulseHour);
    const listed = [...events, ...meetings];
    // Going counts for everything on the next seven days, not just the two lists.
    const weekIds = weekEvents
      .filter((e) => e.startsAt.getTime() - now.getTime() <= 7 * DAY_MS)
      .map((e) => e.id);
    const details = await loadEventDetails(
      db,
      org.id,
      listed.map((e) => e.id),
    );
    const lastInSeries = await loadLastInSeries(
      db,
      org.id,
      [...details.values()].flatMap((d) => (d.seriesId ? [d.seriesId] : [])),
      now,
    );
    const openForms = loadOpenForms({
      base: `/app/${org.slug}`,
      forms: shared.forms,
      website: shared.elections,
      polls,
      answered: shared.answered,
      readsResponses: isAdmin,
      limit: 5,
    });
    // Pick up shows the first few; Here now looks at more.
    const recentAll = await listRecent(db, org.id, org.slug, user.id, HERE_NOW_RECENT);
    const recent = recentAll.slice(0, RECENT_LIMIT);
    const pins = await listPins(db, org.id, org.slug, user.id);
    // What every task, meeting, event and form on Home is linked to, in one read.
    const links = await loadLinkedChips(
      db,
      org.id,
      org.slug,
      [
        ...[...new Set([...myTasks.tasks.map((t) => t.id), ...myDue.map((t) => t.id)])].map(
          (id) => ({ kind: "task" as const, id }),
        ),
        ...listed.map((e) => ({ kind: "event" as const, id: e.id })),
        ...[...lastInSeries.values()].map((e) => ({ kind: "event" as const, id: e.id })),
        ...openForms
          .filter((f) => f.kind === "form" || f.kind === "poll")
          .map((f) => ({ kind: "form" as const, id: f.id })),
      ],
      tz,
    );
    const viewer = {
      orgId: org.id,
      orgSlug: org.slug,
      userId: user.id,
      role,
      timeZone: tz,
      orgTimeZone: orgZone,
      now,
      addOns: settings?.addOns,
    };
    const rest = {
      timeZone: tz,
      todayKey: dayKey,
      hiddenUpNext: dismissed.map((d) => `${d.kind}:${d.refId}`),
      // Your face for "members online" when you're the only one here.
      you: { id: user.id, name: me?.name ?? null, image: me?.image ?? null, avatar: me?.avatar },
      firstName: me?.name?.trim().split(/\s+/)[0] ?? null,
      myTasks,
      myDue,
      taskExtras: await loadTaskExtras(
        db,
        org.id,
        myTasks.tasks.map((t) => t.id),
      ),
      // The Today strip's task counts.
      stats: {
        // Due today through the sixth day from now: "this week".
        dueSoon: await db.task.count({
          where: {
            AND: [mine, { dueDate: { gte: today, lte: fromDateKey(addDaysToKey(dayKey, 6)) } }],
          },
        }),
        overdue: await db.task.count({ where: { AND: [mine, { dueDate: { lt: today } }] } }),
      },
      events,
      meetings,
      weekEvents,
      ended,
      details,
      lastInSeries,
      links,
      rsvps: await getViewerRsvps(
        db,
        org.id,
        user.id,
        listed.map((e) => e.id),
      ),
      going: await loadEventGoing(db, org.id, [
        ...new Set([...listed.map((e) => e.id), ...weekIds, ...ended.map((e) => e.id)]),
      ]),
      pins,
      pinStates: await loadPinStates(db, org.id, org.slug, user.id, pins, tz),
      recent,
      pickUp: await loadPickUpChanges(db, org.id, user.id, recent),
      // Questions and find-a-time polls still taking answers, newest first (Up next).
      polls,
      // What the Forms list shows as open: forms, member polls, website polls.
      openForms,
      formsThisWeek: await loadFormResponsesSince(
        db,
        org.id,
        openForms.filter((f) => f.kind === "form" || f.kind === "poll").map((f) => f.id),
        new Date(now.getTime() - 7 * DAY_MS),
      ),
      pulse: await latestSentPulse(db, org.id),
      trend: await weeklyDoneTrend(db, org.id, { timeZone: orgZone, pulseDay, now }),
      draft:
        isAdmin && pulseOn
          ? await getPulseIssue(db, org.id, upcomingSend.weekStart, { drafts: true })
          : null,
      memberCount,
      saved,
      homeMode,
      placed,
      shared,
      viewer,
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
    // Last on this transaction, each caught on its own: the cheap widgets,
    // who's here now (beside the date and in Here now; the shell's
    // heartbeat keeps both fresh), this visit, which becomes the last
    // one (Since you were here counts from the one before; stamped whether
    // or not that widget is placed, so adding it later starts from a real
    // visit), and the Inbox's Needs you for the Today strip, read as the
    // sidebar reads its badge so the two never disagree. If one fails, it
    // goes and the board stays.
    const widgets = await loadMainWidgets(db, placed, viewer, {
      shared,
      upcoming: weekEvents,
      recent: recentAll,
    });
    const online = await onlineNow(db, org.id, user.id).catch(() => null);
    const since = await markHomeVisit(db, org.id, user.id, now).catch(() => null);
    const needsYou = await sidebarCounts(db, {
      orgId: org.id,
      userId: user.id,
      org,
      canReviewFinance:
        can({ role }, "finance.manage") && (settings?.addOns?.includes("finance") ?? true),
      canReviewForms:
        can({ role }, "databases.write") && (settings?.addOns?.includes("forms") ?? true),
      now,
    }).catch(() => null);
    return { ...rest, widgets, online, since, needsYou };
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

  // Sign-ups against the room for the listed events, and each kind's past
  // check-in rate. Its own transaction on the service path (sign-ups hold
  // guests' details; only counts come back): if it fails, the numbers go and
  // the board stays.
  const turnout = await loadEventTurnout(org.id, {
    upcoming: [...data.details.values()].map((d) => ({
      id: d.id,
      rsvpEnabled: d.rsvpEnabled,
      hideCount: d.hideCount,
    })),
    isAdmin,
    tier: reportTier(role) ?? "MEMBER",
    now,
  }).catch(() => ({ seats: new Map<string, number>(), rates: new Map() }));

  const dayKeyOf = (e: { startsAt: Date; allDay: boolean }) =>
    localDateKey(e.startsAt, e.allDay ? orgZone : timeZone);
  const myDue: DueTask[] = data.myDue.flatMap((t) =>
    t.dueDate ? [{ id: t.id, title: t.title, dueKey: dueDateKey(t.dueDate) }] : [],
  );
  const lateTasks = myDue.filter((t) => t.dueKey < todayKey);
  const weekEndKey = addDaysToKey(todayKey, 6);
  const dueThisWeek = myDue.filter((t) => t.dueKey >= todayKey && t.dueKey <= weekEndKey);

  // "This week": the next seven days in the viewer's timezone, each event
  // with its time and who's going, beside the viewer's own deadlines (late
  // ones on today).
  const weekdayFmt = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });
  const weekdayLong = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" });
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const key = addDaysToKey(todayKey, i);
    const date = new Date(`${key}T00:00:00Z`);
    const dayEvents = data.weekEvents.filter((e) => dayKeyOf(e) === key);
    const deadlines = [
      ...(i === 0 ? lateTasks.map((t) => ({ ...t, overdue: true })) : []),
      ...myDue.filter((t) => t.dueKey === key).map((t) => ({ ...t, overdue: false })),
    ].map((t) => ({ id: t.id, title: t.title, href: `${base}/tasks/${t.id}`, overdue: t.overdue }));
    const load = dayLoad(
      key,
      dayEvents.map((e) => {
        const sameDay = localDateKey(e.endsAt, timeZone) === key;
        return {
          id: e.id,
          title: e.title,
          allDay: e.allDay,
          start: e.allDay ? 0 : minutesOfDay(e.startsAt, timeZone),
          end: e.allDay ? 24 * 60 : sameDay ? minutesOfDay(e.endsAt, timeZone) : 24 * 60,
        };
      }),
      deadlines.filter((t) => !t.overdue).length,
    );
    const day: WeekDay = {
      key,
      weekday: weekdayFmt.format(date),
      date: String(date.getUTCDate()),
      isToday: i === 0,
      events: dayEvents.map((e) => ({
        id: e.id,
        title: e.title,
        kind: e.kind,
        allDay: e.allDay,
        time: e.allDay ? "All day" : timeWord(e.startsAt, timeZone).replace(":00", ""),
        going: data.going.get(e.id)?.going ?? 0,
      })),
      deadlines,
      busy: load.clash !== null || load.crowded,
    };
    return { day, load, name: i === 0 ? "Today" : weekdayLong.format(date) };
  });
  const week = weekDays.map((d) => d.day);
  const weekInsight = weekFinding(
    weekDays.map(({ day, load, name }) => ({
      weekday: name,
      load,
      events: day.events,
      deadlines: day.deadlines.filter((t) => !t.overdue),
    })),
  );
  const weekCounts = {
    events: week.reduce((n, d) => n + d.events.length, 0),
    due: dueThisWeek.length,
    free: weekDays.filter((d) => d.load.freeEvening).length,
  };

  // The Today strip: overdue, waiting on you, due this week, events ahead.
  const upcomingUntil = new Date(now.getTime() + UPCOMING_DAYS * DAY_MS);
  const ahead = data.weekEvents.filter((e) => e.startsAt < upcomingUntil);
  const todayBar = (
    <TodayStrip
      cells={todayStrip({
        base,
        todayKey,
        zones,
        overdue: { count: data.stats.overdue, first: lateTasks[0] ?? null },
        waiting: data.needsYou
          ? { count: data.needsYou.inbox, parts: data.needsYou.needsYou }
          : null,
        dueThisWeek: { count: data.stats.dueSoon, titles: dueThisWeek.map((t) => t.title) },
        events: {
          count: ahead.length,
          days: UPCOMING_DAYS,
          next: ahead.find((e) => e.startsAt >= now) ?? ahead[0] ?? null,
        },
      })}
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

  // The action items each upcoming meeting's last one made: its linked tasks.
  const lastActions = new Map<string, LastMeetingActions & { title: string; startsAt: Date }>();
  for (const m of data.meetings) {
    const seriesId = data.details.get(m.id)?.seriesId;
    const last = seriesId ? data.lastInSeries.get(seriesId) : undefined;
    if (!last) continue;
    const tasks = (data.links.get(`event:${last.id}`) ?? []).filter((c) => c.ref.kind === "task");
    if (tasks.length === 0) continue;
    lastActions.set(m.id, {
      open: tasks.filter((c) => !c.done).length,
      total: tasks.length,
      href: `${base}/meetings/${last.id}`,
      title: last.title,
      startsAt: last.startsAt,
    });
  }

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
    ended: data.ended,
    hidden: new Set(data.hiddenUpNext),
    context: { links: data.links, details: data.details, lastActions, seats: turnout.seats },
  });

  // Meetings and Events: what each is tied to, its agenda or its sign-ups.
  const noteChips = (id: string): ItemRef[] =>
    (data.details.get(id)?.notes ?? []).map((n) => ({
      kind: "note",
      label: n.title,
      href: `${base}/notes/${n.id}`,
    }));
  const openTasksChip = (id: string, href: string): ItemRef[] => {
    const open = (data.links.get(`event:${id}`) ?? []).filter(
      (c) => c.ref.kind === "task" && !c.done,
    ).length;
    return open > 0
      ? [{ kind: "task", label: `${open} open ${open === 1 ? "task" : "tasks"}`, href }]
      : [];
  };
  const otherChips = (id: string) =>
    chipsOf(
      (data.links.get(`event:${id}`) ?? []).filter((c) => c.ref.kind !== "task"),
      2,
    );
  const eventExtras = new Map<string, EventExtras>();
  for (const m of data.meetings) {
    const detail = data.details.get(m.id);
    const last = lastActions.get(m.id);
    const items = detail ? agendaItems(detail.description).length : undefined;
    eventExtras.set(m.id, {
      going: data.going.get(m.id)?.going ?? 0,
      faces: data.going.get(m.id)?.faces ?? [],
      ...(items !== undefined ? { agendaItems: items > 0 ? items : null } : {}),
      chips: [
        ...noteChips(m.id),
        ...(last && last.open > 0
          ? [{ kind: "task" as const, label: `${last.open} open actions`, href: last.href }]
          : []),
        ...openTasksChip(m.id, `${base}/meetings/${m.id}`),
        ...otherChips(m.id),
      ].slice(0, 4),
    });
  }
  let eventsInsight: Finding | null = null;
  for (const e of data.events) {
    const detail = data.details.get(e.id);
    const going = data.going.get(e.id);
    const taken = turnout.seats.get(e.id);
    // RSVPs as the rate counts them: the RSVP page's sign-ups, else members going.
    const rsvps = detail?.rsvpEnabled ? taken : (going?.going ?? 0);
    const rate = turnout.rates.get(e.kind);
    const expected = rsvps !== undefined ? expectedHeadcount(rsvps, rate?.rate) : null;
    eventExtras.set(e.id, {
      going: going?.going ?? 0,
      faces: going?.faces ?? [],
      ...(taken !== undefined ? { seats: { taken, capacity: detail?.capacity ?? null } } : {}),
      ...(expected !== null ? { expected } : {}),
      chips: [
        ...noteChips(e.id),
        ...openTasksChip(e.id, `${base}/calendar/${e.id}`),
        ...otherChips(e.id),
      ].slice(0, 4),
    });
    if (!eventsInsight && expected !== null && rate) {
      const kinds = e.kind === "OTHER" ? "Past events like it" : `${KIND_META[e.kind].label}s`;
      eventsInsight = {
        tone: "plain",
        lead: `${kinds} average a ${percent(rate.rate)} check-in rate`,
        text: `over ${rate.events} past events, so ${e.title} should see about ${expected} people.`,
      };
    }
  }
  const meetingNote = data.meetings
    .map((m) => ({ m, last: lastActions.get(m.id) }))
    .find(({ last }) => last && last.total > 0);
  const meetingsInsight = meetingNote?.last ? (
    <FindingLine
      finding={{
        tone: meetingNote.last.open > 0 ? "warn" : "good",
        lead: `The last ${meetingNote.last.title} made ${meetingNote.last.total} action ${meetingNote.last.total === 1 ? "item" : "items"}.`,
        text: `${meetingNote.last.total - meetingNote.last.open} ${meetingNote.last.total - meetingNote.last.open === 1 ? "is" : "are"} done, ${meetingNote.last.open} ${meetingNote.last.open === 1 ? "is" : "are"} still open.`,
      }}
      after={
        <LinkChip
          item={{
            kind: "meeting",
            label: `${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone }).format(meetingNote.last.startsAt)} meeting`,
            href: meetingNote.last.href,
          }}
        />
      }
    />
  ) : null;

  // My tasks: three or more of your deadlines in the week of a big event.
  const crowded = crowdedEventWeek(
    myDue.filter((t) => t.dueKey >= todayKey),
    data.events.map((e) => ({
      id: e.id,
      title: e.title,
      dayKey: dayKeyOf(e),
      size: turnout.seats.get(e.id) ?? data.going.get(e.id)?.going ?? 0,
    })),
  );

  const pulseHref = `${base}/pulse`;
  const sentLabel = data.pulse?.sentAt
    ? `Sent ${new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: orgZone }).format(data.pulse.sentAt)}`
    : null;
  const pulseData = data.pulse?.data ?? null;
  const epics = [...(pulseData?.byProject ?? [])]
    .filter((p) => p.projectId && p.done > 0)
    .sort((a, b) => b.done - a.done);
  const pulseChips: ItemRef[] = [
    ...epics.slice(0, 2).map((p) => ({
      kind: "task" as const,
      label: p.name,
      href: `${base}/tasks/${p.projectId}`,
    })),
    ...(pulseData?.events ?? []).slice(0, 2).map((e) => ({
      kind: "event" as const,
      label: e.title,
      href: `${calendarHref}/${e.eventId}`,
    })),
  ];
  const pulseInsight = pulseFinding(
    data.trend.slice(0, -1),
    epics[0] ? { name: epics[0].name, done: epics[0].done } : null,
  );

  const { online, since, placed } = data;
  // The rest of the newer widgets, each in its own transaction.
  const ownTx = await loadOwnTxWidgets(placed, data.viewer, {
    shared: data.shared,
    since,
    upcoming: data.weekEvents,
    todayKey,
    ballotVisibility: settings?.ballotIndividualVisibility,
  });
  const newer = homeWidgetCards({
    orgId: org.id,
    orgSlug,
    viewer: { userId: user.id, role },
    you: data.you,
    online,
    placed,
    data: { ...data.widgets, ...ownTx },
  });

  // Ambient: widgets with nothing to show rest (their band neighbours take
  // the space), and Here now with only you in needs one column. A widget
  // whose read failed isn't resting: it says so in its card.
  const w = { ...data.widgets, ...ownTx };
  const resting = [
    ...(w.since && w.since.rows.length === 0 ? ["since-you-were-here"] : []),
    ...(w.votes && w.votes.total === 0 ? ["votes"] : []),
    ...(w.deadlines && w.deadlines.total === 0 ? ["deadlines"] : []),
    ...(w.waitingOnYou && w.waitingOnYou.rows.length === 0 ? ["waiting-on-you"] : []),
    ...(w.waitingOnOthers && w.waitingOnOthers.rows.length === 0 ? ["waiting-on-others"] : []),
    ...(data.openForms.length === 0 ? ["polls"] : []),
    ...(data.meetings.length === 0 ? ["meetings"] : []),
    ...(data.events.length === 0 ? ["events"] : []),
    ...(data.recent.length === 0 ? ["recent"] : []),
  ];
  const alone = online !== null && online.count <= 1;
  const compact = alone ? ["here-now"] : [];

  // Open forms' chips, by form id.
  const formLinks = new Map(
    data.openForms.map((f) => [f.id, chipsOf(data.links.get(`form:${f.id}`), 2)]),
  );

  const bodies: Record<string, React.ReactNode> = {
    pinned: <PinnedGrid orgId={org.id} pins={data.pins} live={data.pinStates} />,
    "my-tasks": (
      <MyTasksCard
        orgId={org.id}
        orgSlug={orgSlug}
        tasks={data.myTasks.tasks}
        extras={data.taskExtras}
        todayKey={todayKey}
        links={data.links}
        insight={<FindingLine finding={myTasksFinding(crowded)} />}
      />
    ),
    recent: <RecentList items={data.recent} changes={data.pickUp} now={now} />,
    meetings: (
      <MeetingsList
        orgSlug={orgSlug}
        meetings={data.meetings}
        extras={eventExtras}
        rsvps={data.rsvps}
        zones={zones}
        now={now}
        canEdit={canAddEvents}
        empty={eventEmpty("No meetings coming up", "Schedule a meeting")}
        insight={meetingsInsight}
      />
    ),
    events: (
      <EventsList
        orgSlug={orgSlug}
        events={data.events}
        extras={eventExtras}
        rsvps={data.rsvps}
        zones={zones}
        now={now}
        empty={eventEmpty("No events coming up", "Add an event")}
        insight={<FindingLine finding={eventsInsight} />}
      />
    ),
    week: (
      <WeekTimeline orgSlug={orgSlug} days={week} insight={<FindingLine finding={weekInsight} />} />
    ),
    polls: (
      <PollList
        orgSlug={orgSlug}
        forms={data.openForms}
        now={now}
        timeZone={timeZone}
        fresh={data.formsThisWeek}
        links={formLinks}
      />
    ),
    "weekly-pulse": (
      <WeeklyPulseCard
        issue={data.pulse}
        trend={data.trend}
        archiveHref={pulseHref}
        issueHref={data.pulse ? `${pulseHref}/${data.pulse.weekStart}` : null}
        nextSend={pulseOn ? nextPulseLabel(now, orgZone, pulseDay, pulseHour) : null}
        draftHref={data.draft && !data.draft.sentAt ? `${pulseHref}/${data.draft.weekStart}` : null}
        insight={<FindingLine finding={pulseInsight} />}
        chips={pulseChips}
      />
    ),
    ...newer.bodies,
    ...(alone && data.homeMode === "ambient"
      ? {
          "here-now": (
            <HereNowAlone orgId={org.id} orgSlug={orgSlug} you={data.you} initial={online} />
          ),
        }
      : {}),
  };

  // Shown until every step is done or checked off, then gone by itself.
  // Without Finance added there's no budget to set up: that step counts as not needed.
  const startedSkipped = [
    ...(settings?.startedSkipped ?? []),
    ...(settings?.addOns && !settings.addOns.includes("finance") ? ["budget"] : []),
  ];
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
      <CardControls count={data.meetings.length || undefined}>
        <OpenLink href={`${base}/meetings`} label="Meetings" />
      </CardControls>
    ),
    events: (
      <CardControls count={data.events.length || undefined}>
        <OpenLink href={calendarHref} label="Calendar" />
      </CardControls>
    ),
    week: (
      <CardControls
        chips={
          <span className="text-muted-foreground text-[13px] max-sm:hidden">
            {[
              `${weekCounts.events} ${weekCounts.events === 1 ? "event" : "events"}`,
              `${weekCounts.due} ${weekCounts.due === 1 ? "task" : "tasks"} due`,
              `${weekCounts.free} free ${weekCounts.free === 1 ? "evening" : "evenings"}`,
            ].join(", ")}
          </span>
        }
      >
        <OpenLink href={`${calendarHref}?view=week`} label="Calendar" />
      </CardControls>
    ),
    pinned: <CardControls count={data.pins.length || undefined} />,
    ...newer.headers,
    // A one-column Here now has room for its title only.
    ...(alone && data.homeMode === "ambient" ? { "here-now": null } : {}),
  };

  const greetingBlock = (
    <h1 className="page-title">
      {greeting(now, timeZone)}
      {data.firstName ? `, ${data.firstName}` : ""}
    </h1>
  );

  return (
    <div className="relative isolate space-y-6">
      <div aria-hidden="true" className="home-glow" data-time={timeOfDay(now, timeZone)} />
      <OverviewBoard
        orgId={org.id}
        types={overviewWidgetsFor(isAdmin, settings?.addOns)}
        initialLayout={resolveOverview(data.saved, isAdmin, settings?.addOns)}
        customized={data.saved !== null}
        mode={data.homeMode}
        resting={resting}
        compact={compact}
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
            {todayBar}
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
