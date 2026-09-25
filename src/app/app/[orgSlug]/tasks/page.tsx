import { cookies } from "next/headers";

import { QueryProvider } from "@/components/providers/query-provider";
import { TasksProvider } from "@/components/tasks/tasks-context";
import { WorkspaceProvider } from "@/components/tasks/workspace-context";
import { can } from "@/lib/auth/permissions";
import {
  effectiveTimezone,
  fromDateKey,
  isDateKey,
  localDateKey,
  mondayOfKey,
  weekStartKey,
} from "@/lib/tasks/dates";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { getOrgMembersForPicker } from "@/server/members";
import { buildViewerChart, getChartForPage } from "@/server/tasks/assignment-policy";
import {
  TABLE_PAGE_SIZE,
  countOlderCompleted,
  getAgendaTasks,
  getBoardTasks,
  getCalendarTasks,
  getIntakeTasks,
  getOrgLabels,
  getOrgProjects,
  getTableTasks,
  type TaskFilters,
} from "@/server/tasks/queries";
import { getTeamView } from "@/server/tasks/team";
import {
  canSeeWhoPosted,
  expectedPosters,
  getWeekUpdates,
  getWeeklySummary,
  storedLines,
} from "@/server/tasks/weekly";

import { TaskCalendar } from "./calendar/task-calendar";
import { IntakeView } from "./intake/intake-view";
import { KanbanBoard } from "./kanban/kanban-board";
import { TaskTable } from "./table/task-table";
import { TeamView } from "./team/team-view";
import { UpdatesView, type PostedUpdate } from "./updates/updates-view";
import { WeekView } from "./week/week-view";
import { WorkspaceHeader } from "./workspace-header";
import { parseWorkspaceQuery, TASKS_VIEW_COOKIE, type WorkspaceQuery } from "./views";

const DAY_MS = 24 * 60 * 60 * 1000;

function param(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function dateParam(value: string | undefined): Date | undefined {
  return value && isDateKey(value) ? fromDateKey(value) : undefined;
}

/**
 * The task workspace (C4).
 *
 * One page, one toolbar, five layouts of the same filtered question, plus
 * two destinations (Requests and the Sunday update) that are pieces of work
 * rather than ways of drawing tasks. See ./views.ts for the URL grammar and
 * the reasoning; every link other sections publish still resolves here.
 */
export default async function TasksPage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/tasks">) {
  const { orgSlug } = await params;
  const query = await searchParams;
  const { organization: org, user, role, settings } = await getOrgContextBySlug(orgSlug);

  const cookieStore = await cookies();
  const ws = parseWorkspaceQuery(query, cookieStore.get(TASKS_VIEW_COOKIE)?.value);
  const isAdmin = can({ role }, "tasks.manageAll");
  const now = new Date();

  const members = await getOrgMembersForPicker(org.id);
  const positions = await getChartForPage(org.id);
  const chart = buildViewerChart(positions, user.id);

  const base = await withOrgTx(org.id, async ({ db }) => {
    const me = await db.user.findUnique({ where: { id: user.id }, select: { timezone: true } });
    const labels = await getOrgLabels(db, org.id);
    const projects = await getOrgProjects(db, org.id);
    return { tz: effectiveTimezone(me, org), labels, projects };
  });
  const todayKey = localDateKey(now, base.tz);
  const today = fromDateKey(todayKey);
  const intakeProjects = base.projects.filter((p) => p.isIntake);

  // Header badges: what is waiting in the queue, and whether this person
  // still owes the club a Sunday update.
  const currentWeek = weekStartKey(now, org.timezone);
  const header = await withOrgTx(org.id, async ({ db }) => ({
    intakeCount:
      intakeProjects.length > 0
        ? await db.task.count({
            where: {
              organizationId: org.id,
              deletedAt: null,
              parentTaskId: null,
              projectId: { in: intakeProjects.map((p) => p.id) },
              ownerId: null,
              status: { not: "COMPLETED" },
            },
          })
        : 0,
    posted:
      (await db.weeklyUpdate.count({
        where: {
          organizationId: org.id,
          userId: user.id,
          weekStart: fromDateKey(currentWeek),
          postedAt: { not: null },
        },
      })) > 0,
  }));

  // The scope chip resolves to a set of people; everything else is literal.
  const peopleIds =
    ws.scope === "mine" ? [user.id] : ws.scope === "team" ? [user.id, ...chart.subtree] : undefined;
  const filters: TaskFilters = {
    projectId: ws.projectId,
    status: ws.status,
    ownerId: ws.ownerId,
    assigneeId: ws.assigneeId,
    peopleIds: peopleIds && peopleIds.length > 0 ? peopleIds : undefined,
    labelId: ws.labelId,
    q: ws.q,
    dueFrom: dateParam(ws.dueFrom),
    dueTo: dateParam(ws.dueTo),
    flagged: ws.flagged,
    blockers: ws.blockers,
    visibility: ws.visibility,
  };

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
    intakeProjects,
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
      projects={base.projects}
    >
      <WorkspaceProvider query={ws} hasReports={chart.subtree.length > 0}>
        <WorkspaceHeader
          intakeCount={header.intakeCount}
          showIntake={intakeProjects.length > 0 || isAdmin}
          posted={header.posted}
        />
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
  intakeProjects: Awaited<ReturnType<typeof getOrgProjects>>;
}): Promise<React.ReactNode> {
  const { ws, filters, org, userId, isAdmin, now, today, todayKey, query, members, positions } =
    input;

  switch (ws.view) {
    case "week": {
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
        <WeekView
          open={agenda.open}
          completed={agenda.completed}
          hasMore={agenda.hasMore}
          moreLimit={limit + 100}
        />
      );
    }

    case "table": {
      const page = Math.max(1, Number.parseInt(param(query.page) ?? "1", 10) || 1);
      const { tasks, total } = await withOrgTx(org.id, ({ db }) =>
        getTableTasks(db, org.id, filters, page, today),
      );
      return <TaskTable tasks={tasks} total={total} page={page} pageSize={TABLE_PAGE_SIZE} />;
    }

    case "calendar": {
      const tasks = await withOrgTx(org.id, ({ db }) =>
        getCalendarTasks(db, org.id, filters, today),
      );
      return <TaskCalendar tasks={tasks} />;
    }

    case "team": {
      const data = await withOrgTx(org.id, ({ db }) =>
        getTeamView(db, {
          organizationId: org.id,
          viewerId: userId,
          isAdmin,
          positions,
          members,
          requestedScope: param(query.position) ?? null,
          filters,
          today,
        }),
      );
      return <TeamView data={data} />;
    }

    case "updates": {
      // Weeks are org-time (Monday to Sunday), the same for everyone.
      const currentWeek = weekStartKey(now, org.timezone);
      const requestedWeek = param(query.week);
      const weekStart =
        requestedWeek && isDateKey(requestedWeek) && requestedWeek <= currentWeek
          ? mondayOfKey(requestedWeek)
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
        />
      );
    }

    case "intake": {
      const project =
        input.intakeProjects.find((p) => p.id === ws.projectId) ?? input.intakeProjects[0] ?? null;
      const tasks = project
        ? await withOrgTx(org.id, ({ db }) =>
            getIntakeTasks(db, org.id, project.id, new Date(now.getTime() - 14 * DAY_MS)),
          )
        : [];
      return <IntakeView project={project} intakeProjects={input.intakeProjects} tasks={tasks} />;
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
          />
        </QueryProvider>
      );
    }
  }
}
