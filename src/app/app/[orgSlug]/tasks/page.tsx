import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { QueryProvider } from "@/components/providers/query-provider";
import { TasksProvider } from "@/components/tasks/tasks-context";
import { WorkspaceProvider } from "@/components/tasks/workspace-context";
import { can } from "@/lib/auth/permissions";
import { spaceIncludes } from "@/lib/billing/space";
import { sectionLabel } from "@/lib/nav/sidebar";
import {
  effectiveTimezone,
  fromDateKey,
  isDateKey,
  localDateKey,
  addDaysToKey,
  mondayOfKey,
  zonedInstant,
  updateWeekStartKey,
  updateWeekStartOfKey,
} from "@/lib/tasks/dates";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { getOrgMembersForPicker } from "@/server/members";
import { chartPalette } from "@/server/tasks/catalog";
import { LABEL_COLOR_PALETTE } from "@/lib/label-colors";
import { buildViewerChart, getChartForPage } from "@/server/tasks/assignment-policy";
import { getTaskDashboard } from "@/server/tasks/dashboard";
import {
  TABLE_PAGE_SIZE,
  countOlderCompleted,
  getAgendaTasks,
  getBoardTasks,
  getOrgLabels,
  getOrgParents,
  getEpicsOverview,
  getRoadmapEpics,
  getTableTasks,
  getTaskStats,
  type TaskFilters,
} from "@/server/tasks/queries";
import {
  canSeeWhoPosted,
  expectedPosters,
  getWeekUpdates,
  getWeeklySummary,
  storedLines,
} from "@/server/tasks/weekly";

import { DashboardView } from "./dashboard/dashboard-view";
import { KanbanBoard } from "./kanban/kanban-board";
import { TaskTable } from "./table/task-table";
import { UpdatesView, type PostedUpdate } from "./updates/updates-view";
import { WeeklyUpdateStrip, type WeeklyStatus } from "./updates/weekly-update-strip";
import { WorkspaceHeader } from "./workspace-header";
import { ListView } from "./list/list-view";
import { RoadmapView } from "./roadmap/roadmap-view";
import { EpicsView } from "./epics/epics-view";
import {
  DEFAULT_TASK_LAYOUT,
  isDestination,
  parseScope,
  parseWorkspaceQuery,
  PHONE_HIDDEN_LAYOUTS,
  TASK_LIST_VIEW,
  type WorkspaceQuery,
} from "./views";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Phones, not tablets: iPads and Android tablets leave out "Mobile". */
const PHONE_UA = /iPhone|iPod|Android.+Mobile|Mobile.+Firefox|Windows Phone/;

function param(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function dateParam(value: string | undefined): Date | undefined {
  return value && isDateKey(value) ? fromDateKey(value) : undefined;
}

/**
 * The task workspace (C4).
 *
 * One page, one toolbar, four layouts of the same filtered question (the
 * dashboard counts it), plus the weekly update, a piece of work rather than
 * a way of drawing tasks. See ./views.ts for the URL grammar and
 * the reasoning; every link other sections publish still resolves here.
 */
export default async function TasksPage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/tasks">) {
  const { orgSlug } = await params;
  const query = await searchParams;
  // Tasks' due dates live on the main calendar now (its Tasks layer).
  const { organization: org, user, role, settings } = await getOrgContextBySlug(orgSlug);
  if (query.view === "calendar" && spaceIncludes(org, "taskViews")) {
    redirect(`/app/${orgSlug}/calendar`);
  }

  const parsed = parseWorkspaceQuery(query);
  // The Free plan has the List only: any other ?view= opens the List too,
  // so a typed URL doesn't reach the others.
  const simple = !spaceIncludes(org, "taskViews");
  // The weekly update is work between people: a Personal space has every
  // layout but not the update.
  const teamwork = spaceIncludes(org, "teamwork");
  const isAdmin = can({ role }, "tasks.manageAll");
  const now = new Date();
  // The club's update day (Sunday unless it picked another): weeks end on it.
  const updateDay = settings?.weeklyUpdateDay ?? 0;

  const members = await getOrgMembersForPicker(org.id);
  const positions = await getChartForPage(org.id);
  const chart = buildViewerChart(positions, user.id);

  // A phone has no Board or Table (PHONE_HIDDEN_LAYOUTS), so a remembered
  // Board or a shared ?view=table link opens the List on one, without
  // touching the remembered layout.
  const phone = PHONE_UA.test((await headers()).get("user-agent") ?? "");
  const ws: WorkspaceQuery = simple
    ? { ...parsed, view: TASK_LIST_VIEW, scope: parseScope(query.scope) ?? "all" }
    : !teamwork && isDestination(parsed.view)
      ? { ...parsed, view: phone ? TASK_LIST_VIEW : DEFAULT_TASK_LAYOUT }
      : phone && (PHONE_HIDDEN_LAYOUTS as readonly string[]).includes(parsed.view)
        ? { ...parsed, view: TASK_LIST_VIEW }
        : parsed;

  const base = await withOrgTx(org.id, async ({ db }) => {
    const me = await db.user.findUnique({ where: { id: user.id }, select: { timezone: true } });
    const labels = await getOrgLabels(db, org.id);
    const parents = await getOrgParents(db, org.id);
    return { tz: effectiveTimezone(me, org), labels, parents };
  });
  const todayKey = localDateKey(now, base.tz);
  const today = fromDateKey(todayKey);

  // This week's update (a club's layouts only): whether this person has
  // posted it, for the Week's reminder strip and the dashboard.
  const weekly: WeeklyStatus | null =
    teamwork && !simple
      ? await withOrgTx(org.id, async ({ db }) => {
          const weekStart = updateWeekStartKey(now, org.timezone, updateDay);
          const posted = await db.weeklyUpdate.count({
            where: {
              organizationId: org.id,
              userId: user.id,
              weekStart: fromDateKey(weekStart),
              postedAt: { not: null },
            },
          });
          return { weekStart, dueDay: updateDay, posted: posted > 0, todayKey };
        })
      : null;

  // The scope chip resolves to a set of people; everything else is literal.
  const peopleIds =
    ws.scope === "mine" ? [user.id] : ws.scope === "team" ? [user.id, ...chart.subtree] : undefined;
  const filters: TaskFilters = {
    epicId: ws.epicId,
    status: ws.status,
    ownerId: ws.ownerId,
    assigneeId: ws.assigneeId,
    peopleIds: peopleIds && peopleIds.length > 0 ? peopleIds : undefined,
    labelId: ws.labelId,
    q: ws.q,
    dueFrom: dateParam(ws.dueFrom),
    dueTo: dateParam(ws.dueTo),
    flagged: ws.flagged,
    overdue: ws.overdue,
    blockers: ws.blockers,
    visibility: ws.visibility,
  };

  // The stat strip: the same question, counted (Monday to Sunday is the week).
  const weekStartKey = mondayOfKey(todayKey);
  const stats = simple
    ? null
    : await withOrgTx(org.id, ({ db }) =>
        getTaskStats(db, org.id, filters, {
          today,
          weekEnd: fromDateKey(addDaysToKey(weekStartKey, 6)),
          weekStart: zonedInstant(weekStartKey, 0, base.tz),
        }),
      );

  const content = await renderView({
    ws,
    filters,
    org,
    userId: user.id,
    role,
    isAdmin,
    now,
    today,
    todayKey,
    query,
    members,
    positions,
    updateDay,
    weekly,
  });

  return (
    <TasksProvider
      org={{
        id: org.id,
        slug: org.slug,
        timezone: base.tz,
        todayKey,
        requireOwner: settings?.taskRequireOwner ?? false,
        requireDueDate: settings?.taskRequireDueDate ?? false,
      }}
      viewer={{ userId: user.id, name: user.name, isAdmin, chart }}
      members={members}
      labels={base.labels}
      parents={base.parents}
    >
      <WorkspaceProvider query={ws} hasReports={chart.subtree.length > 0} simple={simple}>
        <WorkspaceHeader
          title={sectionLabel(settings?.sidebar, "tasks")}
          teamwork={teamwork && !simple}
          stats={stats}
        />
        {ws.view === "list" && weekly && <WeeklyUpdateStrip status={weekly} />}
        {content}
      </WorkspaceProvider>
    </TasksProvider>
  );
}

type Query = Record<string, string | string[] | undefined>;

async function renderView(input: {
  ws: WorkspaceQuery;
  filters: TaskFilters;
  org: { id: string; slug: string; timezone: string };
  userId: string;
  role: Parameters<typeof canSeeWhoPosted>[3];
  isAdmin: boolean;
  now: Date;
  today: Date;
  todayKey: string;
  query: Query;
  members: Awaited<ReturnType<typeof getOrgMembersForPicker>>;
  positions: Awaited<ReturnType<typeof getChartForPage>>;
  /** The club's weekly update day, 0 Sunday … 6 Saturday. */
  updateDay: number;
  /** This week's update, in a club (null in Personal and on the Free plan). */
  weekly: WeeklyStatus | null;
}): Promise<React.ReactNode> {
  const { ws, filters, org, userId, now, today, todayKey, query, members } = input;

  switch (ws.view) {
    case "list": {
      const limit = Math.min(
        Math.max(Number.parseInt(param(query.limit) ?? "100", 10) || 100, 20),
        1000,
      );
      const agenda = await withOrgTx(org.id, ({ db }) =>
        getAgendaTasks(db, org.id, filters, {
          completedSince: new Date(now.getTime() - 7 * DAY_MS),
          limit,
          today,
        }),
      );
      return (
        <ListView
          open={agenda.open}
          completed={agenda.completed}
          hasMore={agenda.hasMore}
          moreLimit={limit + 100}
        />
      );
    }

    case "roadmap": {
      // The epics section: where the big pieces are planned and where they
      // stand. The timeline answers "when", the cards under it answer "what"
      // and let you make, rename and close an epic without leaving.
      const [epics, overview] = await Promise.all([
        withOrgTx(org.id, ({ db }) => getRoadmapEpics(db, org.id, filters, today)),
        withOrgTx(org.id, async ({ db }) => ({
          epics: await getEpicsOverview(db, org.id, today),
          palette: await chartPalette(db, org.id),
        })),
      ]);
      const colors = [...new Set([...overview.palette, ...LABEL_COLOR_PALETTE.slice(4)])];
      const dateKey = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
      return (
        <div className="space-y-6">
          <RoadmapView epics={epics} />
          <EpicsView
            embedded
            org={{ id: org.id, slug: org.slug }}
            viewerId={userId}
            todayKey={todayKey}
            members={members}
            colors={colors}
            epics={overview.epics.map((e) => ({
              id: e.id,
              title: e.title,
              description: e.description,
              color: e.color,
              status: e.status,
              ownerId: e.ownerId,
              owner: e.owner,
              startDate: dateKey(e.startDate),
              dueDate: dateKey(e.dueDate),
              stories: e.stories,
              open: e.open,
              done: e.done,
              overdue: e.overdue,
            }))}
          />
        </div>
      );
    }
    case "table": {
      const page = Math.max(1, Number.parseInt(param(query.page) ?? "1", 10) || 1);
      const { tasks, total } = await withOrgTx(org.id, ({ db }) =>
        getTableTasks(db, org.id, filters, page, today),
      );
      return <TaskTable tasks={tasks} total={total} page={page} pageSize={TABLE_PAGE_SIZE} />;
    }

    case "updates": {
      // Weeks are org-time and end on the club's update day, the same for everyone.
      const currentWeek = updateWeekStartKey(now, org.timezone, input.updateDay);
      const requestedWeek = param(query.week);
      const weekStart =
        requestedWeek && isDateKey(requestedWeek) && requestedWeek <= currentWeek
          ? updateWeekStartOfKey(requestedWeek, input.updateDay)
          : currentWeek;
      const requestedPerson = param(query.person);
      const person =
        members.find((m) => m.id === requestedPerson) ?? members.find((m) => m.id === userId);
      const personId = person?.id ?? userId;
      const data = await withOrgTx(org.id, async ({ db }) => {
        const summary = await getWeeklySummary(db, org.id, personId, weekStart, org.timezone, now);
        const updates = await getWeekUpdates(db, org.id, weekStart);
        const seeAll = await canSeeWhoPosted(db, org.id, userId, input.role);
        const expected = seeAll ? await expectedPosters(db, org.id) : [];
        return { summary, updates, seeAll, expected };
      });
      const toPosted = (u: (typeof data.updates)[number]): PostedUpdate => ({
        userId: u.userId,
        postedAt: u.postedAt ? u.postedAt.toISOString() : null,
        note: u.note,
        done: storedLines(u.done),
        next: storedLines(u.next),
        blocked: storedLines(u.blocked),
      });
      const posted = data.updates.find((u) => u.userId === personId);
      return (
        <UpdatesView
          key={`${personId}-${weekStart}`}
          personId={personId}
          personName={person?.name ?? "Member"}
          weekStart={weekStart}
          currentWeekStart={currentWeek}
          summary={data.summary}
          posted={posted ? toPosted(posted) : null}
          expected={data.expected}
          weekUpdates={data.updates.map(toPosted)}
          canSeeWhoPosted={data.seeAll}
          dueDay={input.updateDay}
        />
      );
    }

    case "dashboard": {
      // The same question as the other layouts, counted. Its people rows are
      // whoever the scope or the person filter names, else the whole club.
      const rowsFor =
        filters.peopleIds ??
        ((ws.ownerId ?? ws.assigneeId) ? [ws.ownerId ?? ws.assigneeId!] : undefined);
      const data = await withOrgTx(org.id, async ({ db }) => {
        const dashboard = await getTaskDashboard(db, org.id, {
          filters,
          people: rowsFor,
          todayKey,
          now,
        });
        if (!input.weekly) return { dashboard, updates: [], expected: [] };
        const updates = await getWeekUpdates(db, org.id, input.weekly.weekStart);
        const seeAll = await canSeeWhoPosted(db, org.id, userId, input.role);
        const expected = seeAll ? await expectedPosters(db, org.id) : [];
        return { dashboard, updates, expected };
      });
      return (
        <DashboardView
          data={data.dashboard}
          everyone={!rowsFor}
          weekly={
            input.weekly && {
              ...input.weekly,
              postedBy: data.updates.filter((u) => u.postedAt).map((u) => u.userId),
              // Only for who may see who hasn't posted (canSeeWhoPosted).
              expected: data.expected.map((e) => e.userId),
            }
          }
        />
      );
    }

    default: {
      const showAll = param(query.done) === "all";
      const completedSince = showAll ? null : new Date(now.getTime() - 14 * DAY_MS);
      const { tasks, older } = await withOrgTx(org.id, async ({ db }) => ({
        tasks: await getBoardTasks(db, org.id, filters, { completedSince, today }),
        older: completedSince
          ? await countOlderCompleted(db, org.id, filters, completedSince, today)
          : 0,
      }));
      return (
        <QueryProvider>
          <KanbanBoard
            initialTasks={tasks}
            queryKey={["tasks", org.id, JSON.stringify(filters), showAll]}
            olderCompleted={older}
            showAll={showAll}
            todayKey={todayKey}
            lanes={param(query.lanes) === "epic"}
          />
        </QueryProvider>
      );
    }
  }
}
