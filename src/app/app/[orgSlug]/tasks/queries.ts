import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export const taskInclude = {
  assignees: {
    include: { user: { select: { id: true, name: true, email: true, image: true } } },
  },
  labels: { include: { label: true } },
  subtasks: {
    where: { deletedAt: null },
    select: { id: true, title: true, status: true },
    orderBy: { rank: "asc" },
  },
  project: { select: { id: true, name: true } },
} satisfies Prisma.TaskInclude;

export type TaskWithRelations = Prisma.TaskGetPayload<{ include: typeof taskInclude }>;

export function getTopLevelTasks(organizationId: string, projectId?: string) {
  return prisma.task.findMany({
    where: {
      organizationId,
      deletedAt: null,
      parentTaskId: null,
      ...(projectId ? { projectId } : {}),
    },
    include: taskInclude,
    // Rank is a fresh fractional-index sequence per status column, so it's
    // only meaningfully comparable within the same status — group by status
    // first, then sort by rank within each group.
    orderBy: [{ status: "asc" }, { rank: "asc" }],
  });
}

export function getOrgMembersForPicker(organizationId: string) {
  return prisma.membership.findMany({
    where: { organizationId },
    include: { user: { select: { id: true, name: true, email: true, image: true } } },
    orderBy: { user: { name: "asc" } },
  });
}

export function getOrgLabels(organizationId: string) {
  return prisma.label.findMany({ where: { organizationId }, orderBy: { name: "asc" } });
}

export function getOrgProjects(organizationId: string, includeArchived = false) {
  return prisma.project.findMany({
    where: { organizationId, ...(includeArchived ? {} : { archivedAt: null }) },
    orderBy: { name: "asc" },
  });
}
