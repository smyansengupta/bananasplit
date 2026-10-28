import type { Metadata } from "next";

import { SpaceStorageBanner } from "@/components/billing/space-storage-banner";
import { StorageChip } from "@/components/billing/storage-chip";
import { FilesDropZone } from "@/components/notes/files-drop-zone";
import { NotesLibrary } from "@/components/notes/notes-library";
import { NotesNewMenu } from "@/components/notes/notes-new-menu";
import { PageHeader } from "@/components/page-header";
import { handleAuthErrorInPage } from "@/lib/auth/handle-auth-error";
import { can } from "@/lib/auth/permissions";
import { isPersonalSpace, spaceLimits } from "@/lib/billing/space";
import { sectionLabel } from "@/lib/nav/sidebar";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { listDeletedNoteFiles, listNoteFiles } from "@/server/notes/files";
import { folderPeeks, listFolders } from "@/server/notes/folders";
import { countNoteShares } from "@/server/notes/sharing";
import { noteVisibleWhere } from "@/server/notes/visibility";
import { listPins } from "@/server/pins";
import { planGate } from "@/server/billing/plan-gate";
import { canManageStorage, readStorageUsed } from "@/server/storage/quota";
import { storageBreakdown } from "@/server/storage/usage";

import { NotesFilterChoices, NotesListFilters } from "./notes-list-filters";
import {
  countDeleted,
  getDeletedNotes,
  getNotesForList,
  getOrgMembersForFilter,
  NOTE_SORTS,
  type NoteSort,
} from "./queries";

export const metadata: Metadata = { title: "Files" };

/**
 * Files (at /notes): the club's notes and uploaded files in one list, filed
 * in shared folders. "New" starts a blank note or a template, turns a Word
 * document or Google Doc into a note (previewed first), uploads a file, or
 * makes a folder. In Personal they're all its owner's, with no sharing.
 */
export default async function NotesPage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/notes">) {
  const { orgSlug } = await params;
  const planLock = await planGate(orgSlug, "files");
  if (planLock) return planLock;
  const query = await searchParams;
  const { organization: org, user, role, settings } = await getOrgContextBySlug(orgSlug);
  // `tab` narrows the list to one kind; without it, notes and files show together.
  const kind = query.tab === "files" || query.tab === "notes" ? query.tab : "all";
  const isAdmin = can({ role }, "settings.view");
  const personal = isPersonalSpace(org);

  const str = (v: unknown) => (typeof v === "string" && v !== "all" ? v : undefined);
  const visibility = str(query.visibility) as "PRIVATE" | "ORGANIZATION" | "SHARED" | undefined;
  const author = str(query.author);
  const inTrash = query.folder === "trash";
  const folderId = inTrash ? undefined : str(query.folder);
  const q = str(query.q);
  // Everything is the root of the Files tree: its folders at the top, then
  // only what is in no folder. It used to list every item wherever it was
  // filed, so moving a file into a folder left it showing in Everything as
  // well - which looked exactly like the move had made a copy. A search still
  // looks everywhere, folders included.
  const atRoot = !inTrash && !folderId && !q;
  const listFolderId = atRoot ? "none" : folderId;
  const sort = (NOTE_SORTS as readonly string[]).includes(String(query.sort))
    ? (query.sort as NoteSort)
    : "edited";

  const data = await withOrgTx(org.id, async ({ db }) => {
    const folders = await listFolders(db, org.id, user.id);
    const notes = await getNotesForList(db, org.id, user.id, {
      visibility,
      authorId: author,
      folderId: listFolderId,
      q,
      sort,
    });
    return {
      notes,
      shareCounts: await countNoteShares(
        db,
        org.id,
        notes.map((n) => n.id),
      ),
      files: await listNoteFiles(db, org.id, { folderId: listFolderId, q }),
      memberships: await getOrgMembersForFilter(db, org.id),
      folders,
      // What each folder card names, only where the cards are drawn.
      peeks: atRoot
        ? await folderPeeks(
            db,
            org.id,
            user.id,
            folders.map((f) => f.id),
          )
        : new Map(),
      pins: await listPins(db, org.id, org.slug, user.id),
      trash: inTrash
        ? {
            notes: await getDeletedNotes(db, org.id, user.id, isAdmin),
            files: await listDeletedNoteFiles(db, org.id, user.id, isAdmin),
          }
        : null,
      trashCount: await countDeleted(db, org.id, user.id, isAdmin),
      totals: {
        notes: await db.note.count({
          where: {
            organizationId: org.id,
            deletedAt: null,
            ...noteVisibleWhere(user.id),
          },
        }),
        files: await db.orgFile.count({ where: { organizationId: org.id, deletedAt: null } }),
        unfiled:
          (await db.note.count({
            where: {
              organizationId: org.id,
              deletedAt: null,
              folderId: null,
              ...noteVisibleWhere(user.id),
            },
          })) +
          (await db.orgFile.count({
            where: { organizationId: org.id, deletedAt: null, folderId: null },
          })),
      },
    };
  }).catch(handleAuthErrorInPage);

  const limits = spaceLimits(org);
  const [usedBytes, storageParts] = await Promise.all([
    readStorageUsed(org.id),
    storageBreakdown(org.id),
  ]);
  const storage = {
    usedBytes,
    limitBytes: limits.storageBytes,
    maxFileBytes: limits.maxFileBytes,
    canManage: canManageStorage(role),
  };
  const uploadFolder = folderId && folderId !== "none" ? folderId : null;

  const members = data.memberships.map((m) => ({
    userId: m.userId,
    name: m.user.name,
    email: m.user.email,
  }));
  // The notes query applies these filters itself; files get the same ones here.
  const files = data.files.filter(
    (f) => (!visibility || f.visibility === visibility) && (!author || f.uploadedBy.id === author),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={sectionLabel(settings?.sidebar, "notes")}
        actions={
          <>
            {/* The space's storage, split by what uses it, beside the create button. */}
            <StorageChip
              usedBytes={storage.usedBytes}
              limitBytes={storage.limitBytes}
              maxFileBytes={storage.maxFileBytes}
              parts={storageParts}
              personal={personal}
              href={storage.canManage ? `/app/${orgSlug}/settings/plan/storage` : null}
            />
            <NotesNewMenu
              orgId={org.id}
              orgSlug={orgSlug}
              folders={data.folders.map((f) => ({ id: f.id, name: f.name }))}
              currentFolderId={uploadFolder}
              maxFileBytes={storage.maxFileBytes}
              personal={personal}
            />
          </>
        }
      />
      <SpaceStorageBanner orgSlug={orgSlug} />
      {/* Notes-only view and the trash take no uploads. */}
      {kind !== "notes" && !inTrash && (
        <FilesDropZone
          orgId={org.id}
          folderId={uploadFolder}
          storage={storage}
          personal={personal}
        />
      )}
      <NotesLibrary
        orgId={org.id}
        orgSlug={orgSlug}
        kind={kind}
        folders={data.folders.map((f) => ({
          id: f.id,
          name: f.name,
          color: f.color,
          noteCount: f.noteCount,
          fileCount: f.fileCount,
          peek: data.peeks.get(f.id) ?? [],
          canEdit: isAdmin || f.createdById === user.id,
        }))}
        notes={data.notes.map((n) => ({
          id: n.id,
          title: n.title,
          icon: n.icon,
          snippet: n.contentText.trim().slice(0, 400),
          visibility: n.visibility,
          updatedAt: n.updatedAt,
          createdAt: n.createdAt,
          authorName: n.author.name ?? n.author.email,
          eventTitle: n.event?.title ?? null,
          folderId: n.folderId,
          canMove: isAdmin || n.authorId === user.id,
          shareCount: data.shareCounts.get(n.id) ?? 0,
          sharedWithMe: n.authorId !== user.id && n.visibility === "PRIVATE",
          memberCanEdit: n.memberCanEdit,
        }))}
        files={files.map((f) => ({
          id: f.id,
          name: f.name,
          contentType: f.contentType,
          sizeBytes: f.sizeBytes,
          visibility: f.visibility,
          createdAt: f.createdAt,
          uploaderName: f.uploadedBy.name ?? "A member",
          excerpt: f.excerpt,
          folderId: f.folderId,
          canMove: isAdmin || f.uploadedBy.id === user.id,
        }))}
        pinnedHrefs={data.pins.map((p) => p.href)}
        totals={{ ...data.totals, trash: data.trashCount }}
        trash={
          data.trash && {
            notes: data.trash.notes.map((n) => ({
              id: n.id,
              title: n.title,
              visibility: n.visibility,
              deletedAt: n.deletedAt!,
              authorName: n.author.name ?? n.author.email,
            })),
            files: data.trash.files,
          }
        }
        filters={<NotesListFilters members={members} personal={personal} />}
        sheetFilters={<NotesFilterChoices members={members} personal={personal} />}
        personal={personal}
      />
    </div>
  );
}
