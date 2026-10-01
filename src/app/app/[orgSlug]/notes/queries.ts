import type { Prisma } from "@/generated/prisma/client";
import { trashCutoff } from "@/lib/notes/trash";
import type { TxClient } from "@/server/db/context";
import { userPublicSelect } from "@/server/members";

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

/** The live-collaboration state is internal storage: never loaded for lists or pages. */
const noteListOmit = { yjsState: true } satisfies Prisma.NoteOmit;

export type NoteWithRelations = Prisma.NoteGetPayload<{
  include: typeof noteListInclude;
  omit: typeof noteListOmit;
}>;

/** Private notes are invisible to everyone but their author, regardless of role. */
function visibleToUser(userId: string): Prisma.NoteWhereInput {
  return { OR: [{ visibility: "ORGANIZATION" }, { authorId: userId }] };
}

export function getNotesForList(
  db: TxClient,
  organizationId: string,
  userId: string,
  filters: {
    visibility?: "PRIVATE" | "ORGANIZATION";
    authorId?: string;
    /** A folder id, or "none" for notes in no folder. */
    folderId?: string;
    q?: string;
    sort?: NoteSort;
  } = {},
) {
  const q = filters.q?.trim().slice(0, 100);
  return db.note.findMany({
    where: {
      AND: [
        { organizationId, deletedAt: null },
        visibleToUser(userId),
        filters.visibility ? { visibility: filters.visibility } : {},
        filters.authorId ? { authorId: filters.authorId } : {},
        filters.folderId ? { folderId: filters.folderId === "none" ? null : filters.folderId } : {},
        q
          ? {
              OR: [
                { title: { contains: q, mode: "insensitive" } },
                { contentText: { contains: q, mode: "insensitive" } },
              ],
            }
          : {},
      ],
    },
    include: noteListInclude,
    omit: noteListOmit,
    orderBy:
      filters.sort === "title"
        ? { title: "asc" }
        : filters.sort === "created"
          ? { createdAt: "desc" }
          : { updatedAt: "desc" },
    take: 300,
  });
}

/**
 * "Recently deleted": notes deleted in the last NOTE_TRASH_DAYS that this
 * member may restore (their own, and for an admin any shared note), the
 * same people restoreNote lets through.
 */
export function getDeletedNotes(db: TxClient, organizationId: string, userId: string, isAdmin: boolean) {
  return db.note.findMany({
    where: {
      organizationId,
      deletedAt: { gte: trashCutoff() },
      OR: [{ authorId: userId }, ...(isAdmin ? [{ visibility: "ORGANIZATION" as const }] : [])],
    },
    select: {
      id: true,
      title: true,
      visibility: true,
      deletedAt: true,
      author: { select: { name: true, email: true } },
    },
    orderBy: { deletedAt: "desc" },
    take: 100,
  });
}

/** How many items "Recently deleted" holds for this member (notes and files). */
export async function countDeleted(db: TxClient, organizationId: string, userId: string, isAdmin: boolean) {
  const since = trashCutoff();
  const notes = await db.note.count({
    where: {
      organizationId,
      deletedAt: { gte: since },
      OR: [{ authorId: userId }, ...(isAdmin ? [{ visibility: "ORGANIZATION" as const }] : [])],
    },
  });
  const files = await db.orgFile.count({
    where: { organizationId, deletedAt: { gte: since }, ...(isAdmin ? {} : { uploadedById: userId }) },
  });
  return notes + files;
}

export const NOTE_SORTS = ["edited", "created", "title"] as const;
export type NoteSort = (typeof NOTE_SORTS)[number];

/** The overview's most recently edited notes the viewer may read. */
export function getRecentNotes(
  db: TxClient,
  organizationId: string,
  userId: string,
  limit: number,
) {
  return db.note.findMany({
    where: { organizationId, deletedAt: null, ...visibleToUser(userId) },
    select: {
      id: true,
      title: true,
      visibility: true,
      updatedAt: true,
      updatedBy: { select: userPublicSelect },
    },
    orderBy: { updatedAt: "desc" },
    take: limit,
  });
}

export type RecentNote = Awaited<ReturnType<typeof getRecentNotes>>[number];

export function getNoteById(db: TxClient, organizationId: string, userId: string, noteId: string) {
  return db.note.findFirst({
    where: { id: noteId, organizationId, deletedAt: null, ...visibleToUser(userId) },
    include: noteListInclude,
    omit: noteListOmit,
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
