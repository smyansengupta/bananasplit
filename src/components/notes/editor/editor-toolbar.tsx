"use client";

import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link as LinkIcon,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Pilcrow,
  Quote,
  Redo2,
  SquareCode,
  Strikethrough,
  Underline as UnderlineIcon,
  Undo2,
  type IconComponent,
} from "@/components/icons";

import { Button } from "@/components/ui/button";

import { TableInsertButton, TableTools } from "./table-tools";

interface Tool {
  label: string;
  icon: IconComponent;
  active?: (e: Editor) => boolean;
  run: (e: Editor) => void;
  disabled?: (e: Editor) => boolean;
}

const GROUPS: Tool[][] = [
  [
    {
      label: "Text",
      icon: Pilcrow,
      active: (e) => e.isActive("paragraph"),
      run: (e) => e.chain().focus().setParagraph().run(),
    },
    {
      label: "Heading 1",
      icon: Heading1,
      active: (e) => e.isActive("heading", { level: 1 }),
      run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(),
    },
    {
      label: "Heading 2",
      icon: Heading2,
      active: (e) => e.isActive("heading", { level: 2 }),
      run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      label: "Heading 3",
      icon: Heading3,
      active: (e) => e.isActive("heading", { level: 3 }),
      run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(),
    },
  ],
  [
    {
      label: "Bold (Ctrl+B)",
      icon: Bold,
      active: (e) => e.isActive("bold"),
      run: (e) => e.chain().focus().toggleBold().run(),
    },
    {
      label: "Italic (Ctrl+I)",
      icon: Italic,
      active: (e) => e.isActive("italic"),
      run: (e) => e.chain().focus().toggleItalic().run(),
    },
    {
      label: "Underline (Ctrl+U)",
      icon: UnderlineIcon,
      active: (e) => e.isActive("underline"),
      run: (e) => e.chain().focus().toggleUnderline().run(),
    },
    {
      label: "Strikethrough",
      icon: Strikethrough,
      active: (e) => e.isActive("strike"),
      run: (e) => e.chain().focus().toggleStrike().run(),
    },
    {
      label: "Inline code",
      icon: Code,
      active: (e) => e.isActive("code"),
      run: (e) => e.chain().focus().toggleCode().run(),
    },
  ],
  [
    {
      label: "Bullet list",
      icon: List,
      active: (e) => e.isActive("bulletList"),
      run: (e) => e.chain().focus().toggleBulletList().run(),
    },
    {
      label: "Numbered list",
      icon: ListOrdered,
      active: (e) => e.isActive("orderedList"),
      run: (e) => e.chain().focus().toggleOrderedList().run(),
    },
    {
      label: "Checklist",
      icon: ListChecks,
      active: (e) => e.isActive("taskList"),
      run: (e) => e.chain().focus().toggleTaskList().run(),
    },
  ],
  [
    {
      label: "Quote",
      icon: Quote,
      active: (e) => e.isActive("blockquote"),
      run: (e) => e.chain().focus().toggleBlockquote().run(),
    },
    {
      label: "Code block",
      icon: SquareCode,
      active: (e) => e.isActive("codeBlock"),
      run: (e) => e.chain().focus().toggleCodeBlock().run(),
    },
    { label: "Divider", icon: Minus, run: (e) => e.chain().focus().setHorizontalRule().run() },
  ],
];

/** A pressed tool reads as on: the ghost button's hover colour, kept. */
const PRESSED = "aria-pressed:bg-muted aria-pressed:text-foreground";

/**
 * The note's toolbar: text style, formatting, lists and blocks, a table (any
 * size, with row and column tools while the cursor is in one), a link, and
 * undo/redo (hidden in a live note, whose undo lives in the collaboration
 * extension and only undoes your own edits; Ctrl+Z still works). Every tool
 * is the app's small ghost icon button.
 */
export function EditorToolbar({
  editor,
  onLink,
  showHistory,
}: {
  editor: Editor;
  onLink: () => void;
  showHistory: boolean;
}) {
  // Re-render on selection and content changes, for the active states.
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      active: GROUPS.flat().map((t) => (t.active ? t.active(e) : false)),
      link: e.isActive("link"),
      table: e.isActive("table"),
      canUndo: showHistory && e.can().undo(),
      canRedo: showHistory && e.can().redo(),
    }),
  });
  let index = 0;

  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      className="glass-light rounded-tile sticky top-[var(--shell-top,3.5rem)] z-20 mx-auto flex w-fit max-w-full flex-wrap items-center gap-0.5 p-1"
    >
      {GROUPS.map((group, g) => (
        <div key={g} className="flex items-center gap-0.5">
          {g > 0 && <span className="bg-border mx-1 h-5 w-px" aria-hidden="true" />}
          {group.map((tool) => {
            const i = index++;
            const Icon = tool.icon;
            const active = state.active[i];
            return (
              <Button
                key={tool.label}
                type="button"
                variant="ghost"
                size="icon-sm"
                title={tool.label}
                aria-label={tool.label}
                aria-pressed={tool.active ? active : undefined}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => tool.run(editor)}
                className={PRESSED}
              >
                <Icon className="size-4" aria-hidden="true" />
              </Button>
            );
          })}
        </div>
      ))}
      <TableInsertButton editor={editor} active={state.table} />
      <span className="bg-border mx-1 h-5 w-px" aria-hidden="true" />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        title="Link"
        aria-label="Link"
        aria-pressed={state.link}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onLink}
        className={PRESSED}
      >
        <LinkIcon className="size-4" aria-hidden="true" />
      </Button>
      {showHistory && (
        <div className="ml-auto flex items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            title="Undo (Ctrl+Z)"
            aria-label="Undo"
            disabled={!state.canUndo}
            onClick={() => editor.chain().focus().undo().run()}
          >
            <Undo2 className="size-4" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            title="Redo (Ctrl+Shift+Z)"
            aria-label="Redo"
            disabled={!state.canRedo}
            onClick={() => editor.chain().focus().redo().run()}
          >
            <Redo2 className="size-4" aria-hidden="true" />
          </Button>
        </div>
      )}
      <TableTools editor={editor} />
    </div>
  );
}

export interface OutlineItem {
  level: number;
  text: string;
  pos: number;
}

/** The note's headings, for the "On this page" rail. */
export function readOutline(editor: Editor): OutlineItem[] {
  const items: OutlineItem[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "heading" && node.textContent.trim()) {
      items.push({ level: Number(node.attrs.level) || 1, text: node.textContent.trim(), pos });
    }
    return node.type.name !== "heading";
  });
  return items;
}

export function NoteOutline({ editor }: { editor: Editor }) {
  const { outline, words } = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const text = e.state.doc.textContent.trim();
      return {
        outline: readOutline(e),
        words: text ? text.split(/\s+/).length : 0,
      };
    },
    equalityFn: (a, b) =>
      b !== null &&
      a.words === b.words &&
      a.outline.length === b.outline.length &&
      a.outline.every((o, i) => o.text === b.outline[i].text && o.level === b.outline[i].level),
  });
  const minutes = Math.max(1, Math.round(words / 220));

  return (
    <aside className="text-sm" aria-label="On this page">
      <p className="text-muted-foreground text-xs">
        {words.toLocaleString()} word{words === 1 ? "" : "s"} · {minutes} min read
      </p>
      {outline.length > 0 && (
        <>
          <p className="eyebrow text-muted-foreground mt-4 mb-2">On this page</p>
          <ul className="space-y-1 border-l">
            {outline.map((item) => (
              <li key={`${item.pos}-${item.text}`}>
                <button
                  type="button"
                  onClick={() => {
                    editor.commands.setTextSelection(item.pos + 1);
                    const dom = editor.view.nodeDOM(item.pos);
                    if (dom instanceof HTMLElement)
                      dom.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                  className="text-muted-foreground hover:text-foreground hover:border-primary -ml-px block w-full truncate border-l border-transparent py-0.5 text-left"
                  style={{ paddingLeft: `${(item.level - 1) * 12 + 12}px` }}
                >
                  {item.text}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </aside>
  );
}
