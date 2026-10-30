"use server";

import { z } from "zod";

import {
  NoteLayout,
  NoteShareRole,
  NoteVisibility,
  NotificationType,
  PaperSize,
} from "@/generated/prisma/client";
import { collabConfig } from "@/lib/collab/config";
import { MAX_BAND_TEXT } from "@/lib/notes/paper";
import { applyContentToState, InvalidNoteContentError, seedNoteState } from "@/lib/collab/note-doc";
import {
  canEditNote,
  canShareNote,
  fromGeneralAccess,
  type NoteGeneralAccess,
} from "@/lib/notes/access";
import { revokeNoteSessions } from "@/server/collab/revoke";
import { mintNoteCollabSession, type NoteCollabSession } from "@/server/collab/session";
import { withOrgAction, type OrgContext } from "@/server/db/context";
import {
  assertEventBelongsToOrg,
  createNote as createNoteIn,
  EMPTY_NOTE_DOC,
  parentFor,
} from "@/server/notes/create";
import { listNoteShares, type NoteShareRow } from "@/server/notes/sharing";
import { loadNote } from "@/server/notes/load";
import { snapshotBeforeSave } from "@/server/notes/versions";
import { notifyUsers } from "@/server/notifications";

/** Every action here belongs to files (withOrgAction's space check). */
const filesAction: typeof withOrgAction = (handler, options) =>
  withOrgAction(handler, { onRefused: "return", ...options, feature: "files" });

/**
 * Note actions (0C). Each runs in one withOrgAction transaction as app_user,
 * so RLS repeats the rules checked here (src/lib/notes/access.ts): a
 * PRIVATE note is visible only to its author and the people it is shared
 * with; editors are its author, its EDITOR shares, and on a club note every
 * member when it lets them (else owners and admins); only the author (or an
 * owner/admin, on a club note) shares or deletes it (policy 6.8, immutable
 * authorId, app.note_sharing_guard). Error semantics: every action returns
 * its { error } before its first write, so nothing commits on an error path.
 *
 * Live collaboration (docs/features/collaboration.md) adds three things:
 * issueNoteCollabToken; updateNoteDetails, the live editor's save for the
 * title, visibility and event (its body saves through the collaboration
 * server); and in updateNote, keeping a note's Yjs state in step with an
 * autosave, so a live session merges the autosave instead of losing it.
 */

const NOTE_VISIBILITY_VALUES = Object.values(NoteVisibility) as [
  NoteVisibility,
  ...NoteVisibility[],
];

const titleSchema = z.string().trim().min(1, "Title is required").max(300);

const noteUpdateSchema = z.object({
  title: titleSchema,
  // JSON-encoded ProseMirror document, not a plain object: passing the raw
  // object as a Server Action argument intermittently fails ("temporary
  // client reference") for large/deeply nested payloads, so the client
  // stringifies it and this parses it back after validation.
  contentJson: z.string().max(2_000_000),
  contentText: z.string().max(200_000),
  // Who sees it is the share dialog's (updateNoteAccess); an editor's save
  // leaves it out. Still taken from the author, for older clients.
  visibility: z.enum(NOTE_VISIBILITY_VALUES).optional(),
  eventId: z.string().nullable(),
});

export type NoteUpdateInput = z.infer<typeof noteUpdateSchema>;

/** A partial update of everything but the body (the live editor's metadata save). */
const noteDetailsSchema = z.object({
  title: titleSchema.optional(),
  visibility: z.enum(NOTE_VISIBILITY_VALUES).optional(),
  eventId: z.string().nullable().optional(),
});

export type NoteDetailsInput = z.infer<typeof noteDetailsSchema>;

const noteIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "Invalid id");

/**
 * The page's own settings: its icon, Page or Document layout, paper,
 * Document mode's header and footer text ("" for the default), and the page
 * it sits inside. Not the body, so no version bump: an autosave
 * editor keeps saving, and the last change wins per field.
 */
const bandTextSchema = z
  .string()
  .trim()
  .max(MAX_BAND_TEXT, `Keep it under ${MAX_BAND_TEXT} characters.`)
  .nullable()
  .optional();

const noteSettingsSchema = z.object({
  icon: z.string().trim().max(32).nullable().optional(),
  layout: z.enum([NoteLayout.PAGE, NoteLayout.DOCUMENT]).optional(),
  paperSize: z.enum([PaperSize.LETTER, PaperSize.A4]).optional(),
  headerText: bandTextSchema,
  footerText: bandTextSchema,
  parentId: noteIdSchema.nullable().optional(),
});

export type NoteSettingsInput = z.infer<typeof noteSettingsSchema>;

interface ActionResult {
  error?: string;
  conflict?: boolean;
  noteId?: string;
  version?: number;
}

const NOT_FOUND = "Note not found.";
const NO_SHARING =
  "Only the note's author (or an admin, on an organization note) can change who has access.";

/**
 * A note whose access changed (turned PRIVATE, deleted, shared differently):
 * close its live sessions after commit, so everyone reconnects with a fresh
 * token, and whoever lost access is refused.
 */
function revokeAfterCommit(ctx: OrgContext, noteId: string) {
  ctx.afterCommit(() => revokeNoteSessions(ctx.organizationId, noteId));
}

/** A new empty note (src/server/notes/create.ts says where it starts and who sees it). */
export const createNote = filesAction(
  async (
    ctx,
    prefill?: { title?: string; eventId?: string; parentId?: string | null },
  ): Promise<ActionResult> =>
    createNoteIn(ctx, {
      title: prefill?.title,
      eventId: prefill?.eventId,
      parentId: prefill?.parentId,
    }),
);

const importSchema = z.object({
  title: titleSchema,
  contentJson: z.string().max(2_000_000),
  contentText: z.string().max(200_000),
  folderId: z.string().max(64).nullable().optional(),
  visibility: z.enum(NOTE_VISIBILITY_VALUES).optional(),
  /** A page to put it inside (a template started from the page tree). */
  parentId: noteIdSchema.nullable().optional(),
});

/**
 * A note made from an imported Word document or Google Doc: the browser
 * turned the document into the editor's JSON; it is checked against the
 * note schema here (the same check a live edit gets) before it is stored.
 * Imported notes (and ones started from a template) start PRIVATE unless
 * the member picked otherwise, optionally in a folder.
 */
export const importNote = filesAction(async (ctx, input: unknown): Promise<ActionResult> => {
  const parsed = importSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  let contentJson: object;
  let state: Uint8Array;
  try {
    contentJson = JSON.parse(parsed.data.contentJson);
    state = applyContentToState(seedNoteState(EMPTY_NOTE_DOC), contentJson);
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof InvalidNoteContentError) {
      return { error: "That document couldn't be turned into a note." };
    }
    throw error;
  }
  const folderId = parsed.data.folderId ?? null;
  if (folderId) {
    const folder = await ctx.db.noteFolder.findFirst({
      where: { id: folderId, organizationId: ctx.organizationId },
      select: { id: true },
    });
    if (!folder) return { error: "That folder no longer exists." };
  }
  const { parent, error: parentError } = await parentFor(ctx, parsed.data.parentId);
  if (parentError) return { error: parentError };
  const note = await ctx.db.note.create({
    data: {
      organizationId: ctx.organizationId,
      title: parsed.data.title,
      contentJson,
      contentText: parsed.data.contentText,
      visibility: parsed.data.visibility ?? NoteVisibility.PRIVATE,
      folderId,
      parentId: parent?.id ?? null,
      authorId: ctx.userId,
      updatedById: ctx.userId,
      ...(collabConfig() ? { yjsState: new Uint8Array(state) } : {}),
    },
    select: { id: true },
  });
  return { noteId: note.id };
});

export const updateNote = filesAction(
  async (ctx, noteId: string, input: unknown, expectedVersion: number): Promise<ActionResult> => {
    const existing = await loadNote(ctx, noteId);
    if (!existing) return { error: NOT_FOUND };
    if (!canEditNote(ctx, existing)) {
      return { error: "You don't have permission to edit this note." };
    }

    const parsed = noteUpdateSchema.safeParse(input);
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
    }
    const data = parsed.data;
    const visibility = data.visibility ?? existing.visibility;
    if (visibility !== existing.visibility && !canShareNote(ctx, existing)) {
      return { error: NO_SHARING };
    }

    let contentJson: object;
    try {
      contentJson = JSON.parse(data.contentJson);
    } catch {
      return { error: "Invalid note content." };
    }

    // A note with a Yjs state (it has been edited live) gets this autosave
    // applied to that state as an edit, so a live session merges it rather
    // than loses it. With collaboration on, a note without one gets its
    // state now (seeded from the content this save replaces), for the same
    // reason. With collaboration off and no state, nothing changes here.
    let yjsState: Uint8Array | undefined;
    const base = existing.yjsState
      ? new Uint8Array(existing.yjsState)
      : collabConfig()
        ? seedNoteState(existing.contentJson)
        : null;
    if (base) {
      try {
        yjsState = applyContentToState(base, contentJson);
      } catch (error) {
        if (error instanceof InvalidNoteContentError) return { error: "Invalid note content." };
        throw error;
      }
    }

    const eventError = await assertEventBelongsToOrg(ctx, data.eventId);
    if (eventError) return { error: eventError };

    // Version history: the body as it was, if no version was taken lately
    // (written after this save commits).
    if (existing.version === expectedVersion && data.contentText !== existing.contentText) {
      await snapshotBeforeSave(ctx, existing);
    }

    const result = await ctx.db.note.updateMany({
      where: { id: noteId, organizationId: ctx.organizationId, version: expectedVersion },
      data: {
        title: data.title,
        contentJson,
        contentText: data.contentText,
        visibility,
        eventId: data.eventId,
        updatedById: ctx.userId,
        version: { increment: 1 },
        ...(yjsState ? { yjsState: new Uint8Array(yjsState) } : {}),
      },
    });

    if (result.count === 0) {
      return { error: "This note was updated by someone else — reload.", conflict: true };
    }

    if (existing.visibility !== NoteVisibility.PRIVATE && visibility === NoteVisibility.PRIVATE) {
      revokeAfterCommit(ctx, noteId);
    }
    return { noteId, version: expectedVersion + 1 };
  },
);

/**
 * The live editor's save for the title, visibility and linked event: only
 * the fields given, no version check (the body merges through the
 * collaboration server, so there is no stale body to protect; last writer
 * wins per field). Bumps the version, so an autosave editor still open on
 * the old one gets the usual conflict instead of overwriting these.
 */
export const updateNoteDetails = filesAction(
  async (ctx, noteId: string, input: unknown): Promise<ActionResult> => {
    const existing = await loadNote(ctx, noteId);
    if (!existing) return { error: NOT_FOUND };
    if (!canEditNote(ctx, existing)) {
      return { error: "You don't have permission to edit this note." };
    }

    const parsed = noteDetailsSchema.safeParse(input);
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
    }
    const patch = parsed.data;
    if (
      patch.visibility !== undefined &&
      patch.visibility !== existing.visibility &&
      !canShareNote(ctx, existing)
    ) {
      return { error: NO_SHARING };
    }
    if (patch.eventId !== undefined) {
      const eventError = await assertEventBelongsToOrg(ctx, patch.eventId);
      if (eventError) return { error: eventError };
    }

    const result = await ctx.db.note.updateMany({
      where: { id: noteId, organizationId: ctx.organizationId },
      data: { ...patch, updatedById: ctx.userId, version: { increment: 1 } },
    });
    if (result.count === 0) return { error: "Note not found." };

    if (
      existing.visibility !== NoteVisibility.PRIVATE &&
      patch.visibility === NoteVisibility.PRIVATE
    ) {
      revokeAfterCommit(ctx, noteId);
    }
    return { noteId };
  },
);

/** Walks up from `parentId`: whether `noteId` is above it (moving it there would loop). */
async function wouldLoop(ctx: OrgContext, noteId: string, parentId: string): Promise<boolean> {
  const seen = new Set<string>();
  let current: string | null = parentId;
  while (current && !seen.has(current)) {
    if (current === noteId) return true;
    seen.add(current);
    const row: { parentId: string | null } | null = await ctx.db.note.findFirst({
      where: { id: current, organizationId: ctx.organizationId },
      select: { parentId: true },
    });
    current = row?.parentId ?? null;
  }
  return false;
}

/**
 * A page's icon, layout (Page or Document), paper size, or the page it sits
 * inside (null: the top level). Whoever may edit the page changes these;
 * a page goes only inside one the caller can see, and never inside itself
 * or one of its own subpages (app.note_cycle_guard says the same).
 */
export const updateNoteSettings = filesAction(
  async (ctx, noteId: string, input: unknown): Promise<ActionResult> => {
    const parsed = noteSettingsSchema.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
    const existing = await loadNote(ctx, noteId);
    if (!existing) return { error: NOT_FOUND };
    if (!canEditNote(ctx, existing)) {
      return { error: "You don't have permission to edit this note." };
    }
    const patch: NoteSettingsInput = { ...parsed.data };
    if (patch.icon === "") patch.icon = null;
    if (patch.headerText === "") patch.headerText = null;
    if (patch.footerText === "") patch.footerText = null;
    if (patch.parentId !== undefined && patch.parentId !== existing.parentId) {
      if (patch.parentId !== null) {
        if (patch.parentId === noteId || (await wouldLoop(ctx, noteId, patch.parentId))) {
          return { error: "A page can't go inside itself or one of its own subpages." };
        }
        if (!(await loadNote(ctx, patch.parentId))) return { error: "That page no longer exists." };
      }
    } else {
      delete patch.parentId;
    }
    if (Object.keys(patch).length === 0) return { noteId };
    await ctx.db.note.updateMany({
      where: { id: noteId, organizationId: ctx.organizationId },
      data: patch,
    });
    return { noteId };
  },
);

export type CollabTokenResult = { session: NoteCollabSession; error?: never } | { error: string };

/**
 * A fresh collaboration token for a note (the editor asks on every
 * connection and before its token expires). Minted only after the note was
 * read back through RLS as the caller, so access that was lost since the
 * last token (the note turned PRIVATE, the caller left the org) is refused
 * here; write permission is canEditNote's.
 */
export const issueNoteCollabToken = filesAction(
  async (ctx, noteId: string): Promise<CollabTokenResult> => {
    const config = collabConfig();
    if (!config) return { error: "Live editing is off." };

    const note = await loadNote(ctx, noteId);
    if (!note) return { error: NOT_FOUND };
    return { session: mintNoteCollabSession(config, ctx, note) };
  },
);

export const deleteNote = filesAction(async (ctx, noteId: string): Promise<ActionResult> => {
  const existing = await loadNote(ctx, noteId);
  if (!existing) return { error: NOT_FOUND };
  if (!canShareNote(ctx, existing)) {
    return { error: "You don't have permission to delete this note." };
  }

  await ctx.db.note.updateMany({
    where: { id: noteId, organizationId: ctx.organizationId },
    data: { deletedAt: new Date() },
  });
  revokeAfterCommit(ctx, noteId);
  return {};
});

export const restoreNote = filesAction(async (ctx, noteId: string): Promise<ActionResult> => {
  const existing = await loadNote(ctx, noteId, { deleted: true });
  if (!existing) return { error: NOT_FOUND };
  if (!canShareNote(ctx, existing)) {
    return { error: "You don't have permission to restore this note." };
  }

  await ctx.db.note.updateMany({
    where: { id: noteId, organizationId: ctx.organizationId },
    data: { deletedAt: null },
  });
  return {};
});

// ---- Sharing ------------------------------------------------------------------

export interface SharingResult {
  error?: string;
  /** Who the note is shared with now, for the share dialog. */
  shares?: NoteShareRow[];
}

const GENERAL_ACCESS = ["RESTRICTED", "CLUB_VIEW", "CLUB_EDIT"] as const;
const SHARE_ROLES = Object.values(NoteShareRole) as [NoteShareRole, ...NoteShareRole[]];
const userIdSchema = z.string().min(1).max(64);

/**
 * General access, from the share dialog: only the people it's shared with
 * (PRIVATE), everyone in the club can view, or everyone in the club can
 * edit. Only the author makes a club note private: RLS keeps a note visible
 * to whoever writes it, and an admin would lock themselves out.
 */
export const updateNoteAccess = filesAction(
  async (ctx, noteId: string, access: unknown): Promise<ActionResult> => {
    const parsed = z.enum(GENERAL_ACCESS).safeParse(access);
    if (!parsed.success) return { error: "Choose who has access." };
    const existing = await loadNote(ctx, noteId);
    if (!existing) return { error: NOT_FOUND };
    if (!canShareNote(ctx, existing)) return { error: NO_SHARING };
    const next = fromGeneralAccess(parsed.data as NoteGeneralAccess);
    if (next.visibility === NoteVisibility.PRIVATE && existing.authorId !== ctx.userId) {
      return { error: "Only the note's author can make it private." };
    }
    if (next.visibility === existing.visibility && next.memberCanEdit === existing.memberCanEdit) {
      return { noteId };
    }
    await ctx.db.note.updateMany({
      where: { id: noteId, organizationId: ctx.organizationId },
      data: { ...next, updatedById: ctx.userId },
    });
    // Everyone gets a token for what they may do now: a member who could
    // edit may only watch, one who could watch may edit, or not see it at all.
    revokeAfterCommit(ctx, noteId);
    return { noteId };
  },
);

const shareSchema = z.object({
  userIds: z.array(userIdSchema).min(1, "Pick someone to share it with.").max(50),
  role: z.enum(SHARE_ROLES),
  /** An optional line for the notice the people get. */
  message: z.string().trim().max(500).optional(),
});

/**
 * Shares a note with members as viewers or editors (or changes the role of
 * people it's already shared with), and tells the ones newly added. Only
 * members of the club; the author is never a share of their own note.
 */
export const shareNote = filesAction(
  async (ctx, noteId: string, input: unknown): Promise<SharingResult> => {
    const parsed = shareSchema.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
    const existing = await loadNote(ctx, noteId);
    if (!existing) return { error: NOT_FOUND };
    if (!canShareNote(ctx, existing)) return { error: NO_SHARING };

    const wanted = [...new Set(parsed.data.userIds)].filter((id) => id !== existing.authorId);
    if (wanted.length === 0) return { error: "The author already has access." };
    const members = await ctx.db.membership.findMany({
      where: { organizationId: ctx.organizationId, userId: { in: wanted } },
      select: { userId: true },
    });
    if (members.length !== wanted.length) {
      return { error: "Notes can only be shared with members of the organization." };
    }
    const before = await ctx.db.noteShare.findMany({
      where: { noteId, organizationId: ctx.organizationId, userId: { in: wanted } },
      select: { userId: true, role: true },
    });
    const had = new Map(before.map((s) => [s.userId, s.role]));
    const { role } = parsed.data;
    for (const userId of wanted) {
      if (had.get(userId) === role) continue;
      await ctx.db.noteShare.upsert({
        where: { noteId_userId: { noteId, userId } },
        create: {
          organizationId: ctx.organizationId,
          noteId,
          userId,
          role,
          createdById: ctx.userId,
        },
        update: { role },
      });
    }

    const added = wanted.filter((id) => !had.has(id));
    if (added.length > 0) {
      const org = await ctx.db.organization.findUnique({
        where: { id: ctx.organizationId },
        select: { slug: true },
      });
      const sharer = ctx.user.name?.trim() || "Someone";
      if (org) {
        await notifyUsers(ctx.db, ctx.organizationId, added, {
          type: NotificationType.NOTE_SHARED,
          title: `${sharer} shared “${existing.title}” with you`,
          body:
            parsed.data.message ||
            (role === NoteShareRole.EDITOR ? "You can edit it." : "You can view it."),
          linkUrl: `/app/${org.slug}/notes/${noteId}`,
          actorId: ctx.userId,
        });
      }
    }
    // A role that changed takes effect on the next token; this makes it now.
    if (before.some((s) => s.role !== role)) revokeAfterCommit(ctx, noteId);
    return { shares: await listNoteShares(ctx.db, ctx.organizationId, noteId) };
  },
);

/** Changes what one person the note is shared with may do. */
export const updateNoteShare = filesAction(
  async (ctx, noteId: string, userId: string, role: unknown): Promise<SharingResult> => {
    const parsedRole = z.enum(SHARE_ROLES).safeParse(role);
    if (!parsedRole.success || !userIdSchema.safeParse(userId).success) {
      return { error: "Invalid input" };
    }
    const existing = await loadNote(ctx, noteId);
    if (!existing) return { error: NOT_FOUND };
    if (!canShareNote(ctx, existing)) return { error: NO_SHARING };
    const result = await ctx.db.noteShare.updateMany({
      where: { noteId, userId, organizationId: ctx.organizationId },
      data: { role: parsedRole.data },
    });
    if (result.count === 0) return { error: "It isn't shared with them any more." };
    revokeAfterCommit(ctx, noteId);
    return { shares: await listNoteShares(ctx.db, ctx.organizationId, noteId) };
  },
);

/**
 * Takes someone off a note: the author (or an admin, on a club note) for
 * anyone, and anyone for themselves ("Remove me").
 */
export const removeNoteShare = filesAction(
  async (ctx, noteId: string, userId: string): Promise<SharingResult> => {
    if (!userIdSchema.safeParse(userId).success) return { error: "Invalid input" };
    const existing = await loadNote(ctx, noteId);
    if (!existing) return { error: NOT_FOUND };
    if (userId !== ctx.userId && !canShareNote(ctx, existing)) return { error: NO_SHARING };
    await ctx.db.noteShare.deleteMany({
      where: { noteId, userId, organizationId: ctx.organizationId },
    });
    revokeAfterCommit(ctx, noteId);
    // Someone who just removed themselves from a private note can't list it any more.
    const shares =
      userId === ctx.userId && !canShareNote(ctx, existing)
        ? []
        : await listNoteShares(ctx.db, ctx.organizationId, noteId);
    return { shares };
  },
);
