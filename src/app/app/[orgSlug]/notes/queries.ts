import type { Prisma } from "@/generated/prisma/client";
import type { TxClient } from "@/server/db/context";

/**
 * Note reads. Every helper takes the caller's transaction client (ctx.db
 * from withOrgTx or withOrgAction), so it runs as app_user under RLS: the
 * database already hides other orgs' notes and other authors' PRIVATE notes
 * (policy 6.8). The explicit organizationId and visibility filters stay as
 * the first check and so the planner can use the indexes.
 */

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
  db: TxClient,
  organizationId: string,
  userId: string,
  filters: { visibility?: "PRIVATE" | "ORGANIZATION"; authorId?: string } = {},
) {
  return db.note.findMany({
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

export function getNoteById(db: TxClient, organizationId: string, userId: string, noteId: string) {
  return db.note.findFirst({
    where: { id: noteId, organizationId, deletedAt: null, ...visibleToUser(userId) },
    include: noteListInclude,
  });
}

export function getOrgMembersForFilter(db: TxClient, organizationId: string) {
  return db.membership.findMany({
    where: { organizationId },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { user: { name: "asc" } },
  });
}

export function getOrgEventsForPicker(db: TxClient, organizationId: string) {
  return db.event.findMany({
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

/**
 * Full-text search over the note's searchVector. A tagged-template $queryRaw:
 * every value is a bound parameter, never spliced into the SQL.
 */
export async function searchNotes(
  db: TxClient,
  organizationId: string,
  userId: string,
  query: string,
) {
  const trimmed = query.trim();
  if (!trimmed) return [];

  return db.$queryRaw<NoteSearchRow[]>`
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

export async function searchTasks(db: TxClient, organizationId: string, query: string) {
  const trimmed = query.trim();
  if (!trimmed) return [];

  return db.task.findMany({
    where: { organizationId, deletedAt: null, title: { contains: trimmed, mode: "insensitive" } },
    select: { id: true, title: true, status: true },
    take: 10,
  });
}
