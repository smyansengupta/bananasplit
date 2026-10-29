import { z } from "zod";

import { OrgKind, RegistrationStatus, Role, TaskStatus } from "@/generated/prisma/client";
import { ForbiddenError, NotFoundError } from "@/lib/auth/errors";
import { writeOrgAuditLog } from "@/server/audit";
import { withOrgTx, withUserTx } from "@/server/db/context";
import { sqlStateOf } from "@/server/db/errors";

import {
  ClubFullError,
  discardCopies,
  prepareFiles,
  roomMessage,
  settleFiles,
  type PreparedFiles,
} from "./move-files";
import { getPersonalSpace } from "./space";

/**
 * "Bring anything in?" (docs/features/personal-and-clubs.md, "Starting a
 * club"): the Personal items a club's creator can move into a club they run,
 * and the move itself. The move is app.move_personal_items
 * (20261013190000_move_personal_items, with notes, folders and uploads since
 * 20261023120000_move_personal_files), one transaction as app_user: the
 * database checks that the Personal space is the caller's and that they own
 * or run the club, then moves each item with every row under it, keeping
 * ids, so public links, tickets and poll responses keep working. Uploads'
 * bytes are copied into the club's storage first (./move-files.ts).
 *
 * Used by the last club setup step (/onboarding/organization/{slug}/bring)
 * and by "Move to a club" (/app/{personal slug}/move).
 */

/** The most of each kind listed (and moved) at once; the function caps the total at 500. */
const LIST_LIMIT = 100;

export interface BringableEvent {
  id: string;
  title: string;
  startsAt: Date;
  allDay: boolean;
  /** Has a public RSVP page (/e/{slug}). */
  rsvp: boolean;
  /** Going sign-ups on its RSVP page. */
  going: number;
  past: boolean;
}

export interface BringablePoll {
  id: string;
  title: string;
  kind: "availability" | "question";
  /** People who answered (availability) or votes cast (question). */
  responses: number;
  /** An availability poll's scheduled event: it moves with the poll. */
  finalizedEventId: string | null;
}

export interface BringableTask {
  id: string;
  title: string;
  dueDate: Date | null;
  /** Live subtasks: they move with it. */
  subtasks: number;
}

export interface BringableTaskGroup {
  /** A heading for the group (null: none; projects, which named them, became epics). */
  project: string | null;
  tasks: BringableTask[];
}

export interface BringableFolder {
  id: string;
  name: string;
  /** Live notes and uploads in it: they move with it. */
  notes: number;
  files: number;
}

export interface BringableNote {
  id: string;
  title: string;
  updatedAt: Date;
  folder: string | null;
  /** Live sub-pages under it, at any depth: they move with it. */
  subpages: number;
  /** Uploads it (or a sub-page) shows: they move with it. */
  files: number;
}

export interface BringableFile {
  id: string;
  name: string;
  sizeBytes: number;
  folder: string | null;
}

export interface Bringable {
  space: { id: string; slug: string; name: string; timezone: string };
  /** Events with an RSVP page. */
  rsvpEvents: BringableEvent[];
  /** Other calendar events: upcoming ones and the last month's. */
  events: BringableEvent[];
  polls: BringablePoll[];
  /** Open top-level tasks and epics. */
  taskGroups: BringableTaskGroup[];
  folders: BringableFolder[];
  /** Top-level notes (sub-pages come with them), most recently edited first. */
  notes: BringableNote[];
  /** Uploads no live note shows (those come with their note), newest first. */
  files: BringableFile[];
  /** Every item listed. */
  total: number;
}

/** What the user's Personal space holds that could move into a club; null without a space. */
export async function loadBringable(userId: string, now = new Date()): Promise<Bringable | null> {
  const space = await getPersonalSpace(userId);
  if (!space || space.deletedAt) return null;
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  return withOrgTx(space.id, async ({ db }) => {
    const orgId = space.id;
    const [eventRows, pollRows, questionRows, taskRows, folderRows, noteRows, fileRows, shown] =
      await Promise.all([
        db.event.findMany({
          where: {
            organizationId: orgId,
            deletedAt: null,
            mergedIntoId: null,
            OR: [{ rsvpSlug: { not: null } }, { endsAt: { gte: monthAgo } }],
          },
          orderBy: { startsAt: "asc" },
          take: LIST_LIMIT * 2,
          select: {
            id: true,
            title: true,
            startsAt: true,
            endsAt: true,
            allDay: true,
            rsvpSlug: true,
            _count: { select: { registrations: { where: { status: RegistrationStatus.GOING } } } },
          },
        }),
        db.availabilityPoll.findMany({
          where: { organizationId: orgId },
          orderBy: { createdAt: "desc" },
          take: LIST_LIMIT,
          select: {
            id: true,
            title: true,
            finalizedEventId: true,
            responses: { select: { userId: true, guestName: true, guestKeyHash: true } },
          },
        }),
        db.poll.findMany({
          where: { organizationId: orgId },
          orderBy: { createdAt: "desc" },
          take: LIST_LIMIT,
          select: { id: true, question: true, _count: { select: { votes: true } } },
        }),
        db.task.findMany({
          where: {
            organizationId: orgId,
            deletedAt: null,
            parentTaskId: null,
            status: { not: TaskStatus.COMPLETED },
          },
          orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
          take: LIST_LIMIT,
          select: {
            id: true,
            title: true,
            dueDate: true,
            _count: { select: { subtasks: { where: { deletedAt: null } } } },
          },
        }),
        db.noteFolder.findMany({
          where: { organizationId: orgId },
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
          take: LIST_LIMIT,
          select: {
            id: true,
            name: true,
            _count: {
              select: {
                notes: { where: { deletedAt: null } },
                files: { where: { deletedAt: null } },
              },
            },
          },
        }),
        // Every live page, for the tree under each top-level one.
        db.note.findMany({
          where: { organizationId: orgId, deletedAt: null },
          orderBy: { updatedAt: "desc" },
          take: 1000,
          select: {
            id: true,
            title: true,
            parentId: true,
            updatedAt: true,
            folder: { select: { name: true } },
          },
        }),
        db.orgFile.findMany({
          where: { organizationId: orgId, deletedAt: null },
          orderBy: { createdAt: "desc" },
          take: LIST_LIMIT * 2,
          select: { id: true, name: true, sizeBytes: true, folder: { select: { name: true } } },
        }),
        // The uploads each live note shows (an image or a file card names it by fileId).
        db.$queryRaw<{ noteId: string; fileId: string | null }[]>`
        SELECT DISTINCT n."id" AS "noteId", jsonb_path_query(n."contentJson", 'lax $.**.fileId') #>> '{}' AS "fileId"
          FROM "Note" n
         WHERE n."organizationId" = ${orgId} AND n."deletedAt" IS NULL`,
      ]);

    const toEvent = (e: (typeof eventRows)[number]): BringableEvent => ({
      id: e.id,
      title: e.title,
      startsAt: e.startsAt,
      allDay: e.allDay,
      rsvp: e.rsvpSlug !== null,
      going: e._count.registrations,
      past: e.endsAt.getTime() < now.getTime(),
    });
    // Upcoming first (soonest first), then the past (latest first).
    const ordered = [
      ...eventRows.filter((e) => e.endsAt.getTime() >= now.getTime()),
      ...eventRows.filter((e) => e.endsAt.getTime() < now.getTime()).reverse(),
    ].map(toEvent);
    const rsvpEvents = ordered.filter((e) => e.rsvp).slice(0, LIST_LIMIT);
    const events = ordered.filter((e) => !e.rsvp).slice(0, LIST_LIMIT);

    const polls: BringablePoll[] = [
      ...pollRows.map((p) => ({
        id: p.id,
        title: p.title,
        kind: "availability" as const,
        responses: new Set(
          p.responses.map((r) => r.userId ?? r.guestKeyHash ?? `name:${r.guestName ?? ""}`),
        ).size,
        finalizedEventId: p.finalizedEventId,
      })),
      ...questionRows.map((p) => ({
        id: p.id,
        title: p.question,
        kind: "question" as const,
        responses: p._count.votes,
        finalizedEventId: null,
      })),
    ];

    // One group: an epic is a top-level item like any task (projects,
    // which used to group them, became epics).
    const taskGroups: BringableTaskGroup[] =
      taskRows.length > 0
        ? [
            {
              project: null,
              tasks: taskRows.map((t) => ({
                id: t.id,
                title: t.title,
                dueDate: t.dueDate,
                subtasks: t._count.subtasks,
              })),
            },
          ]
        : [];

    const folders: BringableFolder[] = folderRows.map((f) => ({
      id: f.id,
      name: f.name,
      notes: f._count.notes,
      files: f._count.files,
    }));

    // A note brings its live sub-pages and the uploads they all show.
    const children = new Map<string, string[]>();
    for (const n of noteRows) {
      if (n.parentId) children.set(n.parentId, [...(children.get(n.parentId) ?? []), n.id]);
    }
    const showsFiles = new Map<string, string[]>();
    for (const s of shown) {
      if (s.fileId) showsFiles.set(s.noteId, [...(showsFiles.get(s.noteId) ?? []), s.fileId]);
    }
    const liveFiles = new Set(
      shown.length
        ? (
            await db.orgFile.findMany({
              where: {
                organizationId: orgId,
                deletedAt: null,
                id: { in: shown.flatMap((s) => (s.fileId ? [s.fileId] : [])) },
              },
              select: { id: true },
            })
          ).map((f) => f.id)
        : [],
    );
    const live = new Set(noteRows.map((n) => n.id));
    const notes: BringableNote[] = noteRows
      .filter((n) => !n.parentId || !live.has(n.parentId))
      .slice(0, LIST_LIMIT)
      .map((n) => {
        const tree = new Set<string>();
        const walk = (id: string) => {
          for (const c of children.get(id) ?? []) {
            if (!tree.has(c)) {
              tree.add(c);
              walk(c);
            }
          }
        };
        walk(n.id);
        const files = new Set(
          [n.id, ...tree].flatMap((id) => showsFiles.get(id) ?? []).filter((f) => liveFiles.has(f)),
        );
        return {
          id: n.id,
          title: n.title,
          updatedAt: n.updatedAt,
          folder: n.folder?.name ?? null,
          subpages: tree.size,
          files: files.size,
        };
      });
    const files: BringableFile[] = fileRows
      .filter((f) => !liveFiles.has(f.id))
      .slice(0, LIST_LIMIT)
      .map((f) => ({
        id: f.id,
        name: f.name,
        sizeBytes: f.sizeBytes,
        folder: f.folder?.name ?? null,
      }));

    return {
      space: { id: space.id, slug: space.slug, name: space.name, timezone: space.timezone },
      rsvpEvents,
      events,
      polls,
      taskGroups,
      folders,
      notes,
      files,
      total:
        rsvpEvents.length +
        events.length +
        polls.length +
        taskRows.length +
        folders.length +
        notes.length +
        files.length,
    };
  });
}

/** Every id listed in a Bringable, for checking a ?bring= preselection. */
export function bringableIds(b: Bringable): Set<string> {
  return new Set([
    ...b.rsvpEvents.map((e) => e.id),
    ...b.events.map((e) => e.id),
    ...b.polls.map((p) => p.id),
    ...b.taskGroups.flatMap((g) => g.tasks.map((t) => t.id)),
    ...b.folders.map((f) => f.id),
    ...b.notes.map((n) => n.id),
    ...b.files.map((f) => f.id),
  ]);
}

const id = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const ids = z.array(id).max(500).default([]);

export const moveSelectionSchema = z
  .object({
    eventIds: ids,
    pollIds: ids,
    questionPollIds: ids,
    taskIds: ids,
    noteIds: ids,
    folderIds: ids,
    fileIds: ids,
  })
  .strict();
export type MoveSelection = z.input<typeof moveSelectionSchema>;

export interface MovedCounts {
  events: number;
  polls: number;
  questionPolls: number;
  tasks: number;
  notes: number;
  folders: number;
  files: number;
}

const NOTHING_MOVED: MovedCounts = {
  events: 0,
  polls: 0,
  questionPolls: 0,
  tasks: 0,
  notes: 0,
  folders: 0,
  files: 0,
};

/** What app.move_personal_items returns. */
interface MovedRow extends MovedCounts {
  fileIds: string[];
  storageUsedBytes: number;
}

const NOT_YOUR_CLUB = "You can bring things only into an organization you own or run.";

export type MoveResult = { ok: true; moved: MovedCounts } | { ok: false; error: string };

/**
 * Moves the picked items from the user's Personal space into `toOrgId`, one
 * way (app.move_personal_items). A poll's scheduled event, a task's
 * subtasks, a folder's notes and uploads, and a note's sub-pages and the
 * uploads it shows come along. Uploads go through the club's upload gate
 * (it has room for them), so their bytes are copied first and the old ones
 * deleted after commit (./move-files.ts). Refusals come back as
 * `{ ok: false, error }`.
 */
export async function movePersonalItems(
  userId: string,
  toOrgId: string,
  input: unknown,
): Promise<MoveResult> {
  const parsed = moveSelectionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Pick what to bring in, then try again." };
  const pick = parsed.data;
  const count = Object.values(pick).reduce((n, list) => n + list.length, 0);
  if (count === 0) return { ok: true, moved: NOTHING_MOVED };
  if (count > 500) return { ok: false, error: "Bring in at most 500 things at once." };

  const space = await getPersonalSpace(userId);
  if (!space || space.deletedAt) return { ok: false, error: "Your Personal space wasn't found." };

  let files: PreparedFiles | null = null;
  if (pick.noteIds.length + pick.folderIds.length + pick.fileIds.length > 0) {
    try {
      const prepared = await prepareFiles(space.id, toOrgId, pick);
      if (!prepared.ok) return prepared;
      files = prepared.files;
    } catch (error) {
      if (error instanceof NotFoundError) return { ok: false, error: NOT_YOUR_CLUB };
      throw error;
    }
  }

  let row: MovedRow;
  try {
    row = await withUserTx(userId, async ({ db }) => {
      const rows = await db.$queryRaw<{ r: MovedRow }[]>`
        SELECT app.move_personal_items(
          ${space.id}, ${toOrgId},
          ${pick.eventIds}::text[], ${pick.pollIds}::text[],
          ${pick.questionPollIds}::text[], ${pick.taskIds}::text[],
          ${pick.noteIds}::text[], ${pick.folderIds}::text[], ${pick.fileIds}::text[],
          ${JSON.stringify(files?.keys ?? {})}::jsonb,
          ${JSON.stringify(files?.states ?? {})}::jsonb) AS r`;
      const r = rows[0].r;
      // The upload gate's last step, in the move's transaction: the club's
      // counter now holds what moved (and the org row's lock until commit).
      if (files && files.bytes > 0 && r.storageUsedBytes > files.limitBytes) {
        throw new ClubFullError(
          roomMessage(
            files.space.name,
            r.storageUsedBytes - files.bytes,
            files.limitBytes,
            files.bytes,
          ),
        );
      }
      return r;
    });
  } catch (error) {
    if (files) await discardCopies(files);
    if (error instanceof ClubFullError) return { ok: false, error: error.message };
    if (error instanceof ForbiddenError || sqlStateOf(error) === "42501") {
      return { ok: false, error: NOT_YOUR_CLUB };
    }
    if (sqlStateOf(error) === "22023") {
      return {
        ok: false,
        error: "Something you picked was moved or deleted. Refresh the page and try again.",
      };
    }
    if (sqlStateOf(error) === "55000") {
      return { ok: false, error: "An event with check-ins can't be moved." };
    }
    if (sqlStateOf(error) === "40001") {
      return { ok: false, error: "Something you picked changed while it was moving. Try again." };
    }
    throw error;
  }
  if (files) await settleFiles(files, row);
  const { fileIds: _fileIds, storageUsedBytes: _used, ...moved } = row;

  // The club's history: what came in, from whose Personal space.
  await withOrgTx(toOrgId, ({ db }) =>
    writeOrgAuditLog(db, {
      organizationId: toOrgId,
      action: "personal.items_moved",
      targetType: "Organization",
      targetId: toOrgId,
      diff: { ...moved, fromPersonalSpace: space.id },
    }),
  );
  return { ok: true, moved };
}

/** "3 events, 1 poll, 2 tasks and 4 notes". */
export function movedSummary(m: MovedCounts): string {
  const n = (k: number, one: string, many: string) => (k === 1 ? `1 ${one}` : `${k} ${many}`);
  const parts = [
    m.events ? n(m.events, "event", "events") : null,
    m.polls + m.questionPolls ? n(m.polls + m.questionPolls, "poll", "polls") : null,
    m.tasks ? n(m.tasks, "task", "tasks") : null,
    m.folders ? n(m.folders, "folder", "folders") : null,
    m.notes ? n(m.notes, "note", "notes") : null,
    m.files ? n(m.files, "file", "files") : null,
  ].filter((p): p is string => p !== null);
  if (parts.length <= 1) return parts[0] ?? "nothing";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

export interface ClubYouRun {
  id: string;
  name: string;
  slug: string;
}

/** The live clubs where the user can bring things in: OWNER or ADMIN. */
export async function clubsUserRuns(userId: string): Promise<ClubYouRun[]> {
  return withUserTx(userId, async ({ db }) =>
    (
      await db.membership.findMany({
        where: {
          userId,
          role: { in: [Role.OWNER, Role.ADMIN] },
          organization: { kind: OrgKind.CLUB, deletedAt: null },
        },
        select: { organization: { select: { id: true, name: true, slug: true } } },
        orderBy: { organization: { name: "asc" } },
      })
    ).map((m) => m.organization),
  );
}
