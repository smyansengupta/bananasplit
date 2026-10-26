import {
  AtSign,
  CalendarDays,
  ChevronRight,
  Columns2,
  Columns3,
  Database,
  FilePlus2,
  FileText,
  Heading1,
  Heading2,
  Heading3,
  ImageIcon,
  Info,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  type IconComponent,
  Minus,
  Pilcrow,
  Quote,
  Scissors,
  SquareCheck,
  SquareCode,
  Table as TableIcon,
  Vote,
} from "@/components/icons";
import type { Editor, Range } from "@tiptap/core";

import { todayKey } from "@/lib/notes/dates";

import { noteHooks } from "./note-hooks";
import { insertTable } from "./table-tools";

export interface SlashCommandItem {
  key: string;
  title: string;
  description: string;
  icon: IconComponent;
  group: string;
  keywords: string[];
  hint?: string;
  run: (editor: Editor, range: Range) => void;
}

const column = () => ({ type: "column", content: [{ type: "paragraph" }] });

/** Deletes the "/query" and starts typing the trigger of another menu (@, [[). */
function startTrigger(editor: Editor, range: Range, trigger: string) {
  editor.chain().focus().deleteRange(range).insertContent(trigger).run();
}

function viaHook(
  editor: Editor,
  range: Range,
  call: (h: NonNullable<ReturnType<typeof noteHooks>>) => void,
) {
  editor.chain().focus().deleteRange(range).run();
  const hooks = noteHooks(editor);
  if (hooks) call(hooks);
}

const BASIC = "Basic blocks";
const MEDIA = "Media";
const LINKS = "People, dates and pages";
const LIVE = "Live pieces";
const LAYOUT = "Layout";

export const SLASH_COMMAND_ITEMS: SlashCommandItem[] = [
  {
    key: "text",
    title: "Text",
    description: "Plain paragraph",
    icon: Pilcrow,
    group: BASIC,
    keywords: ["text", "paragraph", "p"],
    run: (e, r) => e.chain().focus().deleteRange(r).setParagraph().run(),
  },
  {
    key: "h1",
    title: "Heading 1",
    description: "Big section heading",
    icon: Heading1,
    group: BASIC,
    hint: "#",
    keywords: ["h1", "heading", "title"],
    run: (e, r) => e.chain().focus().deleteRange(r).setNode("heading", { level: 1 }).run(),
  },
  {
    key: "h2",
    title: "Heading 2",
    description: "Medium section heading",
    icon: Heading2,
    group: BASIC,
    hint: "##",
    keywords: ["h2", "heading", "subtitle"],
    run: (e, r) => e.chain().focus().deleteRange(r).setNode("heading", { level: 2 }).run(),
  },
  {
    key: "h3",
    title: "Heading 3",
    description: "Small section heading",
    icon: Heading3,
    group: BASIC,
    hint: "###",
    keywords: ["h3", "heading"],
    run: (e, r) => e.chain().focus().deleteRange(r).setNode("heading", { level: 3 }).run(),
  },
  {
    key: "bullet",
    title: "Bullet list",
    description: "Simple unordered list",
    icon: List,
    group: BASIC,
    hint: "-",
    keywords: ["bullet", "list", "ul"],
    run: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run(),
  },
  {
    key: "numbered",
    title: "Numbered list",
    description: "List with numbers",
    icon: ListOrdered,
    group: BASIC,
    hint: "1.",
    keywords: ["ordered", "list", "ol", "number"],
    run: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run(),
  },
  {
    key: "checklist",
    title: "Checklist",
    description: "Checkboxes for quick to-dos",
    icon: ListChecks,
    group: BASIC,
    hint: "[]",
    keywords: ["todo", "checkbox", "checklist"],
    run: (e, r) => e.chain().focus().deleteRange(r).toggleTaskList().run(),
  },
  {
    key: "toggle",
    title: "Toggle",
    description: "A line that opens to show more",
    icon: ChevronRight,
    group: BASIC,
    keywords: ["toggle", "details", "collapse", "dropdown"],
    run: (e, r) => e.chain().focus().deleteRange(r).setDetails().run(),
  },
  {
    key: "callout",
    title: "Callout",
    description: "A tinted box that stands out",
    icon: Info,
    group: BASIC,
    keywords: ["callout", "note", "info", "warning", "box"],
    run: (e, r) => e.chain().focus().deleteRange(r).wrapIn("callout").run(),
  },
  {
    key: "quote",
    title: "Quote",
    description: "Quoted text",
    icon: Quote,
    group: BASIC,
    hint: ">",
    keywords: ["quote", "blockquote"],
    run: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run(),
  },
  {
    key: "code",
    title: "Code",
    description: "Monospaced code block",
    icon: SquareCode,
    group: BASIC,
    hint: "```",
    keywords: ["code", "codeblock", "pre"],
    run: (e, r) => e.chain().focus().deleteRange(r).toggleCodeBlock().run(),
  },
  {
    key: "table",
    title: "Table",
    description: "3 × 3 to start, or type a size: /4x6",
    icon: TableIcon,
    group: BASIC,
    keywords: ["table", "grid"],
    run: (e, r) => {
      e.chain().focus().deleteRange(r).run();
      insertTable(e, { rows: 3, cols: 3 });
    },
  },
  {
    key: "divider",
    title: "Divider",
    description: "A line between sections",
    icon: Minus,
    group: BASIC,
    hint: "---",
    keywords: ["divider", "hr", "rule", "separator"],
    run: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run(),
  },
  {
    key: "image",
    title: "Image",
    description: "Upload a picture (counts toward storage)",
    icon: ImageIcon,
    group: MEDIA,
    keywords: ["image", "picture", "photo", "img", "upload"],
    run: (e, r) => viaHook(e, r, (h) => h.uploadImage()),
  },
  {
    key: "file",
    title: "File",
    description: "Attach a PDF, a slide deck, a spreadsheet",
    icon: FileText,
    group: MEDIA,
    keywords: ["file", "attachment", "pdf", "upload"],
    run: (e, r) => viaHook(e, r, (h) => h.uploadFile()),
  },
  {
    key: "person",
    title: "Person",
    description: "Mention a member: @name",
    icon: AtSign,
    group: LINKS,
    hint: "@",
    keywords: ["mention", "person", "people", "member", "@"],
    run: (e, r) => startTrigger(e, r, "@"),
  },
  {
    key: "date",
    title: "Date",
    description: "Today's date as a chip (click to change)",
    icon: CalendarDays,
    group: LINKS,
    keywords: ["date", "today", "day", "when"],
    run: (e, r) =>
      e
        .chain()
        .focus()
        .deleteRange(r)
        .insertContent([
          { type: "dateChip", attrs: { date: todayKey() } },
          { type: "text", text: " " },
        ])
        .run(),
  },
  {
    key: "page-link",
    title: "Link to a page",
    description: "Another note, by name: [[",
    icon: Link2,
    group: LINKS,
    hint: "[[",
    keywords: ["link", "page", "note", "backlink"],
    run: (e, r) => startTrigger(e, r, "[["),
  },
  {
    key: "subpage",
    title: "Page inside this one",
    description: "A new page nested under this page",
    icon: FilePlus2,
    group: LINKS,
    keywords: ["page", "subpage", "child", "nested", "new"],
    run: (e, r) => viaHook(e, r, (h) => h.createSubpage()),
  },
  {
    key: "task",
    title: "Task",
    description: "A real task you can check off here",
    icon: SquareCheck,
    group: LIVE,
    keywords: ["task", "todo", "assign", "action"],
    run: (e, r) => viaHook(e, r, (h) => h.insertTask()),
  },
  {
    key: "database",
    title: "Database view",
    description: "A card that opens one of the club's databases",
    icon: Database,
    group: LIVE,
    keywords: ["database", "table", "data", "view", "embed"],
    run: (e, r) => viaHook(e, r, (h) => h.insertEmbed("database")),
  },
  {
    key: "poll",
    title: "Poll",
    description: "A card that opens a club poll",
    icon: Vote,
    group: LIVE,
    keywords: ["poll", "vote", "survey", "question"],
    run: (e, r) => viaHook(e, r, (h) => h.insertEmbed("poll")),
  },
  {
    key: "columns-2",
    title: "Two columns",
    description: "Blocks side by side",
    icon: Columns2,
    group: LAYOUT,
    keywords: ["columns", "column", "side", "layout", "split"],
    run: (e, r) =>
      e
        .chain()
        .focus()
        .deleteRange(r)
        .insertContent({ type: "columns", content: [column(), column()] })
        .run(),
  },
  {
    key: "columns-3",
    title: "Three columns",
    description: "Three blocks side by side",
    icon: Columns3,
    group: LAYOUT,
    keywords: ["columns", "column", "three", "layout"],
    run: (e, r) =>
      e
        .chain()
        .focus()
        .deleteRange(r)
        .insertContent({ type: "columns", content: [column(), column(), column()] })
        .run(),
  },
  {
    key: "page-break",
    title: "Page break",
    description: "Start a new sheet in Document mode and the PDF",
    icon: Scissors,
    group: LAYOUT,
    keywords: ["page", "break", "print", "pdf", "new page"],
    run: (e, r) => e.chain().focus().deleteRange(r).insertContent({ type: "pageBreak" }).run(),
  },
];

/** "/4x6" (or "/table 4x6"): a table of that size, rows by columns. */
export function sizedTableItem(size: { rows: number; cols: number }): SlashCommandItem {
  return {
    key: `table-${size.rows}x${size.cols}`,
    title: `Table ${size.rows} × ${size.cols}`,
    description: `${size.rows} rows, ${size.cols} columns`,
    icon: TableIcon,
    group: BASIC,
    keywords: [],
    run: (editor, range) => {
      editor.chain().focus().deleteRange(range).run();
      insertTable(editor, size);
    },
  };
}

/** The items for a typed query (title or keyword), in menu order. */
export function filterSlashItems(query: string, items: SlashCommandItem[] = SLASH_COMMAND_ITEMS) {
  const needle = query.toLowerCase().trim();
  if (!needle) return items;
  return items.filter(
    (item) =>
      item.title.toLowerCase().includes(needle) ||
      item.keywords.some((keyword) => keyword.includes(needle)),
  );
}
