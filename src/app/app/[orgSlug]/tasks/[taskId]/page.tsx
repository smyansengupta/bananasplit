import { isPersonalSpace } from "@/lib/billing/space";
import { clubsUserRuns } from "@/server/personal/move";
import { notFound } from "next/navigation";

import { BackLink } from "@/components/back-link";
import { LinkedSection } from "@/components/links/linked-section";
import { MarkDoneBanner } from "@/components/tasks/mark-done-banner";
import { TaskPageAmbient } from "@/components/tasks/task-page-ambient";
import { TaskPageEditor } from "@/components/tasks/task-page-editor";
import { TasksProvider } from "@/components/tasks/tasks-context";
import { agendaMeetingFor } from "@/lib/ambient/tasks";
import { can } from "@/lib/auth/permissions";
import { effectiveTimezone, localDateKey } from "@/lib/tasks/dates";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { getOrgMembersForPicker } from "@/server/members";
import { buildViewerChart, getChartForPage } from "@/server/tasks/assignment-policy";
import { listFileRefOptions } from "@/server/notes/files";
import { getComments, getOrgLabels, getOrgParents, getTaskDetail } from "@/server/tasks/queries";

/**
 * A task's own page: the target of every email link
 * (/app/{slug}/tasks/{taskId}). Signed-out visitors go through sign-in with
 * a callbackUrl back here. The editor carries the task's own title (no page
 * heading repeating it); a subtask links its parent inside the form. A
 * reminder's Mark done link adds ?done=1, which shows a one-click Done.
 */
export default async function TaskPage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/tasks/[taskId]">) {
  const { orgSlug, taskId } = await params;
  // A reminder email's Mark done link (?done=1): the page offers the button.
  const offerDone = (await searchParams).done === "1";
  const { organization: org, user, role, settings } = await getOrgContextBySlug(orgSlug);
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(taskId)) notFound();

  const members = await getOrgMembersForPicker(org.id);
  const chart = buildViewerChart(await getChartForPage(org.id), user.id);
  const data = await withOrgTx(org.id, async ({ db }) => {
    const task = await getTaskDetail(db, org.id, taskId);
    if (!task) return null;
    const me = await db.user.findUnique({ where: { id: user.id }, select: { timezone: true } });
    const labels = await getOrgLabels(db, org.id);
    // What it can be part of (the editor's Part of).
    const parents = await getOrgParents(db, org.id);
    const comments = await getComments(db, org.id, taskId);
    // What `/` in a title or a description can point at.
    const files = await listFileRefOptions(db, org.id);
    // Meetings it's linked to, either way round: Add to agenda for this week's.
    const links = await db.itemLink.findMany({
      where: {
        organizationId: org.id,
        OR: [
          { fromKind: "task", fromId: taskId, toKind: "event" },
          { toKind: "task", toId: taskId, fromKind: "event" },
        ],
      },
      select: { fromKind: true, fromId: true, toId: true },
    });
    const meetings = links.length
      ? await db.event.findMany({
          where: {
            organizationId: org.id,
            id: { in: links.map((l) => (l.fromKind === "event" ? l.fromId : l.toId)) },
            deletedAt: null,
            mergedIntoId: null,
          },
          select: { id: true, title: true, startsAt: true, description: true },
        })
      : [];
    return {
      task,
      labels,
      parents,
      files,
      comments,
      meetings,
      tz: effectiveTimezone(me, org),
    };
  });
  if (!data) notFound();

  const { task } = data;
  // Editing an agenda is editing the meeting (owners and admins).
  const agenda = can({ role }, "events.write")
    ? agendaMeetingFor(task.id, data.meetings, new Date())
    : null;
  const agendaWhen = agenda
    ? new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: data.tz }).format(
        new Date(agenda.startsAt),
      )
    : "";
  // In Personal, a task's menu can move it to an organization you run.
  const moveTargets = isPersonalSpace(org) ? await clubsUserRuns(user.id) : [];
  return (
    <TasksProvider
      moveTargets={moveTargets}
      org={{
        id: org.id,
        slug: org.slug,
        timezone: data.tz,
        todayKey: localDateKey(new Date(), data.tz),
        requireOwner: settings?.taskRequireOwner ?? false,
        requireDueDate: settings?.taskRequireDueDate ?? false,
      }}
      viewer={{
        userId: user.id,
        name: user.name,
        isAdmin: can({ role }, "tasks.manageAll"),
        chart,
      }}
      members={members}
      labels={data.labels}
      files={data.files}
      parents={data.parents}
    >
      <div className="mx-auto max-w-2xl space-y-4">
        <BackLink href={`/app/${orgSlug}/tasks`} label="Tasks" />
        {offerDone && <MarkDoneBanner task={task} />}
        <TaskPageAmbient
          task={task}
          meeting={
            agenda
              ? {
                  id: agenda.id,
                  title: agenda.title,
                  when: agendaWhen,
                  description: agenda.description,
                }
              : null
          }
        />
        <TaskPageEditor task={task} initialComments={data.comments} />
        <LinkedSection orgId={org.id} orgSlug={orgSlug} at={{ kind: "task", id: task.id }} />
      </div>
    </TasksProvider>
  );
}
