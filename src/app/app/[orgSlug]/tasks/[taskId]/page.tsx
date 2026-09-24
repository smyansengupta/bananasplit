import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { TaskPageEditor } from "@/components/tasks/task-page-editor";
import { TasksProvider } from "@/components/tasks/tasks-context";
import { can } from "@/lib/auth/permissions";
import { effectiveTimezone, localDateKey } from "@/lib/tasks/dates";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { getOrgMembersForPicker } from "@/server/members";
import { buildViewerChart, getChartForPage } from "@/server/tasks/assignment-policy";
import { getComments, getOrgLabels, getOrgProjects, getTaskDetail } from "@/server/tasks/queries";

/**
 * A task's own page: the target of every email link
 * (/app/{slug}/tasks/{taskId}). Signed-out visitors go through sign-in with
 * a callbackUrl back here. Subtasks show their parent as a breadcrumb.
 */
export default async function TaskPage({ params }: PageProps<"/app/[orgSlug]/tasks/[taskId]">) {
  const { orgSlug, taskId } = await params;
  const { organization: org, user, role, settings } = await getOrgContextBySlug(orgSlug);
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(taskId)) notFound();

  const members = await getOrgMembersForPicker(org.id);
  const chart = buildViewerChart(await getChartForPage(org.id), user.id);
  const data = await withOrgTx(org.id, async ({ db }) => {
    const task = await getTaskDetail(db, org.id, taskId);
    if (!task) return null;
    const me = await db.user.findUnique({ where: { id: user.id }, select: { timezone: true } });
    const labels = await getOrgLabels(db, org.id);
    const projects = await getOrgProjects(db, org.id, true);
    const comments = await getComments(db, org.id, taskId);
    return { task, labels, projects, comments, tz: effectiveTimezone(me, org) };
  });
  if (!data) notFound();

  const { task } = data;
  return (
    <TasksProvider
      org={{
        id: org.id,
        slug: org.slug,
        timezone: data.tz,
        todayKey: localDateKey(new Date(), data.tz),
        requireOwner: settings?.taskRequireOwner ?? false,
        requireDueDate: settings?.taskRequireDueDate ?? false,
      }}
      viewer={{ userId: user.id, name: user.name, isAdmin: can({ role }, "tasks.manageAll"), chart }}
      members={members}
      labels={data.labels}
      projects={data.projects}
    >
      <div className="mx-auto max-w-3xl space-y-4">
        <nav aria-label="Breadcrumb" className="text-muted-foreground flex flex-wrap items-center gap-1 text-sm">
          <Link href={`/app/${org.slug}/tasks`} className="hover:text-foreground inline-flex items-center gap-1">
            <ChevronLeft className="size-4" aria-hidden="true" /> Tasks
          </Link>
          {task.project && (
            <>
              <span aria-hidden="true">/</span>
              <Link href={`/app/${org.slug}/tasks?project=${task.project.id}`} className="hover:text-foreground">
                {task.project.name}
              </Link>
            </>
          )}
          {task.parentTask && (
            <>
              <span aria-hidden="true">/</span>
              <Link href={`/app/${org.slug}/tasks/${task.parentTask.id}`} className="hover:text-foreground">
                {task.parentTask.title}
              </Link>
            </>
          )}
        </nav>
        <h1 className="text-2xl font-semibold tracking-tight">{task.title}</h1>
        <div className="rounded-lg border p-4 sm:p-6">
          <TaskPageEditor task={task} initialComments={data.comments} />
        </div>
      </div>
    </TasksProvider>
  );
}
