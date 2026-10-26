import { formatStorage, formatUsed } from "@/lib/billing/storage";
import { applyContentToState, InvalidNoteContentError } from "@/lib/collab/note-doc";
import { withOrgTx } from "@/server/db/context";
import { deleteBlobs, getBlob, putBlob, randomKeyId } from "@/server/storage";
import { crossedWarning, gateUpload, warnStorage, type StorageRow } from "@/server/storage/quota";

/**
 * The Files half of moving Personal items into a club
 * (app.move_personal_items, 20261023120000_move_personal_files). Notes keep
 * their rows, but an upload's bytes are stored under its space's id
 * (files/{orgId}/...), and a note's images link to them by that id
 * (/api/orgs/{orgId}/files/{fileId}) in its body and in its live document.
 * So before the move, outside any transaction:
 *
 *   1. find what the function will take: the picked notes and folders, every
 *      live sub-page under a moving note, and the live uploads that are
 *      picked, in a picked folder or shown in a moving note (the same
 *      queries as the function's);
 *   2. the club's upload gate: it isn't paused, takes each file's size, and
 *      has room for the uploads and the notes' history;
 *   3. each moving note with a live document gets that document rebuilt
 *      with its upload links pointed at the club (applyContentToState, the
 *      same edit an autosave makes, so comment anchors keep their places);
 *   4. each upload is copied to files/{clubId}/{new id}.
 *
 * The function re-derives the set and refuses (40001) when a copy or a
 * rebuilt document is missing, so a change in between never moves a file
 * without its bytes. After commit, settleFiles() deletes the Personal
 * copies (and any copy the move didn't take) and tells the club's owners
 * and admins if it passed 80% of its storage. A failed move discards the
 * copies (discardCopies()).
 */

export interface FilesPick {
  noteIds: string[];
  folderIds: string[];
  fileIds: string[];
}

interface Copy {
  fileId: string;
  /** The Personal space's key, deleted once the move commits. */
  from: string;
  /** The club's key, deleted again if the move doesn't take it. */
  to: string;
}

export interface PreparedFiles {
  /** p_file_keys: {fileId: the club's storage key}. */
  keys: Record<string, string>;
  /** p_note_states: {noteId: {state (base64, or null to drop it), version}}. */
  states: Record<string, { state: string | null; version: number }>;
  copies: Copy[];
  /** What the move adds to the club's storage: the uploads and the notes' history. */
  bytes: number;
  /** The club's storage row and limit, as the gate read them. */
  space: StorageRow;
  limitBytes: number;
}

export type PrepareResult = { ok: true; files: PreparedFiles } | { ok: false; error: string };

/** The club has no room after all (read in the move's transaction): rolls it back. */
export class ClubFullError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClubFullError";
  }
}

export function roomMessage(
  clubName: string,
  usedBytes: number,
  limitBytes: number,
  bytes: number,
): string {
  return `${clubName} doesn't have room for these (${formatStorage(bytes)}): ${formatUsed(usedBytes, limitBytes)} of ${formatStorage(limitBytes)} used. Empty its trash or upgrade, or bring fewer.`;
}

/** Steps 1 to 4 above. Throws NotFoundError when the caller isn't in the club. */
export async function prepareFiles(
  personalId: string,
  clubId: string,
  pick: FilesPick,
): Promise<PrepareResult> {
  const apiFrom = `/api/orgs/${personalId}/files/`;
  const apiTo = `/api/orgs/${clubId}/files/`;

  const found = await withOrgTx(personalId, async ({ db }) => {
    const noteIds = (
      await db.$queryRaw<{ id: string }[]>`
        WITH RECURSIVE tree AS (
          SELECT n."id" FROM "Note" n
           WHERE n."organizationId" = ${personalId} AND n."deletedAt" IS NULL
             AND (n."id" = ANY (${pick.noteIds}::text[]) OR n."folderId" = ANY (${pick.folderIds}::text[]))
          UNION
          SELECT c."id" FROM "Note" c JOIN tree ON c."parentId" = tree."id"
           WHERE c."organizationId" = ${personalId} AND c."deletedAt" IS NULL
        ) SELECT "id" FROM tree`
    ).map((r) => r.id);
    const files = await db.$queryRaw<
      { id: string; name: string; storageKey: string; contentType: string; sizeBytes: number }[]
    >`
      SELECT f."id", f."name", f."storageKey", f."contentType", f."sizeBytes" FROM "OrgFile" f
       WHERE f."organizationId" = ${personalId} AND f."deletedAt" IS NULL
         AND (f."id" = ANY (${pick.fileIds}::text[]) OR f."folderId" = ANY (${pick.folderIds}::text[])
              OR f."id" IN (SELECT jsonb_path_query(n."contentJson", 'lax $.**.fileId') #>> '{}'
                              FROM "Note" n WHERE n."id" = ANY (${noteIds}::text[])))`;
    // Notes whose live document links an upload: it is rebuilt below.
    const linkedIds = (
      await db.$queryRaw<{ id: string }[]>`
        SELECT n."id" FROM "Note" n
         WHERE n."id" = ANY (${noteIds}::text[]) AND n."yjsState" IS NOT NULL
           AND strpos(n."contentJson"::text, ${apiFrom}) > 0`
    ).map((r) => r.id);
    const linked = linkedIds.length
      ? await db.note.findMany({
          where: { organizationId: personalId, id: { in: linkedIds } },
          select: { id: true, version: true, contentJson: true, yjsState: true },
        })
      : [];
    const history = noteIds.length
      ? await db.noteVersion.aggregate({
          where: { organizationId: personalId, noteId: { in: noteIds } },
          _sum: { sizeBytes: true },
        })
      : null;
    return { files, linked, historyBytes: history?._sum.sizeBytes ?? 0 };
  });

  // The club's gate, as for an upload: the space first, then each file, then the room.
  const gate = await gateUpload(clubId, 0, { feature: "files" });
  if (gate.refusal) return { ok: false, error: gate.refusal.error };
  const tooBig = found.files.find((f) => f.sizeBytes > gate.state.maxFileBytes);
  if (tooBig) {
    return {
      ok: false,
      error: `“${tooBig.name}” is ${formatStorage(tooBig.sizeBytes)}. ${gate.space.name} takes files up to ${formatStorage(gate.state.maxFileBytes)}.`,
    };
  }
  const bytes = found.files.reduce((sum, f) => sum + f.sizeBytes, 0) + found.historyBytes;
  if (bytes > 0 && gate.state.usedBytes + bytes > gate.state.limitBytes) {
    return {
      ok: false,
      error: roomMessage(gate.space.name, gate.state.usedBytes, gate.state.limitBytes, bytes),
    };
  }

  const states: PreparedFiles["states"] = {};
  for (const note of found.linked) {
    const json: unknown = JSON.parse(JSON.stringify(note.contentJson).split(apiFrom).join(apiTo));
    let state: string | null = null;
    try {
      state = Buffer.from(applyContentToState(new Uint8Array(note.yjsState!), json)).toString(
        "base64",
      );
    } catch (error) {
      // Legacy content off the schema: the live document is rebuilt from contentJson instead.
      if (!(error instanceof InvalidNoteContentError)) throw error;
    }
    states[note.id] = { state, version: note.version };
  }

  const copies: Copy[] = [];
  try {
    for (const file of found.files) {
      const blob = await getBlob(file.storageKey);
      if (!blob) {
        await discardCopies({ copies });
        return {
          ok: false,
          error: `“${file.name}” has lost its contents, so it can't move. Delete it from Files, then try again.`,
        };
      }
      const stored = await putBlob("files", clubId, [randomKeyId()], blob.body, {
        contentType: file.contentType,
      });
      copies.push({ fileId: file.id, from: file.storageKey, to: stored.key });
    }
  } catch (error) {
    await discardCopies({ copies });
    throw error;
  }

  return {
    ok: true,
    files: {
      keys: Object.fromEntries(copies.map((c) => [c.fileId, c.to])),
      states,
      copies,
      bytes,
      space: gate.space,
      limitBytes: gate.state.limitBytes,
    },
  };
}

/** A move that didn't happen: the club's copies go. */
export async function discardCopies(files: Pick<PreparedFiles, "copies">): Promise<void> {
  if (files.copies.length === 0) return;
  await deleteBlobs(files.copies.map((c) => c.to)).catch((error) =>
    console.error("[move] could not delete the club's copies", error),
  );
}

/** After commit: the Personal copies of what moved go (and the club's of what didn't), then the 80% notice. */
export async function settleFiles(
  files: PreparedFiles,
  moved: { fileIds: string[]; storageUsedBytes: number },
): Promise<void> {
  const took = new Set(moved.fileIds);
  const gone = files.copies.map((c) => (took.has(c.fileId) ? c.from : c.to));
  // Left behind, they are only orphans: the storage sweep removes them later.
  if (gone.length) {
    await deleteBlobs(gone).catch((error) =>
      console.error("[move] could not delete moved files' old copies", error),
    );
  }
  const after = moved.storageUsedBytes;
  const before = Math.max(0, after - files.bytes);
  if (crossedWarning(files.space, { before, after })) {
    await withOrgTx(files.space.id, ({ db }) =>
      warnStorage(db, files.space, after, `personal-move:${files.copies[0]?.fileId ?? after}`),
    ).catch((error) => console.error("[move] storage notice failed", error));
  }
}
