"use client";

import { useEffect, useState } from "react";
import { EditorContent, useEditor, type JSONContent } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";
import type { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";
import {
  Bold,
  Code,
  Italic,
  Link as LinkIcon,
  Strikethrough,
  Underline as UnderlineIcon,
} from "lucide-react";

import { NOTE_FIELD, type CollabUser } from "@/lib/collab/protocol";
import { noteSchemaExtensions } from "@/lib/notes/schema-extensions";
import { cn } from "@/lib/utils";
import { renderCaret, renderSelection } from "./carets";
import { EditorToolbar, NoteOutline } from "./editor-toolbar";
import { SlashCommand } from "./slash-command-extension";

export interface NoteEditorHandle {
  getJSON: () => JSONContent;
  getText: () => string;
}

/**
 * A live note (docs/features/collaboration.md): the editor binds to this
 * Y.Doc instead of `content`, and shows other editors' carets from the
 * provider's awareness. The body is saved by the collaboration server.
 */
export interface NoteEditorCollaboration {
  doc: Y.Doc;
  provider: { awareness: Awareness };
  user: CollabUser;
}

export function NoteEditor({
  content,
  editable,
  onChange,
  collaboration,
}: {
  content?: JSONContent;
  editable: boolean;
  onChange?: (contentJson: JSONContent, contentText: string) => void;
  collaboration?: NoteEditorCollaboration;
}) {
  const editor = useEditor({
    editable,
    immediatelyRender: false,
    extensions: [
      ...noteSchemaExtensions({ collaborative: Boolean(collaboration) }),
      Placeholder.configure({ placeholder: "Write something, or press “/” for commands…" }),
      Markdown.configure({ html: false, transformPastedText: true, transformCopiedText: false }),
      SlashCommand,
      ...(collaboration
        ? [
            Collaboration.configure({ document: collaboration.doc, field: NOTE_FIELD }),
            CollaborationCaret.configure({
              provider: collaboration.provider,
              user: collaboration.user,
              render: renderCaret,
              selectionRender: renderSelection,
            }),
          ]
        : []),
    ],
    // A live editor takes its content from the Y.Doc; passing content too
    // would insert it a second time.
    content: collaboration ? undefined : content,
    editorProps: {
      attributes: {
        class:
          "tiptap prose prose-sm sm:prose-base dark:prose-invert max-w-none focus:outline-none prose-headings:tracking-tight prose-a:text-primary prose-li:my-0.5",
      },
    },
    onUpdate: ({ editor, transaction }) => {
      // onUpdate fires for any dispatched transaction, including no-op ones
      // from plugin initialization (e.g. decoration setup) that never touch
      // the document — only autosave on transactions that actually changed it.
      if (!transaction.docChanged) return;
      onChange?.(editor.getJSON(), editor.getText());
    },
  });

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editable, editor]);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState("");

  if (!editor) return <div className="bg-muted/30 h-64 animate-pulse rounded-lg" />;

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_12rem]">
      <div className="min-w-0 space-y-4">
        {editable && (
          <EditorToolbar
            editor={editor}
            showHistory={!collaboration}
            onLink={() => {
              setLinkValue(editor.getAttributes("link").href ?? "");
              setLinkOpen(true);
            }}
          />
        )}
        {linkOpen && (
          <form
            className="flex items-center gap-2 rounded-lg border p-2"
            onSubmit={(e) => {
              e.preventDefault();
              const url = linkValue.trim();
              if (url) editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
              else editor.chain().focus().extendMarkRange("link").unsetLink().run();
              setLinkOpen(false);
            }}
          >
            <LinkIcon className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
            <input
              autoFocus
              value={linkValue}
              onChange={(e) => setLinkValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setLinkOpen(false);
              }}
              placeholder="Paste a link, then press Enter (empty removes it)"
              aria-label="Link address"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
          </form>
        )}
        <BubbleMenu
          editor={editor}
          className="bg-popover flex items-center gap-1 rounded-md border p-1 shadow-md"
        >
          <BubbleMenuContent editor={editor} />
        </BubbleMenu>
        <EditorContent editor={editor} className="min-h-[40vh]" />
      </div>
      <div className="hidden xl:block">
        <div className="sticky top-20">
          <NoteOutline editor={editor} />
        </div>
      </div>
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
