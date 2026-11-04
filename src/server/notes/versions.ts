import { historyCutoff, snapshotDue } from "@/lib/notes/history";
import type { MemberContext, TxClient } from "@/server/db/context";

/**
 * Version history (NoteVersion, docs/features/notes-sharing.md "History").
 *
 * Autosave snapshots are written on the service path after the save that
 * triggered them commits: a snapshot keeps the body as it was before the
 * save, recorded as its last editor's at its last edit (which a member
 * could not write as themselves), and the same transaction prunes the
 * note's snapshots older than the plan's history window. Named versions are
 * the member's own (version-actions.ts), under RLS.
 *
 * Only contentJson is kept: restoring applies it to the live document as an
 * ordinary edit (so live editors merge it), which never needs the old Yjs
 * state, and the bytes count toward the club's storage.
 */

export interface SnapshotSource {
  id: string;
  contentJson: unknown;
  contentText: string;
  updatedAt: Date;
  updatedById: string;
}

/** When the note's newest version (of either kind) was taken, or null. */
export async function lastVersionAt(
  db: TxClient,
  organizationId: string,
  noteId: string,
): Promise<Date | null> {
  const last = await db.noteVersion.findFirst({
    where: { organizationId, noteId },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  return last?.createdAt ?? null;
}

/**
 * Before a save replaces `before`: if no version was taken in the last
 * SNAPSHOT_INTERVAL_MS, keep `before` as an autosave snapshot once this
 * transaction commits. An empty body is not worth keeping.
 */
export async function snapshotBeforeSave(ctx: MemberContext, before: SnapshotSource) {
  if (!before.contentText?.trim()) return;
  const last = await lastVersionAt(ctx.db, ctx.organizationId, before.id);
  if (!snapshotDue(last)) return;
  const { organizationId, userId } = ctx;
  const snapshot = {
    organizationId,
    noteId: before.id,
    name: null,
    createdById: before.updatedById,
    contentJson: before.contentJson as object,
    createdAt: before.updatedAt,
  };
  ctx.afterCommit(() =>
    // Loaded here, not at the top: the save paths (and their tests) stay light.
    import("@/server/db/context").then(({ withSystemOrgTx }) =>
      withSystemOrgTx(organizationId, { userId }, async ({ db }) => {
        await db.noteVersion.create({ data: snapshot });
        await pruneSnapshots(db, organizationId, before.id);
      }),
    ),
  );
}

/**
 * Deletes the note's autosave snapshots older than the space's history
 * window (spaceLimits(...).noteHistoryDays). Named versions stay. The service path (app_user may not delete them).
 */
export async function pruneSnapshots(
  db: TxClient,
  organizationId: string,
  noteId: string,
  now: Date = new Date(),
): Promise<number> {
  const space = await db.organization.findUnique({
    where: { id: organizationId },
    select: { kind: true, plan: true, trialEndsAt: true, planAfterTrial: true },
  });
  if (!space) return 0;
  const result = await db.noteVersion.deleteMany({
    where: { organizationId, noteId, name: null, createdAt: { lt: historyCutoff(space, now) } },
  });
  return result.count;
}

/** The history list: everything but the bodies. */
export function listNoteVersions(db: TxClient, organizationId: string, noteId: string) {
  return db.noteVersion.findMany({
    where: { organizationId, noteId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      createdAt: true,
      sizeBytes: true,
      createdBy: { select: { id: true, name: true, image: true } },
    },
    take: 200,
  });
}

export type NoteVersionRow = Awaited<ReturnType<typeof listNoteVersions>>[number];
