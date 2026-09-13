"use server";

import { z } from "zod";

import { NoteVisibility, Role } from "@/generated/prisma/client";
import { withOrgContext } from "@/lib/auth/with-org-context";
import type { OrgContext } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";

const NOTE_VISIBILITY_VALUES = Object.values(NoteVisibility) as [
  NoteVisibility,
  ...NoteVisibility[],
];

const EMPTY_DOC = { type: "doc", content: [{ type: "paragraph" }] };

const noteUpdateSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(300),
  // JSON-encoded ProseMirror document, not a plain object: passing the raw
  // object as a Server Action argument intermittently fails ("temporary
  // client reference") for large/deeply nested payloads, so the client
  // stringifies it and this parses it back after validation.
  contentJson: z.string().max(2_000_000),
  contentText: z.string().max(200_000),
  visibility: z.enum(NOTE_VISIBILITY_VALUES),
  eventId: z.string().nullable(),
});

export type NoteUpdateInput = z.infer<typeof noteUpdateSchema>;

interface ActionResult {
  error?: string;
  conflict?: boolean;
  noteId?: string;
  version?: number;
}

/** Anyone can edit their own note; OWNER/ADMIN can edit any note they can see. */
function canEditNote(ctx: OrgContext, note: { authorId: string }) {
  return note.authorId === ctx.user.id || ctx.role === Role.OWNER || ctx.role === Role.ADMIN;
}

function isVisibleToUser(userId: string, note: { visibility: NoteVisibility; authorId: string }) {
  return note.visibility === NoteVisibility.ORGANIZATION || note.authorId === userId;
}

async function assertEventBelongsToOrg(organizationId: string, eventId: string | null) {
  if (!eventId) return null;
  const event = await prisma.event.findFirst({
    where: { id: eventId, organizationId, deletedAt: null },
    select: { id: true },
  });
  return event ? null : "That event doesn't exist in this organization.";
}

export const createNote = withOrgContext(
  async (ctx, prefill?: { title?: string; eventId?: string }): Promise<ActionResult> => {
    if (prefill?.eventId) {
      const eventError = await assertEventBelongsToOrg(ctx.organizationId, prefill.eventId);
      if (eventError) return { error: eventError };
    }

    const note = await prisma.note.create({
      data: {
        organizationId: ctx.organizationId,
        title: prefill?.title?.trim() || "Untitled note",
        contentJson: EMPTY_DOC,
        contentText: "",
        visibility: NoteVisibility.PRIVATE,
        authorId: ctx.user.id,
        updatedById: ctx.user.id,
        eventId: prefill?.eventId ?? null,
      },
    });
    return { noteId: note.id };
  },
);

export const updateNote = withOrgContext(
  async (ctx, noteId: string, input: unknown, expectedVersion: number): Promise<ActionResult> => {
    const existing = await prisma.note.findFirst({
      where: { id: noteId, organizationId: ctx.organizationId, deletedAt: null },
    });
    if (!existing || !isVisibleToUser(ctx.user.id, existing)) {
      return { error: "Note not found." };
    }
    if (!canEditNote(ctx, existing)) {
      return { error: "You don't have permission to edit this note." };
    }

    const parsed = noteUpdateSchema.safeParse(input);
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
    }
    const data = parsed.data;

    let contentJson: object;
    try {
      contentJson = JSON.parse(data.contentJson);
    } catch {
      return { error: "Invalid note content." };
    }

    const eventError = await assertEventBelongsToOrg(ctx.organizationId, data.eventId);
    if (eventError) return { error: eventError };

    const result = await prisma.note.updateMany({
      where: { id: noteId, organizationId: ctx.organizationId, version: expectedVersion },
      data: {
        title: data.title,
        contentJson,
        contentText: data.contentText,
        visibility: data.visibility,
        eventId: data.eventId,
        updatedById: ctx.user.id,
        version: { increment: 1 },
      },
    });

    if (result.count === 0) {
      return { error: "This note was updated by someone else — reload.", conflict: true };
    }

    return { noteId, version: expectedVersion + 1 };
  },
);

export const deleteNote = withOrgContext(async (ctx, noteId: string): Promise<ActionResult> => {
  const existing = await prisma.note.findFirst({
    where: { id: noteId, organizationId: ctx.organizationId, deletedAt: null },
  });
  if (!existing || !isVisibleToUser(ctx.user.id, existing)) {
    return { error: "Note not found." };
  }
  if (!canEditNote(ctx, existing)) {
    return { error: "You don't have permission to delete this note." };
  }

  await prisma.note.update({ where: { id: noteId }, data: { deletedAt: new Date() } });
  return {};
});

export const restoreNote = withOrgContext(async (ctx, noteId: string): Promise<ActionResult> => {
  const existing = await prisma.note.findFirst({
    where: { id: noteId, organizationId: ctx.organizationId },
  });
  if (!existing || !isVisibleToUser(ctx.user.id, existing)) {
    return { error: "Note not found." };
  }
  if (!canEditNote(ctx, existing)) {
    return { error: "You don't have permission to restore this note." };
  }

  await prisma.note.update({ where: { id: noteId }, data: { deletedAt: null } });
  return {};
});
