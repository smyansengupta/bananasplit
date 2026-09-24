import { cookies } from "next/headers";

import { QueryProvider } from "@/components/providers/query-provider";
import { TasksProvider } from "@/components/tasks/tasks-context";
import { TaskStatus } from "@/generated/prisma/client";
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
  getBoardTasks,
  getCalendarTasks,
  getIntakeTasks,
  getMyTasks,
  getOrgLabels,
  getOrgProjects,
  getTableTasks,
  type TableFilters,
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
import { MyTasksView } from "./my-tasks/my-tasks-view";
import { NewTaskButton, ProjectSelect } from "./project-select";
import { TaskTable } from "./table/task-table";
import { TaskTableFilters } from "./table/task-table-filters";
import { TeamView } from "./team/team-view";
import { UpdatesView, type PostedUpdate } from "./updates/updates-view";
import { ViewSwitcher } from "./view-switcher";
import { DEFAULT_TASK_VIEW, TASKS_VIEW_COOKIE, parseTaskView } from "./views";

const DAY_MS = 24 * 60 * 60 * 1000;

function param(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function dateParam(value: string | undefined): Date | undefined {
  return value && isDateKey(value) ? fromDateKey(value) : undefined;
}

export default async function TasksPage({ params, searchParams }: PageProps<"/app/[orgSlug]/tasks">) {
  const { orgSlug } = await params;
  const query = await searchParams;
  const { organization: org, user, role, settings } = await getOrgContextBySlug(orgSlug);

  const cookieStore = await cookies();
  const view =
    parseTaskView(param(query.view)) ?? parseTaskView(cookieStore.get(TASKS_VIEW_COOKIE)?.value) ?? DEFAULT_TASK_VIEW;
  const projectId = param(query.project);
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
  const intakeProjects = base.projects.filter((p) => p.isIntake);

  let content: React.ReactNode;
  switch (view) {
    case "mine": {
      const limit = Math.min(Math.max(Number.parseInt(param(query.limit) ?? "100", 10) || 100, 20), 1000);
      const mine = await withOrgTx(org.id, ({ db }) =>
        getMyTasks(db, org.id, user.id, { completedSince: new Date(now.getTime() - 7 * DAY_MS), limit, projectId }),
      );
      const more = new URLSearchParams({ view: "mine", limit: String(limit + 100) });
      if (projectId) more.set("project", projectId);
      content = <MyTasksView open={mine.open} completed={mine.completed} hasMore={mine.hasMore} moreHref={`?${more}`} />;
      break;
    }
    case "table": {
      const statusParam = param(query.status);
      const filters: TableFilters = {
        projectId,
        status:
          statusParam === "open"
            ? "open"
            : statusParam && (Object.values(TaskStatus) as string[]).includes(statusParam)
              ? (statusParam as TaskStatus)
              : undefined,
        ownerId: param(query.owner),
        assigneeId: param(query.assignee),
        labelId: param(query.label),
        q: param(query.q)?.slice(0, 200),
        dueFrom: dateParam(param(query.dueFrom)),
        dueTo: dateParam(param(query.dueTo)),
        flagged: param(query.flagged) === "1",
        blockers: param(query.blockers) === "1",
      };
      const page = Math.max(1, Number.parseInt(param(query.page) ?? "1", 10) || 1);
      const { tasks, total } = await withOrgTx(org.id, ({ db }) =>
        getTableTasks(db, org.id, filters, page, fromDateKey(todayKey)),
      );
      content = (
        <div className="space-y-4">
          <TaskTableFilters />
          <TaskTable tasks={tasks} total={total} page={page} pageSize={TABLE_PAGE_SIZE} />
        </div>
      );
      break;
    }
    case "calendar": {
      const tasks = await withOrgTx(org.id, ({ db }) =>
        getCalendarTasks(db, org.id, { projectId, ownerId: param(query.owner) }),
      );
      content = <TaskCalendar tasks={tasks} />;
      break;
    }
    case "team": {
      const data = await withOrgTx(org.id, ({ db }) =>
        getTeamView(db, {
          organizationId: org.id,
          viewerId: user.id,
          isAdmin,
          positions,
          members,
          requestedScope: param(query.position) ?? null,
        }),
      );
      content = <TeamView data={data} />;
      break;
    }
    case "updates": {
      // Weeks are org-time (Monday to Sunday), the same for everyone.
      const currentWeek = weekStartKey(now, org.timezone);
      const requestedWeek = param(query.week);
      const weekStart =
        requestedWeek && isDateKey(requestedWeek) && requestedWeek <= currentWeek ? mondayOfKey(requestedWeek) : currentWeek;
      const requestedPerson = param(query.person);
      const person = members.find((m) => m.id === requestedPerson) ?? members.find((m) => m.id === user.id);
      const personId = person?.id ?? user.id;
      const data = await withOrgTx(org.id, async ({ db }) => {
        const summary = await getWeeklySummary(db, org.id, personId, weekStart, org.timezone, now);
        const updates = await getWeekUpdates(db, org.id, weekStart);
        const seeAll = await canSeeWhoPosted(db, org.id, user.id, role);
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
      content = (
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
      break;
    }
    case "intake": {
      const project = intakeProjects.find((p) => p.id === projectId) ?? intakeProjects[0] ?? null;
      const tasks = project
        ? await withOrgTx(org.id, ({ db }) => getIntakeTasks(db, org.id, project.id, new Date(now.getTime() - 14 * DAY_MS)))
        : [];
      content = <IntakeView project={project} intakeProjects={intakeProjects} tasks={tasks} />;
      break;
    }
    default: {
      const showAll = param(query.done) === "all";
      const completedSince = showAll ? null : new Date(now.getTime() - 14 * DAY_MS);
      const ownerId = param(query.owner);
      const { tasks, older } = await withOrgTx(org.id, async ({ db }) => ({
        tasks: await getBoardTasks(db, org.id, { projectId, ownerId, completedSince }),
        older: completedSince
          ? await countOlderCompleted(db, org.id, { projectId, ownerId, completedBefore: completedSince })
          : 0,
      }));
      const showAllParams = new URLSearchParams({ view: "board", done: "all" });
      if (projectId) showAllParams.set("project", projectId);
      content = (
        <QueryProvider>
          <KanbanBoard
            initialTasks={tasks}
            queryKey={["tasks", org.id, projectId ?? null, ownerId ?? null, showAll]}
            olderCompleted={older}
            showAllHref={showAll ? null : `?${showAllParams}`}
          />
        </QueryProvider>
      );
    }
  }

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
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Tasks</h1>
          <div className="flex flex-wrap items-center gap-2">
            {view !== "updates" && view !== "team" && view !== "intake" && <ProjectSelect />}
            <NewTaskButton />
          </div>
        </div>
        <ViewSwitcher current={view} showIntake={intakeProjects.length > 0 || isAdmin} />
        {content}
      </div>
    </TasksProvider>
  );
}
