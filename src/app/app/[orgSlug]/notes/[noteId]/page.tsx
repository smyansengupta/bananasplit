import type { JSONContent } from "@tiptap/react";
import { notFound } from "next/navigation";

import { Role } from "@/generated/prisma/client";
import { handleAuthErrorInPage } from "@/lib/auth/handle-auth-error";
import { requireOrgMembership, type OrgContext } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";
import { NoteEditorShell } from "@/components/notes/note-editor-shell";

import { getNoteById, getOrgEventsForPicker } from "../queries";

export default async function NoteDetailPage({
  params,
}: PageProps<"/app/[orgSlug]/notes/[noteId]">) {
  const { orgSlug, noteId } = await params;

  const org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
  if (!org) {
    notFound();
  }

  let ctx: OrgContext;
  try {
    ctx = await requireOrgMembership(org.id);
  } catch (error) {
    handleAuthErrorInPage(error);
  }

  const note = await getNoteById(org.id, ctx.user.id, noteId);
  if (!note) {
    notFound();
  }

  const canEdit =
    note.authorId === ctx.user.id || ctx.role === Role.OWNER || ctx.role === Role.ADMIN;
  const events = await getOrgEventsForPicker(org.id);

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
