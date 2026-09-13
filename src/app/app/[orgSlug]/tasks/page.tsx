import { notFound } from "next/navigation";

import { TaskStatus } from "@/generated/prisma/client";
import { handleAuthErrorInPage } from "@/lib/auth/handle-auth-error";
import { requireOrgMembership } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";
import { QueryProvider } from "@/components/providers/query-provider";

import { KanbanBoard } from "./kanban/kanban-board";
import { TaskCalendar } from "./calendar/task-calendar";
import {
  getOrgLabels,
  getOrgMembersForPicker,
  getOrgProjects,
  getTopLevelTasks,
  taskInclude,
} from "./queries";
import { ProjectSelect } from "./project-select";
import { TaskTable } from "./table/task-table";
import { TaskTableFilters } from "./table/task-table-filters";
import { ViewSwitcher } from "./view-switcher";

export default async function TasksPage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/tasks">) {
  const { orgSlug } = await params;
  const query = await searchParams;

  const org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
  if (!org) {
    notFound();
  }

  try {
    await requireOrgMembership(org.id);
  } catch (error) {
    handleAuthErrorInPage(error);
  }

  const view = typeof query.view === "string" ? query.view : "board";
  const projectId = typeof query.project === "string" ? query.project : undefined;

  const [memberships, labels, projects] = await Promise.all([
    getOrgMembersForPicker(org.id),
    getOrgLabels(org.id),
    getOrgProjects(org.id),
  ]);
  const members = memberships.map((m) => ({
    userId: m.userId,
    name: m.user.name,
    email: m.user.email,
    image: m.user.image,
  }));

  let content: React.ReactNode;

  if (view === "table") {
    const status = typeof query.status === "string" ? (query.status as TaskStatus) : undefined;
    const assignee = typeof query.assignee === "string" ? query.assignee : undefined;
    const label = typeof query.label === "string" ? query.label : undefined;
    const q = typeof query.q === "string" ? query.q : undefined;
    const dueFrom = typeof query.dueFrom === "string" ? query.dueFrom : undefined;
    const dueTo = typeof query.dueTo === "string" ? query.dueTo : undefined;

    const tasks = await prisma.task.findMany({
      where: {
        organizationId: org.id,
        deletedAt: null,
        parentTaskId: null,
        ...(projectId ? { projectId } : {}),
        ...(status ? { status } : {}),
        ...(assignee ? { assignees: { some: { userId: assignee } } } : {}),
        ...(label ? { labels: { some: { labelId: label } } } : {}),
        ...(q ? { title: { contains: q, mode: "insensitive" } } : {}),
        ...(dueFrom || dueTo
          ? {
              dueDate: {
                ...(dueFrom ? { gte: new Date(dueFrom) } : {}),
                ...(dueTo ? { lte: new Date(dueTo) } : {}),
              },
            }
          : {}),
      },
      include: taskInclude,
      orderBy: [{ status: "asc" }, { rank: "asc" }],
    });

    content = (
      <div className="space-y-4">
        <TaskTableFilters members={members} labels={labels} />
        <TaskTable
          orgId={org.id}
          tasks={tasks}
          members={members}
          labels={labels}
          projects={projects}
        />
      </div>
    );
  } else if (view === "calendar") {
    const tasks = await getTopLevelTasks(org.id, projectId);
    content = (
      <TaskCalendar
        orgId={org.id}
        tasks={tasks}
        members={members}
        labels={labels}
        projects={projects}
      />
    );
  } else {
    const tasks = await getTopLevelTasks(org.id, projectId);
    content = (
      <QueryProvider>
        <KanbanBoard
          orgId={org.id}
          initialTasks={tasks}
          queryKey={["tasks", org.id, projectId ?? null]}
          members={members}
          labels={labels}
          projects={projects}
        />
      </QueryProvider>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Tasks</h1>
        <div className="flex flex-wrap items-center gap-3">
          <ProjectSelect orgId={org.id} projects={projects} />
          <ViewSwitcher />
        </div>
      </div>
      {content}
    </div>
  );
}
