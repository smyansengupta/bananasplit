import "server-only";

import { z } from "zod";

import { NotFoundError } from "@/lib/auth/errors";
import { noteToMarkdown } from "@/lib/notes/export/markdown";
import { getNoteById, noteListWhere } from "@/app/app/[orgSlug]/notes/queries";
import type { OrgContext } from "@/server/db/context";

import { decodeCursor, listFingerprint, pageOf } from "./cursor";
import { itemId, refOf, type ItemRef } from "./ids";
import {
  cursorArg,
  itemArg,
  limitArg,
  nextCursor,
  personOf,
  personRef,
  READ_ONLY,
  readResult,
  spaceArg,
  spaceRef,
  urlField,
  type ConnectorSession,
  type FetchedItem,
  type ToolRegistrar,
} from "./shared";
import { inSpace, type ToolSpace } from "./space";
import { sliceText, TEXT_LIMIT, zonedIso } from "./text";

/**
 * list_notes and get_note (docs/features/ai-connectors.md): the space's
 * notes the member may read. RLS and noteListWhere both hide other
 * members' PRIVATE notes unless shared with this one; a removed share
 * hides it again. A note reads as Markdown (the Download Markdown export),
 * TEXT_LIMIT characters at a time.
 */

export const NOTES = { feature: "files", section: "notes" } as const;

const folderRef = z.object({ id: z.string(), name: z.string() }).nullable();

const noteSummary = z.object({
  id: z.string().describe("The note's id, for get_note and fetch."),
  title: z.string(),
  folder: folderRef.describe("Its folder; the id filters list_notes."),
  private: z.boolean().describe("Seen only by its author and the people it's shared with."),
  author: personRef.nullable(),
  updatedAt: z.string(),
  url: urlField,
});

const listOutput = z.object({
  space: spaceRef,
  notes: z.array(noteSummary),
  nextCursor,
});

const noteOutput = noteSummary.extend({
  space: spaceRef,
  event: z
    .object({ id: z.string(), title: z.string() })
    .nullable()
    .describe("The event it's linked to."),
  markdown: z.string().describe(`The note as Markdown, at most ${TEXT_LIMIT} characters of it.`),
  offset: z.number().int().describe("Where this part starts in the whole note."),
  totalLength: z.number().int().describe("The whole note's length in characters."),
  truncated: z.boolean().describe("More of the note follows this part."),
  nextOffset: z
    .number()
    .int()
    .nullable()
    .describe("Pass as offset for the next part; null at the end."),
});

export type NoteOutput = z.infer<typeof noteOutput>;

function untitled(title: string): string {
  return title.trim() || "Untitled note";
}

// ---------------------------------------------------------------- list_notes

const listInput = z.object({
  space: spaceArg,
  folder: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,128}$/, "Use a folder id from list_notes, or none")
    .optional()
    .describe(
      'Only notes in this folder (a folder id from list_notes), or "none" for notes in no folder.',
    ),
  query: z.string().max(100).optional().describe("Words that are in the title or the note."),
  limit: limitArg,
  cursor: cursorArg,
});

export async function listNotes(
  session: ConnectorSession,
  raw: z.input<typeof listInput>,
): Promise<z.infer<typeof listOutput>> {
  const args = listInput.parse(raw);
  const list = listFingerprint("list_notes", { ...args, limit: undefined, cursor: undefined });
  const position = decodeCursor(args.cursor, list);
  return inSpace(session, args.space, NOTES, async (ctx, space) => {
    const rows = await ctx.db.note.findMany({
      where: noteListWhere(space.id, ctx.userId, { folderId: args.folder, q: args.query }),
      select: {
        id: true,
        title: true,
        visibility: true,
        updatedAt: true,
        folder: { select: { id: true, name: true } },
        author: { select: { id: true, name: true } },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      skip: position.offset,
      take: args.limit + 1,
    });
    const page = pageOf(rows, args.limit, list, position);
    return {
      space: { id: space.id, name: space.name },
      notes: page.items.map((n) => ({
        id: itemId("note", space.id, n.id),
        title: untitled(n.title),
        folder: n.folder,
        private: n.visibility === "PRIVATE",
        author: personOf(space.id, n.author),
        updatedAt: zonedIso(n.updatedAt, space.zone),
        url: space.url(`/notes/${n.id}`),
      })),
      nextCursor: page.nextCursor,
    };
  });
}

// ---------------------------------------------------------------- get_note

async function loadNote(
  ctx: OrgContext,
  space: ToolSpace,
  noteId: string,
  offset: number,
): Promise<NoteOutput> {
  const note = await getNoteById(ctx.db, space.id, ctx.userId, noteId);
  if (!note) throw new NotFoundError();
  const title = untitled(note.title);
  const markdown = noteToMarkdown(title, note.contentJson, {
    baseUrl: space.url(),
    orgId: space.id,
  });
  const part = sliceText(markdown, offset);
  const folder = note.folderId
    ? await ctx.db.noteFolder.findFirst({
        where: { id: note.folderId, organizationId: space.id },
        select: { id: true, name: true },
      })
    : null;
  return {
    id: itemId("note", space.id, note.id),
    title,
    folder,
    private: note.visibility === "PRIVATE",
    author: personOf(space.id, note.author),
    updatedAt: zonedIso(note.updatedAt, space.zone),
    url: space.url(`/notes/${note.id}`),
    space: { id: space.id, name: space.name },
    event: note.event
      ? { id: itemId("event", space.id, note.event.id), title: note.event.title }
      : null,
    markdown: part.text,
    offset: part.offset,
    totalLength: part.totalLength,
    truncated: part.truncated,
    nextOffset: part.nextOffset,
  };
}

const getInput = z.object({
  id: itemArg("note"),
  offset: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe("Where to start reading, in characters: nextOffset from the previous part."),
});

export async function getNote(
  session: ConnectorSession,
  raw: z.input<typeof getInput>,
): Promise<NoteOutput> {
  const args = getInput.parse(raw);
  const ref = refOf(args.id, "note");
  return inSpace(session, ref.spaceId, NOTES, (ctx, space) =>
    loadNote(ctx, space, ref.id, args.offset),
  );
}

/** A note for fetch: its first TEXT_LIMIT characters of Markdown. */
export async function fetchNote(session: ConnectorSession, ref: ItemRef): Promise<FetchedItem> {
  const note = await inSpace(session, ref.spaceId, NOTES, (ctx, space) =>
    loadNote(ctx, space, ref.id, 0),
  );
  return {
    id: note.id,
    title: note.title,
    text: note.markdown,
    url: note.url,
    metadata: {
      kind: "note",
      spaceId: note.space.id,
      space: note.space.name,
      private: note.private,
      truncated: note.truncated,
      totalLength: note.totalLength,
      nextOffset: note.nextOffset,
    },
  };
}

// ---------------------------------------------------------------- registration

export const registerNoteTools: ToolRegistrar = (server, session) => {
  server.registerTool(
    "list_notes",
    {
      title: "List notes",
      description:
        "Lists the notes in one space that the member can read, most recently edited first, optionally in one folder or matching words.",
      inputSchema: listInput,
      outputSchema: listOutput,
      annotations: READ_ONLY,
    },
    (args) => readResult("list_notes", () => listNotes(session, args)),
  );
  server.registerTool(
    "get_note",
    {
      title: "Get a note",
      description: `Gets one note as Markdown, ${TEXT_LIMIT} characters at a time: a longer note comes back with truncated true and a nextOffset for the next part.`,
      inputSchema: getInput,
      outputSchema: noteOutput,
      annotations: READ_ONLY,
    },
    (args) => readResult("get_note", () => getNote(session, args)),
  );
};
