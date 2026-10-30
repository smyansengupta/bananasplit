import "server-only";

import { z } from "zod";

import { NotFoundError } from "@/lib/auth/errors";
import { checkNoteContent, InvalidNoteContentError, type NoteContent } from "@/lib/collab/note-doc";
import { markdownToNote } from "@/lib/notes/import/markdown";
import { createNote } from "@/server/notes/create";

import { itemId } from "./ids";
import { NOTES } from "./notes";
import {
  ConnectorInputError,
  readResult,
  spaceArg,
  spaceRef,
  urlField,
  type ConnectorSession,
  type ToolRegistrar,
} from "./shared";
import { ADDS, refuseOn, writeInSpace } from "./write";

/**
 * create_note (docs/features/ai-connectors.md, Phase 3): a new note from
 * Markdown (src/lib/notes/import/markdown.ts), checked against the note
 * schema and made by the notes page's own createNote
 * (src/server/notes/create.ts). It starts private, seen only by the member
 * until they share it in the app: who sees a note is not something a
 * connected app changes. Existing notes aren't edited from here, since live
 * collaboration owns their Yjs state.
 */

/** About 100,000 characters of Markdown: well inside a note's limits. */
const MARKDOWN_MAX = 100_000;

const createInput = z.object({
  space: spaceArg,
  title: z
    .string()
    .trim()
    .max(300)
    .optional()
    .describe('The title. Unless given, a first line "# Title" is taken as the title.'),
  markdown: z
    .string()
    .max(MARKDOWN_MAX)
    .default("")
    .describe(
      "The note, as Markdown: headings, lists and checklists, quotes, code, tables, links. A first line repeating the title is dropped.",
    ),
  folder: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,128}$/, "Use a folder id from list_notes")
    .optional()
    .describe("A folder to put it in: a folder id from list_notes."),
});

const createOutput = z.object({
  space: spaceRef,
  note: z.object({
    id: z.string().describe("The note's id, for get_note and fetch."),
    title: z.string(),
    folder: z.object({ id: z.string(), name: z.string() }).nullable(),
    private: z.boolean().describe("Seen only by its author and the people it's shared with."),
    url: urlField,
  }),
});

function noteContent(markdown: string, title: string | undefined) {
  const note = markdownToNote(markdown, title);
  let content: NoteContent;
  try {
    content = checkNoteContent(note.content);
  } catch (error) {
    if (error instanceof InvalidNoteContentError) {
      throw new ConnectorInputError("That Markdown couldn't be turned into a note.");
    }
    throw error;
  }
  return { title: note.title, content };
}

export async function createNoteTool(
  session: ConnectorSession,
  raw: z.input<typeof createInput>,
): Promise<z.infer<typeof createOutput>> {
  const args = createInput.parse(raw);
  const { title, content } = noteContent(args.markdown, args.title || undefined);
  return writeInSpace(session, "create_note", args.space, NOTES, async (ctx, space) => {
    const { noteId } = refuseOn(await createNote(ctx, { title, folderId: args.folder, content }));
    const note = await ctx.db.note.findFirst({
      where: { id: noteId, organizationId: space.id },
      select: {
        id: true,
        title: true,
        visibility: true,
        folder: { select: { id: true, name: true } },
      },
    });
    if (!note) throw new NotFoundError();
    return {
      output: {
        space: { id: space.id, name: space.name },
        note: {
          id: itemId("note", space.id, note.id),
          title: note.title,
          folder: note.folder,
          private: note.visibility === "PRIVATE",
          url: space.url(`/notes/${note.id}`),
        },
      },
      target: { type: "Note", id: note.id },
    };
  });
}

export const registerNoteWrites: ToolRegistrar = (server, session) => {
  server.registerTool(
    "create_note",
    {
      title: "Create a note",
      description:
        "Creates a note in one space from Markdown, optionally in a folder. It starts private: only the member sees it until they share it in Bananasplit. Existing notes can't be edited from here.",
      inputSchema: createInput,
      outputSchema: createOutput,
      annotations: ADDS,
    },
    (args) => readResult("create_note", () => createNoteTool(session, args)),
  );
};
