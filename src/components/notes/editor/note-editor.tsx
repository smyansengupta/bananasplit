"use client";

import { useEffect, useState } from "react";
import { EditorContent, useEditor, type JSONContent } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";
import {
  Bold,
  Code,
  Italic,
  Link as LinkIcon,
  Strikethrough,
  Underline as UnderlineIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { SlashCommand } from "./slash-command-extension";

export interface NoteEditorHandle {
  getJSON: () => JSONContent;
  getText: () => string;
}

export function NoteEditor({
  content,
  editable,
  onChange,
}: {
  content: JSONContent;
  editable: boolean;
  onChange: (contentJson: JSONContent, contentText: string) => void;
}) {
  const editor = useEditor({
    editable,
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        link: { openOnClick: false, autolink: true },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
      Placeholder.configure({ placeholder: "Write something, or press “/” for commands…" }),
      Markdown.configure({ html: false, transformPastedText: true, transformCopiedText: false }),
      SlashCommand,
    ],
    content,
    editorProps: {
      attributes: {
        class: "tiptap prose prose-sm dark:prose-invert max-w-none focus:outline-none",
      },
    },
    onUpdate: ({ editor, transaction }) => {
      // onUpdate fires for any dispatched transaction, including no-op ones
      // from plugin initialization (e.g. decoration setup) that never touch
      // the document — only autosave on transactions that actually changed it.
      if (!transaction.docChanged) return;
      onChange(editor.getJSON(), editor.getText());
    },
  });

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editable, editor]);

  if (!editor) return null;

  return (
    <div>
      <BubbleMenu
        editor={editor}
        className="flex items-center gap-1 rounded-md border p-1 shadow-md"
      >
        <BubbleMenuContent editor={editor} />
      </BubbleMenu>
      <EditorContent editor={editor} />
    </div>
  );
}

function BubbleMenuContent({ editor }: { editor: NonNullable<ReturnType<typeof useEditor>> }) {
  const [linkInputOpen, setLinkInputOpen] = useState(false);
  const [linkValue, setLinkValue] = useState("");

  if (linkInputOpen) {
    return (
      <form
        className="flex items-center gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          const url = linkValue.trim();
          if (url) {
            editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
          } else {
            editor.chain().focus().extendMarkRange("link").unsetLink().run();
          }
          setLinkInputOpen(false);
          setLinkValue("");
        }}
      >
        <input
          autoFocus
          value={linkValue}
          onChange={(e) => setLinkValue(e.target.value)}
          placeholder="https://…"
          className="bg-background w-48 rounded border px-2 py-1 text-xs outline-none"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setLinkInputOpen(false);
              setLinkValue("");
            }
          }}
        />
      </form>
    );
  }

  return (
    <>
      <ToolbarButton
        active={editor.isActive("bold")}
        label="Bold"
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive("italic")}
        label="Italic"
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive("underline")}
        label="Underline"
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      >
        <UnderlineIcon className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive("strike")}
        label="Strikethrough"
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <Strikethrough className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive("code")}
        label="Inline code"
        onClick={() => editor.chain().focus().toggleCode().run()}
      >
        <Code className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive("link")}
        label="Link"
        onClick={() => {
          setLinkValue(editor.getAttributes("link").href ?? "");
          setLinkInputOpen(true);
        }}
      >
        <LinkIcon className="size-4" />
      </ToolbarButton>
    </>
  );
}

function ToolbarButton({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "hover:bg-accent hover:text-accent-foreground flex size-7 items-center justify-center rounded-sm",
        active && "bg-accent text-accent-foreground",
      )}
    >
      {children}
    </button>
  );
}
