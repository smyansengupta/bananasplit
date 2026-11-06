import type { JSONContent } from "@tiptap/react";
import { notFound } from "next/navigation";

import { LinkedSection } from "@/components/links/linked-section";
import { NoteEditorShell } from "@/components/notes/note-editor-shell";
import { pinnedNoteChanged, summaryToSend, todosToTurn, uncheckedTodos } from "@/lib/ambient/files";
import { handleAuthErrorInPage } from "@/lib/auth/handle-auth-error";
import { isPersonalSpace, spaceIncludes } from "@/lib/billing/space";
import { collabConfig } from "@/lib/collab/config";
import { noteHistoryWindowDays } from "@/lib/notes/history";
import { canEditNote, canShareNote, generalAccessOf, toNoteAccess } from "@/lib/notes/access";
import { mintNoteCollabSession } from "@/server/collab/session";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { planGate } from "@/server/billing/plan-gate";
import { userPublicSelect } from "@/server/members";
import { lastVisitAt, linkedTaskTitles, meetingGoers } from "@/server/notes/ambient";
import { listNoteComments, toCommentDto } from "@/server/notes/comments";
import { listNoteShares } from "@/server/notes/sharing";
import { listBacklinks, listNoteTree } from "@/server/notes/tree";
import { listNoteVersions } from "@/server/notes/versions";
import { listPins } from "@/server/pins";

import { getNoteById, getOrgEventsForPicker } from "../queries";

export default async function NoteDetailPage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/notes/[noteId]">) {
  const { orgSlug, noteId } = await params;
  const query = await searchParams;
  const planLock = await planGate(orgSlug, "files");
  if (planLock) return planLock;
  const { organization: org, user, role } = await getOrgContextBySlug(orgSlug);

  const data = await withOrgTx(org.id, async ({ db }) => {
    const found = await getNoteById(db, org.id, user.id, noteId);
    // Skip the other queries for a missing (or invisible) note.
    if (!found) return null;
    const pins = await listPins(db, org.id, org.slug, user.id);
    const updatedBy = await db.user.findUnique({
      where: { id: found.updatedById },
      select: { name: true },
    });
    const versions = await listNoteVersions(db, org.id, found.id);
    // The page's ambient buttons (src/lib/ambient/files.ts says when).
    const access = toNoteAccess(found);
    const actor = { userId: user.id, organizationId: org.id, role, user };
    const shares = await listNoteShares(db, org.id, found.id);
    const meeting = found.eventId
      ? await db.event.findFirst({
          where: { id: found.eventId, organizationId: org.id, deletedAt: null },
          select: { endsAt: true },
        })
      : null;
    const href = `/app/${org.slug}/notes/${found.id}`;
    const ambient = {
      todos:
        spaceIncludes(org, "tasks") && canEditNote(actor, access)
          ? todosToTurn(
              uncheckedTodos(found.contentJson),
              await linkedTaskTitles(db, org.id, found.id),
            )
          : null,
      summary:
        meeting && !isPersonalSpace(org)
          ? summaryToSend({
              canShare: canShareNote(actor, access),
              meetingEndsAt: meeting.endsAt,
              now: new Date(),
              text: found.contentText,
              went: await meetingGoers(db, org.id, found.eventId!),
              sharedWith: shares.map((s) => s.userId),
              authorId: found.authorId,
              viewerId: user.id,
            })
          : null,
      // Recorded after the page shows, so this is the visit before this one.
      changes: pinnedNoteChanged({
        pinned: pins.some((p) => p.href === href),
        lastVisitAt: await lastVisitAt(db, org.id, user.id, href),
        updatedAt: found.updatedAt,
        updatedById: found.updatedById,
        updatedByName: updatedBy?.name ?? null,
        viewerId: user.id,
        versions,
      }),
    };
    return {
      ambient,
      note: found,
      events: await getOrgEventsForPicker(db, org.id),
      shares,
      // The share dialog's people picker and @mentions: names and pictures only.
      members: (
        await db.membership.findMany({
          where: { organizationId: org.id },
          select: { user: { select: userPublicSelect } },
        })
      )
        .map((m) => m.user)
        .sort((a, b) =>
          (a.name ?? "").localeCompare(b.name ?? "", undefined, { sensitivity: "base" }),
        ),
      tree: await listNoteTree(db, org.id, user.id),
      backlinks: await listBacklinks(db, org.id, user.id, found.id),
      comments: (await listNoteComments(db, org.id, found.id)).map(toCommentDto),
      versions: versions.map((v) => ({
        ...v,
        createdAt: v.createdAt.toISOString(),
      })),
      favoriteIds: pins
        .map((p) => /\/notes\/([A-Za-z0-9_-]+)$/.exec(p.href)?.[1])
        .filter((id): id is string => Boolean(id)),
      updatedByName: updatedBy?.name ?? null,
    };
  }).catch(handleAuthErrorInPage);
  if (!data) {
    notFound();
  }
  const { note, events, shares, members } = data;

  const access = toNoteAccess(note);
  const actor = { userId: user.id, organizationId: org.id, role, user };
  const canEdit = canEditNote(actor, access);
  // Live collaboration (docs/features/collaboration.md): the first token,
  // for a note RLS just returned to this user. Null while it is off, which
  // keeps the autosave editor.
  const config = collabConfig();
  const collab = config ? mintNoteCollabSession(config, actor, access) : null;
  const focus = typeof query.comment === "string" ? query.comment : null;

  return (
    <NoteEditorShell
      orgId={org.id}
      orgSlug={orgSlug}
      linked={<LinkedSection orgId={org.id} orgSlug={orgSlug} at={{ kind: "note", id: note.id }} />}
      canEdit={canEdit}
      events={events}
      collab={collab}
      personal={isPersonalSpace(org)}
      canMakeTasks={!isPersonalSpace(org) || spaceIncludes(org, "ai")}
      ambient={{
        todos: data.ambient.todos
          ? { count: data.ambient.todos.todos.length, reason: data.ambient.todos.reason }
          : null,
        summary: data.ambient.summary ? { reason: data.ambient.summary.reason } : null,
        changes: data.ambient.changes,
      }}
      sharing={{
        canShare: canShareNote(actor, access),
        isAuthor: access.authorId === user.id,
        viewerId: user.id,
        myRole: access.shareRole,
        author: { id: note.author.id, name: note.author.name, image: note.author.image },
        generalAccess: generalAccessOf(access),
        shares,
        members,
      }}
      note={{
        id: note.id,
        title: note.title,
        contentJson: note.contentJson as JSONContent,
        contentText: note.contentText,
        visibility: note.visibility,
        eventId: note.eventId,
        version: note.version,
      }}
      workspace={{
        orgName: org.name,
        pages: data.tree.map((p) => ({
          id: p.id,
          title: p.title,
          icon: p.icon,
          parentId: p.parentId,
        })),
        favoriteIds: data.favoriteIds,
        backlinks: data.backlinks,
        comments: data.comments,
        versions: data.versions,
        icon: note.icon,
        parentId: note.parentId,
        layout: note.layout,
        paperSize: note.paperSize,
        headerText: note.headerText,
        footerText: note.footerText,
        updatedAt: note.updatedAt.toISOString(),
        updatedByName: data.updatedByName,
        historyDays: noteHistoryWindowDays(org),
        focusCommentId: focus && data.comments.some((c) => c.id === focus) ? focus : null,
      }}
    />
  );
}
