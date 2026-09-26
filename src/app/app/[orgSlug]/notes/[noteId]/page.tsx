import type { JSONContent } from "@tiptap/react";
import { notFound } from "next/navigation";

import { NoteEditorShell } from "@/components/notes/note-editor-shell";
import { handleAuthErrorInPage } from "@/lib/auth/handle-auth-error";
import { can } from "@/lib/auth/permissions";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";

import { getNoteById, getOrgEventsForPicker } from "../queries";

export default async function NoteDetailPage({
  params,
}: PageProps<"/app/[orgSlug]/notes/[noteId]">) {
  const { orgSlug, noteId } = await params;
  const { organization: org, user, role } = await getOrgContextBySlug(orgSlug);

  const { note, events } = await withOrgTx(org.id, async ({ db }) => {
    const found = await getNoteById(db, org.id, user.id, noteId);
    // Skip the picker query for a missing (or invisible) note.
    return { note: found, events: found ? await getOrgEventsForPicker(db, org.id) : [] };
  }).catch(handleAuthErrorInPage);
  if (!note) {
    notFound();
  }

  const canEdit = note.authorId === user.id || can({ role }, "notes.manageAll");

  return (
    <NoteEditorShell
      orgId={org.id}
      orgSlug={orgSlug}
      canEdit={canEdit}
      events={events}
      note={{
        id: note.id,
        title: note.title,
        contentJson: note.contentJson as JSONContent,
        contentText: note.contentText,
        visibility: note.visibility,
        eventId: note.eventId,
        version: note.version,
      }}
    />
  );
}
