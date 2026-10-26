"use client";

import "./editor.css";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Editor } from "@tiptap/core";
import type { EditorView } from "@tiptap/pm/view";
import { EditorContent, useEditor, useEditorState, type JSONContent } from "@tiptap/react";
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
  MessageSquarePlus,
  Strikethrough,
  Underline as UnderlineIcon,
} from "@/components/icons";

import { dismissToast, toast } from "@/components/ui/toaster";
import { NOTE_FIELD, type CollabUser } from "@/lib/collab/protocol";
import { uploadNoteFile } from "@/lib/files/upload";
import { bandFooter, bandHeader, paperPx } from "@/lib/notes/paper";
import { noteSchemaExtensions } from "@/lib/notes/schema-extensions";
import { cn } from "@/lib/utils";

import { BlockHandle } from "./block-handle";
import { renderCaret, renderSelection } from "./carets";
import { CommentHighlights } from "./comment-highlights";
import { EditorToolbar } from "./editor-toolbar";
import { EmbedPickerDialog, TaskInsertDialog } from "./insert-dialogs";
import { noteMentionWithMenus, type MentionMember, type MentionPage } from "./mention-suggestions";
import { NoteHooksExtension, noteHooks, setNoteHooks } from "./note-hooks";
import { nodeViewOverrides, NoteViewContext } from "./node-views";
import { Pagination, paginationKey } from "./pagination";
import { SlashCommand } from "./slash-command-extension";
import { Suggesting } from "./suggesting";

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

/** Where the note lives, for links, uploads and the live pieces. */
export interface NoteEditorPlace {
  orgId: string;
  orgSlug: string;
  noteId: string;
  /** Uploaded images and files follow the note's own visibility. */
  visibility: "PRIVATE" | "ORGANIZATION";
  members: MentionMember[];
  pages: MentionPage[];
  viewer: { id: string; name: string | null };
  /** Document mode's header and footer: the title and club, unless the note has its own text. */
  title: string;
  orgName: string;
  headerText?: string | null;
  footerText?: string | null;
}

const DEFAULT_PLACE: NoteEditorPlace = {
  orgId: "",
  orgSlug: "",
  noteId: "",
  visibility: "PRIVATE",
  members: [],
  pages: [],
  viewer: { id: "", name: null },
  title: "",
  orgName: "",
};

export function NoteEditor({
  content,
  editable,
  onChange,
  collaboration,
  layout = "PAGE",
  paperSize = "LETTER",
  place = DEFAULT_PLACE,
  canComment = false,
  onComment,
  onEditor,
  onClickThread,
  onCreateSubpage,
}: {
  content?: JSONContent;
  editable: boolean;
  onChange?: (contentJson: JSONContent, contentText: string) => void;
  collaboration?: NoteEditorCollaboration;
  layout?: "PAGE" | "DOCUMENT";
  paperSize?: "LETTER" | "A4";
  place?: NoteEditorPlace;
  /** Whoever can see the note comments (the bubble menu's Comment). */
  canComment?: boolean;
  onComment?: () => void;
  /** The editor instance, for the comment and history rail. */
  onEditor?: (editor: Editor | null) => void;
  onClickThread?: (threadId: string) => void;
  /** Makes a page inside this one; null when it couldn't. */
  onCreateSubpage?: () => Promise<{ id: string; title: string } | null>;
}) {
  const isDocument = layout === "DOCUMENT";
  const paper = paperPx(paperSize);
  const bandTop = bandHeader(place);
  const bandBottom = bandFooter(place);
  // Narrow screens get the sheet without page breaks (it no longer has its real width).
  const narrow = useSyncExternalStore(subscribeNarrow, isNarrow, () => false);
  const paginate = isDocument && !narrow;
  // The menus read the latest lists without rebuilding the editor.
  const placeRef = useRef(place);
  const clickThread = useRef(onClickThread);
  // The body as last typed: a new layout rebuilds the editor from it.
  const latestContent = useRef<JSONContent | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const editableRef = useRef(editable);
  useEffect(() => {
    placeRef.current = place;
    clickThread.current = onClickThread;
    editableRef.current = editable;
  });

  const extensions = useMemo(
    () => [
      ...noteSchemaExtensions({
        collaborative: Boolean(collaboration),
        override: {
          ...nodeViewOverrides(),
          mention: noteMentionWithMenus(),
        },
      }),
      Placeholder.configure({
        placeholder: ({ node }) =>
          node.type.name === "heading"
            ? "Heading"
            : node.type.name === "detailsSummary"
              ? "Toggle"
              : "Write something, or press “/” for blocks…",
        includeChildren: true,
      }),
      Markdown.configure({ html: false, transformPastedText: true, transformCopiedText: false }),
      SlashCommand,
      NoteHooksExtension,
      Suggesting,
      CommentHighlights,
      Pagination.configure({
        enabled: paginate,
        contentHeight: paper.contentHeight,
        margin: paper.margin,
        gap: 28,
        header: bandTop,
        footer: bandBottom,
      }),
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
    // The schema and plugins are fixed for an editor; a new layout, paper or
    // header and footer text rebuilds it (the document stays: same content or
    // the same Y.Doc).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      collaboration?.doc,
      collaboration?.provider,
      isDocument,
      paginate,
      paper.contentHeight,
      place.headerText,
      place.footerText,
    ],
  );

  const editor = useEditor(
    {
      editable,
      immediatelyRender: false,
      extensions,
      // A live editor takes its content from the Y.Doc; passing content too
      // would insert it a second time.
      content: collaboration ? undefined : content,
      // Rebuilt for a new layout: carry on from what was typed.
      onCreate: ({ editor: created }) => {
        if (!collaboration && latestContent.current) {
          created.commands.setContent(latestContent.current, { emitUpdate: false });
        }
      },
      editorProps: {
        attributes: {
          class: cn(
            "tiptap prose prose-sm sm:prose-base dark:prose-invert max-w-none focus:outline-none prose-headings:tracking-tight prose-a:text-foreground prose-li:my-0.5",
            isDocument && "prose-document",
          ),
        },
        handlePaste: (view, event) => pasteImages(view, event.clipboardData?.files),
        handleDrop: (view, event) => pasteImages(view, (event as DragEvent).dataTransfer?.files),
      },
      onUpdate: ({ editor, transaction }) => {
        // onUpdate fires for any dispatched transaction, including no-op ones
        // from plugin initialization (e.g. decoration setup) that never touch
        // the document — only autosave on transactions that actually changed it.
        if (!transaction.docChanged) return;
        latestContent.current = editor.getJSON();
        onChange?.(latestContent.current, editor.getText());
      },
    },
    [extensions],
  );

  useEffect(() => {
    editorRef.current = editor ?? null;
  }, [editor]);

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editable, editor]);

  useEffect(() => {
    onEditor?.(editor ?? null);
    return () => onEditor?.(null);
  }, [editor, onEditor]);

  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState("");
  const [taskOpen, setTaskOpen] = useState(false);
  const [embedKind, setEmbedKind] = useState<"database" | "poll" | null>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Uploads go to the club's files (they count toward storage).
  async function upload(file: File): Promise<{ id: string; name: string } | null> {
    // The route or a direct upload by size, with the plan's quota errors.
    const result = await uploadNoteFile(placeRef.current.orgId, file, {
      visibility: placeRef.current.visibility,
    });
    if (!result.ok) {
      toast({ title: result.error, tone: "error" });
      return null;
    }
    return result.file;
  }

  async function insertUploads(files: File[], asImage?: boolean) {
    for (const file of files) {
      const image = asImage ?? file.type.startsWith("image/");
      const pending = toast({ title: `Uploading ${file.name}…`, duration: 60_000 });
      const stored = await upload(file);
      dismissToast(pending);
      const editor = editorRef.current;
      if (!stored || !editor || editor.isDestroyed) continue;
      const src = `/api/orgs/${encodeURIComponent(placeRef.current.orgId)}/files/${encodeURIComponent(stored.id)}`;
      editor
        .chain()
        .focus()
        .insertContent(
          image
            ? { type: "image", attrs: { src, alt: stored.name, fileId: stored.id } }
            : {
                type: "fileAttachment",
                attrs: {
                  fileId: stored.id,
                  name: stored.name,
                  contentType: file.type || null,
                  sizeBytes: file.size,
                },
              },
        )
        .run();
    }
  }

  // The slash menu's dialogs and uploads.
  useEffect(() => {
    if (!editor) return;
    setNoteHooks(editor, {
      people: () => placeRef.current.members,
      pages: () => placeRef.current.pages,
      selfId: () => placeRef.current.viewer.id || null,
      noteId: () => placeRef.current.noteId || null,
      clickThread: (id) => clickThread.current?.(id),
      uploadImages: (files) => {
        if (!editableRef.current) return false;
        void insertUploads(files, true);
        return true;
      },
      uploadImage: () => imageInput.current?.click(),
      uploadFile: () => fileInput.current?.click(),
      insertTask: () => setTaskOpen(true),
      insertEmbed: (kind) => setEmbedKind(kind),
      createSubpage: () => {
        void (async () => {
          const page = await onCreateSubpage?.();
          if (!page || editor.isDestroyed) return;
          editor
            .chain()
            .focus()
            .insertContent([
              { type: "noteLink", attrs: { noteId: page.id, title: page.title } },
              { type: "text", text: " " },
            ])
            .run();
        })();
      },
    });
    return () => setNoteHooks(editor, null);
    // insertUploads reads only refs, so it needn't re-register the hooks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, onCreateSubpage]);

  const viewContext = useMemo(
    () => ({
      orgId: place.orgId,
      orgSlug: place.orgSlug,
      editable,
      pages: new Map(place.pages.map((p) => [p.id, { title: p.title, icon: p.icon }])),
    }),
    [place.orgId, place.orgSlug, place.pages, editable],
  );

  if (!editor) return <div className="bg-muted/30 rounded-tile h-64 animate-pulse" />;

  const body = (
    <>
      <BubbleMenu
        editor={editor}
        className="glass flex items-center gap-0.5 rounded-full p-1"
        shouldShow={({ editor: e, state }) =>
          !state.selection.empty && (e.isEditable || canComment) && !e.isActive("image")
        }
      >
        <FormatCapsule
          editor={editor}
          canComment={canComment}
          onComment={onComment}
          onLink={() => {
            setLinkValue(editor.getAttributes("link").href ?? "");
            setLinkOpen(true);
          }}
        />
      </BubbleMenu>
      {editable && !isDocument && <BlockHandle editor={editor} />}
      <EditorContent
        editor={editor}
        className={cn("note-editor-content", !isDocument && "min-h-[40vh]")}
      />
    </>
  );

  return (
    <NoteViewContext.Provider value={viewContext}>
      <div className={cn("note-editor min-w-0 space-y-4", isDocument ? "is-document" : "is-page")}>
        {editable && isDocument && (
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
            className="bg-card edge mx-auto flex max-w-xl items-center gap-2 rounded-full px-4 py-2"
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
        {isDocument ? (
          <div className="note-desk">
            <div className="note-ruler" style={{ width: paper.width }} aria-hidden="true">
              <span style={{ left: paper.margin }} />
              <span style={{ right: paper.margin }} />
            </div>
            <div
              className="note-paper"
              style={
                {
                  "--paper-width": `${paper.width}px`,
                  "--paper-margin": `${paper.margin}px`,
                } as React.CSSProperties
              }
            >
              <div className="note-page-band note-page-header note-first-header" aria-hidden="true">
                {bandTop}
              </div>
              {body}
              <PageCount editor={editor} footer={bandBottom} />
            </div>
          </div>
        ) : (
          body
        )}
      </div>
      <input
        ref={imageInput}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          void insertUploads(files, true);
        }}
      />
      <input
        ref={fileInput}
        type="file"
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          void insertUploads(files);
        }}
      />
      <TaskInsertDialog
        orgId={place.orgId}
        open={taskOpen}
        initialTitle=""
        onClose={() => setTaskOpen(false)}
        onCreated={(task) => {
          setTaskOpen(false);
          editor
            .chain()
            .focus()
            .insertContent({ type: "taskChip", attrs: { taskId: task.id, title: task.title } })
            .run();
        }}
      />
      <EmbedPickerDialog
        orgId={place.orgId}
        kind={embedKind}
        onClose={() => setEmbedKind(null)}
        onPick={(target) => {
          setEmbedKind(null);
          editor
            .chain()
            .focus()
            .insertContent({
              type: "linkCard",
              attrs: { kind: target.kind, path: target.path, title: target.title },
            })
            .run();
        }}
      />
    </NoteViewContext.Provider>
  );
}

/** The last sheet's footer, with the page count. */
function PageCount({ editor, footer }: { editor: Editor; footer: string }) {
  const pages = useEditorState({
    editor,
    selector: ({ editor: e }) => paginationKey.getState(e.state)?.pages ?? 1,
  });
  return (
    <div className="note-page-band note-page-footer note-last-footer" aria-hidden="true">
      <span>{footer}</span>
      <span>{pages}</span>
    </div>
  );
}

/** The floating glass capsule over a selection: formatting, a link, a comment. */
function FormatCapsule({
  editor,
  canComment,
  onComment,
  onLink,
}: {
  editor: Editor;
  canComment: boolean;
  onComment?: () => void;
  onLink: () => void;
}) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      editable: e.isEditable,
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      code: e.isActive("code"),
      link: e.isActive("link"),
    }),
  });
  const tools = [
    {
      key: "bold",
      label: "Bold",
      icon: Bold,
      run: () => editor.chain().focus().toggleBold().run(),
    },
    {
      key: "italic",
      label: "Italic",
      icon: Italic,
      run: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      key: "underline",
      label: "Underline",
      icon: UnderlineIcon,
      run: () => editor.chain().focus().toggleUnderline().run(),
    },
    {
      key: "strike",
      label: "Strikethrough",
      icon: Strikethrough,
      run: () => editor.chain().focus().toggleStrike().run(),
    },
    {
      key: "code",
      label: "Inline code",
      icon: Code,
      run: () => editor.chain().focus().toggleCode().run(),
    },
    { key: "link", label: "Link", icon: LinkIcon, run: onLink },
  ] as const;

  return (
    <>
      {state.editable &&
        tools.map((tool) => (
          <button
            key={tool.key}
            type="button"
            aria-label={tool.label}
            title={tool.label}
            aria-pressed={state[tool.key]}
            onMouseDown={(e) => e.preventDefault()}
            onClick={tool.run}
            className="note-capsule-button"
          >
            <tool.icon className="size-4" aria-hidden="true" />
          </button>
        ))}
      {canComment && onComment && (
        <>
          {state.editable && (
            <span className="bg-chrome-foreground/20 mx-1 h-5 w-px" aria-hidden="true" />
          )}
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onComment}
            className="note-capsule-button w-auto gap-1.5 px-3 text-[13px] font-medium"
          >
            <MessageSquarePlus className="size-4" aria-hidden="true" />
            Comment
          </button>
        </>
      )}
    </>
  );
}

/** Pasted or dropped pictures go up to the club's files (the page's hook does it). */
function pasteImages(view: EditorView, list: FileList | null | undefined): boolean {
  const files = Array.from(list ?? []).filter((f) => f.type.startsWith("image/"));
  if (files.length === 0) return false;
  const editor = (view.dom as HTMLElement & { editor?: Editor }).editor;
  const hooks = editor ? noteHooks(editor) : null;
  return hooks ? hooks.uploadImages(files) : false;
}

const NARROW = "(max-width: 900px)";

function subscribeNarrow(onChange: () => void) {
  if (typeof window.matchMedia !== "function") return () => undefined;
  const query = window.matchMedia(NARROW);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function isNarrow() {
  return typeof window.matchMedia === "function" && window.matchMedia(NARROW).matches;
}
