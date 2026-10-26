"use client";

import { DragHandle } from "@tiptap/extension-drag-handle-react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Copy,
  GripVertical,
  Heading1,
  Heading2,
  Heading3,
  Info,
  List,
  ListChecks,
  ListOrdered,
  Pilcrow,
  Plus,
  Quote,
  Repeat2,
  SquareCode,
  Trash2,
  type IconComponent,
} from "@/components/icons";
import { useRef, useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Page mode's block handles (Moonstone 13.2): hover any block for "+"
 * (a new block below, with the slash menu open) and a grip. Drag the grip
 * to move the block; click it for Turn into, Duplicate, Move up or down
 * and Delete. Built on Tiptap's DragHandle, which also works in a live
 * (Yjs) note.
 */

interface Target {
  node: PMNode;
  pos: number;
}

const TURN_INTO: { label: string; icon: IconComponent; run: (e: Editor) => boolean }[] = [
  { label: "Text", icon: Pilcrow, run: (e) => e.chain().focus().setParagraph().run() },
  {
    label: "Heading 1",
    icon: Heading1,
    run: (e) => e.chain().focus().setNode("heading", { level: 1 }).run(),
  },
  {
    label: "Heading 2",
    icon: Heading2,
    run: (e) => e.chain().focus().setNode("heading", { level: 2 }).run(),
  },
  {
    label: "Heading 3",
    icon: Heading3,
    run: (e) => e.chain().focus().setNode("heading", { level: 3 }).run(),
  },
  { label: "Bullet list", icon: List, run: (e) => e.chain().focus().toggleBulletList().run() },
  {
    label: "Numbered list",
    icon: ListOrdered,
    run: (e) => e.chain().focus().toggleOrderedList().run(),
  },
  { label: "Checklist", icon: ListChecks, run: (e) => e.chain().focus().toggleTaskList().run() },
  { label: "Toggle", icon: ChevronRight, run: (e) => e.chain().focus().setDetails().run() },
  { label: "Callout", icon: Info, run: (e) => e.chain().focus().wrapIn("callout").run() },
  { label: "Quote", icon: Quote, run: (e) => e.chain().focus().toggleBlockquote().run() },
  { label: "Code", icon: SquareCode, run: (e) => e.chain().focus().toggleCodeBlock().run() },
];

function lock(editor: Editor, locked: boolean) {
  editor.commands.setMeta("lockDragHandle", locked);
}

export function BlockHandle({ editor }: { editor: Editor }) {
  const target = useRef<Target | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [textual, setTextual] = useState(true);

  /** Puts the caret inside the block, so the block commands act on it. */
  function selectInside(t: Target) {
    const inside = Math.min(t.pos + 1, editor.state.doc.content.size);
    editor
      .chain()
      .setTextSelection(TextSelection.near(editor.state.doc.resolve(inside)).from)
      .run();
  }

  function addBelow() {
    const t = target.current;
    if (!t) return;
    const at = t.pos + t.node.nodeSize;
    editor
      .chain()
      .focus()
      .insertContentAt(at, { type: "paragraph", content: [{ type: "text", text: "/" }] })
      .setTextSelection(at + 2)
      .run();
  }

  function duplicate() {
    const t = target.current;
    if (!t) return;
    editor
      .chain()
      .focus()
      .insertContentAt(t.pos + t.node.nodeSize, t.node.toJSON())
      .run();
  }

  function move(direction: -1 | 1) {
    const t = target.current;
    if (!t) return;
    const { state, view } = editor;
    const $pos = state.doc.resolve(t.pos);
    const index = $pos.index();
    const parent = $pos.parent;
    const sibling = parent.maybeChild(index + direction);
    if (!sibling) return;
    const tr = state.tr.delete(t.pos, t.pos + t.node.nodeSize);
    const at = direction === -1 ? t.pos - sibling.nodeSize : t.pos + sibling.nodeSize;
    tr.insert(at, t.node);
    view.dispatch(tr.scrollIntoView());
    target.current = { node: t.node, pos: at };
  }

  function remove() {
    const t = target.current;
    if (!t) return;
    editor
      .chain()
      .focus()
      .deleteRange({ from: t.pos, to: t.pos + t.node.nodeSize })
      .run();
  }

  return (
    <DragHandle
      editor={editor}
      className="note-block-handle"
      onNodeChange={({ node, pos }) => {
        if (menuOpen) return;
        target.current = node ? { node, pos } : null;
        setTextual(node?.isTextblock ?? true);
      }}
    >
      <div className="relative flex items-center gap-0.5">
        <button
          type="button"
          aria-label="Add a block below"
          title="Add a block below"
          onClick={addBelow}
          className="note-handle-button"
        >
          <Plus className="size-4" aria-hidden="true" />
        </button>
        {/* A click (not a drag) opens the menu: Radix's own trigger opens on
            pointer-down, which would fight the drag. */}
        <button
          type="button"
          aria-label="Drag to move, or click for block actions"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title="Drag to move · click for more"
          onClick={() => {
            setMenuOpen(true);
            lock(editor, true);
          }}
          className="note-handle-button cursor-grab active:cursor-grabbing"
        >
          <GripVertical className="size-4" aria-hidden="true" />
        </button>
        <DropdownMenu
          modal={false}
          open={menuOpen}
          onOpenChange={(open) => {
            setMenuOpen(open);
            lock(editor, open);
          }}
        >
          <DropdownMenuTrigger asChild>
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 right-0 w-7"
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="left" className="w-52">
            {textual && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Repeat2 className="size-4" aria-hidden="true" />
                  Turn into
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-48">
                  {TURN_INTO.map((item) => (
                    <DropdownMenuItem
                      key={item.label}
                      onSelect={() => {
                        if (target.current) selectInside(target.current);
                        item.run(editor);
                      }}
                    >
                      <item.icon className="size-4" aria-hidden="true" />
                      {item.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            <DropdownMenuItem onSelect={duplicate}>
              <Copy className="size-4" aria-hidden="true" />
              Duplicate
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => move(-1)}>
              <ArrowUp className="size-4" aria-hidden="true" />
              Move up
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => move(1)}>
              <ArrowDown className="size-4" aria-hidden="true" />
              Move down
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={remove}>
              <Trash2 className="size-4" aria-hidden="true" />
              Delete block
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </DragHandle>
  );
}
