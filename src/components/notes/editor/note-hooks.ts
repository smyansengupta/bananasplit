import { Extension, type Editor } from "@tiptap/core";

import type { LinkRef } from "@/lib/links";

export interface LinkableItem {
  ref: LinkRef;
  /** The search kind ("epic", "form"), for the icon. */
  kind: string;
  title: string;
  href: string;
  detail?: string | null;
}

/**
 * What the slash menu and block menu ask the page for: things that need a
 * dialog, an upload or a server call (insert a task, pick a database or a
 * poll, upload an image or a file, make a subpage). The note editor sets
 * these on mount (editor.storage.noteHooks.hooks); the schema never sees
 * them.
 */
export interface NoteHooks {
  /** Who and what the @ and [[ menus offer. */
  people: () => { id: string; name: string | null; image?: string | null }[];
  pages: () => { id: string; title: string; icon: string | null }[];
  selfId: () => string | null;
  noteId: () => string | null;
  /** Anything else @ can point at (a task, a meeting, a form), from the space's search. */
  findItems: (query: string) => Promise<LinkableItem[]>;
  /** Records that this page links to the item (ItemLink), both ways. */
  linkItem: (ref: LinkRef) => void;
  /** A comment highlight was clicked. */
  clickThread: (id: string) => void;
  /** Pasted or dropped pictures; false when they weren't taken. */
  uploadImages: (files: File[]) => boolean;
  uploadImage: () => void;
  uploadFile: () => void;
  insertTask: () => void;
  insertEmbed: (kind: "database" | "poll") => void;
  createSubpage: () => void;
}

interface HooksStorage {
  hooks: NoteHooks | null;
}

export const NoteHooksExtension = Extension.create<Record<string, never>, HooksStorage>({
  name: "noteHooks",
  addStorage: () => ({ hooks: null }),
});

export function noteHooks(editor: Editor): NoteHooks | null {
  const storage = (editor.storage as unknown as Record<string, HooksStorage | undefined>).noteHooks;
  return storage?.hooks ?? null;
}

export function setNoteHooks(editor: Editor, hooks: NoteHooks | null) {
  const storage = (editor.storage as unknown as Record<string, HooksStorage | undefined>).noteHooks;
  if (storage) storage.hooks = hooks;
}
