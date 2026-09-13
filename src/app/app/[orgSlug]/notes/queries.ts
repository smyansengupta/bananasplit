import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export const noteListInclude = {
  author: { select: { id: true, name: true, email: true, image: true } },
  event: { select: { id: true, title: true, startsAt: true } },
} satisfies Prisma.NoteInclude;

export type NoteWithRelations = Prisma.NoteGetPayload<{ include: typeof noteListInclude }>;

/** Private notes are invisible to everyone but their author, regardless of role. */
function visibleToUser(userId: string): Prisma.NoteWhereInput {
  return { OR: [{ visibility: "ORGANIZATION" }, { authorId: userId }] };
}

export function getNotesForList(
  organizationId: string,
  userId: string,
  filters: { visibility?: "PRIVATE" | "ORGANIZATION"; authorId?: string } = {},
) {
  return prisma.note.findMany({
    where: {
      organizationId,
      deletedAt: null,
      ...visibleToUser(userId),
      ...(filters.visibility ? { visibility: filters.visibility } : {}),
      ...(filters.authorId ? { authorId: filters.authorId } : {}),
    },
    include: noteListInclude,
    orderBy: { updatedAt: "desc" },
  });
}

export function getNoteById(organizationId: string, userId: string, noteId: string) {
  return prisma.note.findFirst({
    where: { id: noteId, organizationId, deletedAt: null, ...visibleToUser(userId) },
    include: noteListInclude,
  });
}

export function getOrgMembersForFilter(organizationId: string) {
  return prisma.membership.findMany({
    where: { organizationId },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { user: { name: "asc" } },
  });
}

export function getOrgEventsForPicker(organizationId: string) {
  return prisma.event.findMany({
    where: { organizationId, deletedAt: null },
    select: { id: true, title: true, startsAt: true },
    orderBy: { startsAt: "desc" },
    take: 100,
  });
}

interface NoteSearchRow {
  id: string;
  title: string;
  visibility: "PRIVATE" | "ORGANIZATION";
  updatedAt: Date;
}

export async function searchNotes(organizationId: string, userId: string, query: string) {
  const trimmed = query.trim();
  if (!trimmed) return [];

  return prisma.$queryRaw<NoteSearchRow[]>`
    SELECT id, title, visibility, "updatedAt"
    FROM "Note"
    WHERE "organizationId" = ${organizationId}
      AND "deletedAt" IS NULL
      AND (visibility = 'ORGANIZATION' OR "authorId" = ${userId})
      AND "searchVector" @@ plainto_tsquery('english', ${trimmed})
    ORDER BY ts_rank("searchVector", plainto_tsquery('english', ${trimmed})) DESC
    LIMIT 10
  `;
}

export function searchTasks(organizationId: string, query: string) {
  const trimmed = query.trim();
  if (!trimmed) return Promise.resolve([]);

  return prisma.task.findMany({
    where: { organizationId, deletedAt: null, title: { contains: trimmed, mode: "insensitive" } },
    select: { id: true, title: true, status: true },
    take: 10,
  });
}
