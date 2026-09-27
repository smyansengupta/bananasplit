import type { Extensions } from "@tiptap/core";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import StarterKit from "@tiptap/starter-kit";

/**
 * The note editor's document extensions: every node and mark a note body
 * can hold. The editor (src/components/notes/editor) adds its UI extensions
 * on top; the server builds the same schema from this list to turn a live
 * Yjs document back into contentJson and contentText
 * (src/lib/collab/note-doc.ts). Add a node or mark here, never only in the
 * editor, or live saves would drop it.
 *
 * `collaborative` turns off StarterKit's undo history: the Collaboration
 * extension brings its own, which only undoes the local user's changes.
 */
export function noteSchemaExtensions({ collaborative = false } = {}): Extensions {
  return [
    StarterKit.configure({
      link: { openOnClick: false, autolink: true },
      ...(collaborative ? { undoRedo: false } : {}),
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({ resizable: false }),
    TableRow,
    TableCell,
    TableHeader,
  ];
}
