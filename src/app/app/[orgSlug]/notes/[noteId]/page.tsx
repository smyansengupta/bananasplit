import type { JSONContent } from "@tiptap/react";
import { notFound } from "next/navigation";

import { NoteEditorShell } from "@/components/notes/note-editor-shell";
import { handleAuthErrorInPage } from "@/lib/auth/handle-auth-error";
import { collabConfig } from "@/lib/collab/config";
import { canEditNote } from "@/lib/notes/access";
import { mintNoteCollabSession } from "@/server/collab/session";
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

  const actor = { userId: user.id, organizationId: org.id, role, user };
  const canEdit = canEditNote(actor, note);
  // Live collaboration (docs/features/collaboration.md): the first token,
  // for a note RLS just returned to this user. Null while the flag is off,
  // which keeps the autosave editor.
  const config = collabConfig();
  const collab = config ? mintNoteCollabSession(config, actor, note) : null;

  return (
    <NoteEditorShell
      orgId={org.id}
      orgSlug={orgSlug}
      canEdit={canEdit}
      events={events}
      collab={collab}
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
