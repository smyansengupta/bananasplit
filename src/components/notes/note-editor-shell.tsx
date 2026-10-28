"use client";

import type { Editor } from "@tiptap/core";
import { generateText, type JSONContent } from "@tiptap/react";
import { formatDistanceToNow } from "date-fns";
import {
  Check,
  ChevronRight,
  CloudOff,
  Download,
  FileText,
  History,
  Link2,
  ListChecks,
  Loader2,
  MessageSquare,
  PanelLeft,
  PanelRightClose,
  PanelTop,
  PencilLine,
  RotateCcw,
  Trash2,
} from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import {
  createNote,
  deleteNote,
  restoreNote,
  updateNote,
  updateNoteDetails,
  updateNoteSettings,
  type NoteDetailsInput,
} from "@/app/app/[orgSlug]/notes/actions";
import type { VersionListItem } from "@/app/app/[orgSlug]/notes/version-actions";
import { restoreNoteVersion } from "@/app/app/[orgSlug]/notes/version-actions";
import { ActionItemsImport } from "@/components/ai/action-items-import";
import { ItemMenu } from "@/components/item-menu";
import { PresenceBar } from "@/components/notes/collab/presence-bar";
import { useNoteCollab, type NoteCollabState } from "@/components/notes/collab/use-note-collab";
import { downloadNotePdf } from "@/components/notes/download-pdf-button";
import {
  anchorForSelection,
  setHighlightThreads,
} from "@/components/notes/editor/comment-highlights";
import { NoteEditor, type NoteEditorPlace } from "@/components/notes/editor/note-editor";
import { setSuggesting } from "@/components/notes/editor/suggesting";
import { EventLinkPicker, type EventOption } from "@/components/notes/event-link-picker";
import {
  clearNoteBackup,
  parseNoteBackup,
  readNoteBackupRaw,
  writeNoteBackup,
} from "@/components/notes/note-backup";
import { ShareNoteDialog, type NoteSharingInfo } from "@/components/notes/share-note-dialog";
import { useAutosave, type SaveStatus } from "@/components/notes/use-autosave";
import {
  CommentsPanel,
  groupThreads,
  type CommentDraft,
} from "@/components/notes/workspace/comments-panel";
import { HistoryPanel, type PreviewVersion } from "@/components/notes/workspace/history-panel";
import { HeaderFooterDialog } from "@/components/notes/workspace/header-footer-dialog";
import { IconPicker } from "@/components/notes/workspace/icon-picker";
import { NotesTree, type TreePage } from "@/components/notes/workspace/notes-tree";
import { SuggestionsPanel } from "@/components/notes/workspace/suggestions-panel";
import { VersionPreview } from "@/components/notes/workspace/version-preview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toaster";
import { bandFooter, bandHeader } from "@/lib/notes/paper";
import { noteSchemaExtensions } from "@/lib/notes/schema-extensions";
import { NOTE_TRASH_DAYS } from "@/lib/notes/trash";
import { cn } from "@/lib/utils";
import type { NoteCollabSession } from "@/server/collab/session";
import type { NoteCommentDto } from "@/server/notes/comments";

type Visibility = "PRIVATE" | "ORGANIZATION";
type Layout = "PAGE" | "DOCUMENT";
type Paper = "LETTER" | "A4";

/** Who sees the note is the Share dialog's, so a save never carries it. */
interface NotePayload {
  title: string;
  /** JSON.stringify'd ProseMirror doc — see the comment on the server schema. */
  contentJson: string;
  contentText: string;
  eventId: string | null;
}

/** The pages around this one, its threads and its history (Moonstone 13.1). */
export interface NoteWorkspace {
  orgName: string;
  pages: TreePage[];
  favoriteIds: string[];
  backlinks: { id: string; title: string; icon: string | null }[];
  comments: NoteCommentDto[];
  versions: VersionListItem[];
  icon: string | null;
  parentId: string | null;
  layout: Layout;
  paperSize: Paper;
  /** Document mode's header and footer text (null: the default). */
  headerText: string | null;
  footerText: string | null;
  updatedAt: string;
  updatedByName: string | null;
  /** ?comment= in the link from a notification. */
  focusCommentId: string | null;
  /** How long autosave snapshots are kept (the plan's note-history window). */
  historyDays: number;
}

export interface NoteEditorShellProps {
  orgId: string;
  orgSlug: string;
  note: {
    id: string;
    title: string;
    contentJson: JSONContent;
    contentText: string;
    visibility: Visibility;
    eventId: string | null;
    version: number;
  };
  canEdit: boolean;
  events: EventOption[];
  /** Who has access, and whether this viewer may change it (the Share button). */
  sharing: NoteSharingInfo;
  /**
   * The page's live-collaboration session, or null while collaboration is
   * off (docs/features/collaboration.md). Without one, or when joining
   * fails, this is the autosave editor exactly as before.
   */
  collab?: NoteCollabSession | null;
  workspace?: NoteWorkspace;
  /** A Personal space: the note is its owner's alone, so there's no Share button. */
  personal?: boolean;
  /**
   * Offer "Make tasks from this note" (an AI import): clubs, and Personal
   * Plus, which has AI; Personal Free doesn't.
   */
  canMakeTasks?: boolean;
}

const EMPTY_WORKSPACE: NoteWorkspace = {
  orgName: "",
  pages: [],
  favoriteIds: [],
  backlinks: [],
  comments: [],
  versions: [],
  icon: null,
  parentId: null,
  layout: "PAGE",
  paperSize: "LETTER",
  headerText: null,
  footerText: null,
  updatedAt: new Date(0).toISOString(),
  updatedByName: null,
  focusCommentId: null,
  historyDays: 90,
};

type RailTab = "comments" | "history" | "suggestions";

const noSubscribe = () => () => undefined;

/**
 * The note page (Moonstone 13.1): the notes tree on the left, the editor in
 * the middle, comments and version history in the rail on the right (a
 * sheet on phones). The top bar has the breadcrumbs, who else is here, the
 * Page | Document switch, Share and history. Page mode is like Notion
 * (blocks, handles, slash menu, nested pages); Document mode like Google
 * Docs (paper, margins, page breaks, comments in the margin). Switching
 * never changes the content.
 */
export function NoteEditorShell({
  orgId,
  orgSlug,
  note,
  canEdit,
  events,
  sharing,
  collab = null,
  workspace = EMPTY_WORKSPACE,
  personal = false,
  canMakeTasks = true,
}: NoteEditorShellProps) {
  const router = useRouter();
  const [title, setTitle] = useState(note.title);
  const [eventId, setEventId] = useState(note.eventId);
  const [layout, setLayout] = useState<Layout>(workspace.layout);
  const [paperSize, setPaperSize] = useState<Paper>(workspace.paperSize);
  const [bands, setBands] = useState({
    headerText: workspace.headerText,
    footerText: workspace.footerText,
  });
  const [bandsOpen, setBandsOpen] = useState(false);
  const [icon, setIcon] = useState<string | null>(workspace.icon);
  const versionRef = useRef(note.version);
  const contentRef = useRef({ json: note.contentJson, text: note.contentText });
  // Restoring a backup or a version remounts the editor with that content.
  const [restored, setRestored] = useState<{ json: JSONContent; n: number } | null>(null);
  const [backupHandled, setBackupHandled] = useState(false);
  // Once this visit writes its own backup, the one found on arrival is stale.
  const [wroteBackup, setWroteBackup] = useState(false);
  const [confirmEl, confirm] = useConfirm();
  // "Make tasks from this note": the note's text at the moment it's opened.
  const [importText, setImportText] = useState<string | null>(null);

  const [editor, setEditor] = useState<Editor | null>(null);
  const [comments, setComments] = useState(workspace.comments);
  const [versions, setVersions] = useState(workspace.versions);
  const [railTab, setRailTab] = useState<RailTab>("comments");
  const [railOpen, setRailOpen] = useState(
    Boolean(workspace.focusCommentId) || workspace.layout === "DOCUMENT",
  );
  const [sheetRail, setSheetRail] = useState(false);
  const [treeSheet, setTreeSheet] = useState(false);
  const [draft, setDraft] = useState<CommentDraft | null>(null);
  const [activeThread, setActiveThread] = useState<string | null>(workspace.focusCommentId);
  const [preview, setPreview] = useState<PreviewVersion | null>(null);
  const [suggesting, setSuggestingMode] = useState(false);
  const wide = useSyncExternalStore(subscribeWide, isWide, () => true);
  const phone = useSyncExternalStore(subscribePhone, isPhone, () => false);

  const session = useNoteCollab({ orgId, noteId: note.id, initial: collab });
  // The collaborative editor, once joined (it stays, read-only, if the
  // connection is interrupted).
  const live = session.mode === "live" || session.mode === "interrupted" ? session.live : null;

  // A copy of edits the server never got (this browser only).
  const backupRaw = useSyncExternalStore(
    noSubscribe,
    () => readNoteBackupRaw(note.id),
    () => null,
  );
  const backup = parseNoteBackup(backupRaw);
  const showBackup =
    !backupHandled &&
    !wroteBackup &&
    !live &&
    canEdit &&
    backup !== null &&
    (backup.contentText !== note.contentText || backup.title !== note.title);

  // The autosave path: the whole note, version-checked. The snapshot is
  // kept locally until the server confirms it.
  const { status, schedule, flush, retry } = useAutosave<NotePayload>({
    save: async (payload) => {
      writeNoteBackup(note.id, {
        title: payload.title,
        contentJson: payload.contentJson,
        contentText: payload.contentText,
        baseVersion: versionRef.current,
        savedAt: Date.now(),
      });
      setWroteBackup(true);
      const result = await updateNote(orgId, note.id, payload, versionRef.current);
      if (result.version) versionRef.current = result.version;
      if (!result.error && !result.conflict) clearNoteBackup(note.id);
      return result;
    },
  });

  // The live path: the collaboration server saves the body, so only the
  // fields that changed are sent, and each save starts a fresh batch.
  const detailsRef = useRef<NoteDetailsInput>({});
  const {
    status: detailsStatus,
    schedule: scheduleDetails,
    flush: flushDetails,
  } = useAutosave<NoteDetailsInput>({
    save: (patch) => {
      detailsRef.current = {};
      return updateNoteDetails(orgId, note.id, patch);
    },
  });

  const canType = live
    ? session.mode === "live" && session.canWrite
    : canEdit && status !== "conflict" && session.mode !== "connecting";

  const queueSave = useCallback(
    (overrides: Partial<NotePayload>) => {
      if (!canType) return;
      if (live) {
        const { title: t, eventId: e } = overrides;
        detailsRef.current = {
          ...detailsRef.current,
          ...(t !== undefined ? { title: t } : {}),
          ...(e !== undefined ? { eventId: e } : {}),
        };
        scheduleDetails(detailsRef.current);
        return;
      }
      schedule({
        title,
        contentJson: JSON.stringify(contentRef.current.json),
        contentText: contentRef.current.text,
        eventId,
        ...overrides,
      });
    },
    [canType, live, scheduleDetails, schedule, title, eventId],
  );

  // ---- Comments: highlights follow the threads -------------------------------
  const threads = useMemo(
    () =>
      groupThreads(comments).map((t) => ({
        id: t.root.id,
        anchorText: t.root.anchorText,
        anchor: t.root.anchor,
        resolved: Boolean(t.root.resolvedAt),
      })),
    [comments],
  );
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.view.dispatch(setHighlightThreads(editor.state.tr, threads, activeThread));
  }, [editor, threads, activeThread]);

  // Suggesting mode lives in the editor (and survives a rebuilt one).
  useEffect(() => {
    if (!editor) return;
    setSuggesting(editor, suggesting && canType, {
      id: sharing.viewerId,
      name: sharing.members.find((m) => m.id === sharing.viewerId)?.name ?? "Someone",
    });
  }, [editor, suggesting, canType, sharing.viewerId, sharing.members]);

  const onEditor = useCallback((e: Editor | null) => setEditor(e), []);

  function openRail(tab: RailTab) {
    setRailTab(tab);
    if (wide) setRailOpen(true);
    else setSheetRail(true);
  }

  function startComment() {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    const anchor = anchorForSelection(editor.state);
    setDraft({
      anchor,
      anchorText:
        from < to ? editor.state.doc.textBetween(from, to, "\n", "￼").slice(0, 1000) : null,
    });
    openRail("comments");
  }

  // ---- Page settings ------------------------------------------------------------
  function saveSettings(patch: {
    icon?: string | null;
    layout?: Layout;
    paperSize?: Paper;
    headerText?: string | null;
    footerText?: string | null;
  }) {
    void updateNoteSettings(orgId, note.id, patch).then((r) => {
      if (r.error) toast({ title: r.error, tone: "error" });
      else router.refresh();
    });
  }

  function restoreBackup() {
    if (!backup) return;
    let json: JSONContent;
    try {
      json = JSON.parse(backup.contentJson) as JSONContent;
    } catch {
      clearNoteBackup(note.id);
      setBackupHandled(true);
      return;
    }
    contentRef.current = { json, text: backup.contentText };
    setTitle(backup.title);
    setRestored((r) => ({ json, n: (r?.n ?? 0) + 1 }));
    setBackupHandled(true);
    schedule({
      title: backup.title,
      contentJson: backup.contentJson,
      contentText: backup.contentText,
      eventId,
    });
  }

  async function restoreVersion(version: PreviewVersion) {
    if (!live) await flush();
    const result = await restoreNoteVersion(orgId, note.id, version.id, {
      live: Boolean(live),
      expectedVersion: versionRef.current,
    });
    if (result.error || !result.contentJson) {
      toast({ title: result.error ?? "Couldn't restore that version", tone: "error" });
      return;
    }
    const json = result.contentJson as JSONContent;
    if (live && editor) {
      // An edit to the shared document: everyone in the note merges it.
      editor.commands.setContent(json);
    } else {
      if (result.version) versionRef.current = result.version;
      let text = "";
      try {
        text = generateText(json, noteSchemaExtensions());
      } catch {
        text = "";
      }
      contentRef.current = { json, text };
      setRestored((r) => ({ json, n: (r?.n ?? 0) + 1 }));
    }
    if (result.versions) setVersions(result.versions);
    setPreview(null);
    toast({
      title: `Restored ${version.name ? `“${version.name}”` : "the autosave"}`,
      description: "What it replaced is in the history too.",
      tone: "success",
    });
  }

  async function remove() {
    const name = title.trim() || "Untitled note";
    const ok = await confirm({
      title: `Delete “${name}”?`,
      description: `It moves to Recently deleted in Files for ${NOTE_TRASH_DAYS} days, so you can bring it back.`,
      confirmLabel: "Delete note",
      run: async () => (await deleteNote(orgId, note.id)).error,
    });
    if (!ok) return;
    clearNoteBackup(note.id);
    router.push(`/app/${orgSlug}/notes`);
    toast({
      title: "Note deleted",
      description: name,
      action: {
        label: "Undo",
        run: async () => {
          const result = await restoreNote(orgId, note.id);
          if (result.error) return result.error;
          router.push(`/app/${orgSlug}/notes/${note.id}`);
        },
      },
    });
  }

  function copyLink() {
    void navigator.clipboard
      ?.writeText(`${window.location.origin}/app/${orgSlug}/notes/${note.id}`)
      .then(() => toast({ title: "Link copied", tone: "success", duration: 3_000 }))
      .catch(() => toast({ title: "Couldn't copy the link", tone: "error" }));
  }

  /** Saves what's pending first, so the file has the last edits. */
  async function download(kind: "pdf" | "docx" | "md") {
    const href =
      kind === "pdf"
        ? `/app/${orgSlug}/notes/${note.id}/pdf`
        : `/app/${orgSlug}/notes/${note.id}/export?format=${kind}`;
    const result = await downloadNotePdf(href, live ? flushDetails : flush);
    if (result === "rate-limited") {
      toast({
        title: "Too many downloads",
        description: "Try again in a few minutes.",
        tone: "error",
      });
    } else if (result === "error") {
      toast({ title: "Couldn't create the file", tone: "error" });
    }
  }

  const createSubpage = useCallback(async () => {
    const result = await createNote(orgId, { parentId: note.id });
    if (result.error || !result.noteId) {
      toast({ title: result.error ?? "Couldn't make the page", tone: "error" });
      return null;
    }
    toast({
      title: "Page created inside this one",
      tone: "success",
      action: {
        label: "Open",
        run: () => {
          router.push(`/app/${orgSlug}/notes/${result.noteId}`);
        },
      },
    });
    router.refresh();
    return { id: result.noteId, title: "Untitled note" };
  }, [orgId, orgSlug, note.id, router]);

  const pagesById = useMemo(
    () => new Map(workspace.pages.map((p) => [p.id, p])),
    [workspace.pages],
  );
  const ancestors = useMemo(() => {
    const chain: TreePage[] = [];
    const seen = new Set([note.id]);
    let parentId = workspace.parentId;
    while (parentId && !seen.has(parentId)) {
      const parent = pagesById.get(parentId);
      if (!parent) break;
      chain.unshift(parent);
      seen.add(parentId);
      parentId = parent.parentId;
    }
    return chain;
  }, [pagesById, workspace.parentId, note.id]);
  const subpages = workspace.pages.filter((p) => p.parentId === note.id);

  const place: NoteEditorPlace = useMemo(
    () => ({
      orgId,
      orgSlug,
      noteId: note.id,
      visibility: note.visibility,
      members: sharing.members,
      pages: workspace.pages,
      viewer: {
        id: sharing.viewerId,
        name: sharing.members.find((m) => m.id === sharing.viewerId)?.name ?? null,
      },
      title,
      orgName: workspace.orgName,
      headerText: bands.headerText,
      footerText: bands.footerText,
    }),
    [
      orgId,
      orgSlug,
      note.id,
      note.visibility,
      sharing.members,
      sharing.viewerId,
      workspace.pages,
      title,
      workspace.orgName,
      bands,
    ],
  );

  if (session.mode === "revoked") {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="bg-tint-danger text-tint-danger-foreground rounded-tile flex items-center justify-between gap-3 p-3 text-sm">
          <span>This note is no longer available to you.</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => router.push(`/app/${orgSlug}/notes`)}
          >
            Back to Files
          </Button>
        </div>
      </div>
    );
  }

  const effective = live ? detailsStatus : status;
  const isDocument = layout === "DOCUMENT";
  const openCount = comments.filter((c) => !c.threadId && !c.resolvedAt).length;
  const showTree = wide && !isDocument && workspace.pages.length > 0;
  const showRail = wide && railOpen;
  const author = sharing.members.find((m) => m.id === sharing.viewerId)?.name ?? "Someone";

  const tree = (
    <NotesTree
      orgId={orgId}
      orgSlug={orgSlug}
      currentId={note.id}
      // This page as it is being typed.
      pages={workspace.pages.map((p) => (p.id === note.id ? { ...p, title, icon } : p))}
      favoriteIds={workspace.favoriteIds}
      onNavigate={() => setTreeSheet(false)}
    />
  );

  const rail = (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Segmented
          label="Rail"
          className="min-w-0 flex-1 [&>button]:px-2.5"
          options={[
            { value: "comments", label: `Comments${openCount ? ` ${openCount}` : ""}` },
            { value: "history", label: "History" },
            ...(canEdit ? [{ value: "suggestions", label: "Suggestions" }] : []),
          ]}
          value={railTab}
          onSelect={(v) => setRailTab(v as RailTab)}
        />
        {wide && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Close the side panel"
            onClick={() => setRailOpen(false)}
          >
            <PanelRightClose className="size-4" aria-hidden="true" />
          </Button>
        )}
      </div>
      {railTab === "comments" && (
        <CommentsPanel
          orgId={orgId}
          noteId={note.id}
          editor={editor}
          viewerId={sharing.viewerId}
          canResolve={canEdit}
          canModerate={sharing.canShare}
          people={sharing.members}
          comments={comments}
          onComments={setComments}
          draft={draft}
          onDraftDone={() => setDraft(null)}
          activeId={activeThread}
          onActive={setActiveThread}
          aligned={isDocument && wide && !preview}
        />
      )}
      {railTab === "history" && (
        <HistoryPanel
          orgId={orgId}
          noteId={note.id}
          versions={versions}
          onVersions={setVersions}
          canEdit={canEdit}
          canDelete={sharing.canShare}
          currentJson={() => (editor ? JSON.stringify(editor.getJSON()) : null)}
          previewId={preview?.id ?? null}
          historyDays={workspace.historyDays}
          onPreview={(v) => {
            setPreview(v);
            setSheetRail(false);
          }}
        />
      )}
      {railTab === "suggestions" &&
        (editor ? (
          <SuggestionsPanel editor={editor} canDecide={canType} />
        ) : (
          <p className="text-muted-foreground text-xs">Loading…</p>
        ))}
    </div>
  );

  return (
    <div className="note-workspace space-y-4">
      {/* The top bar: breadcrumbs, then presence, mode, Share and history. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {(!showTree || !wide) && workspace.pages.length > 0 && (
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label="Pages"
            title="Pages"
            onClick={() => setTreeSheet(true)}
          >
            <PanelLeft className="size-4" aria-hidden="true" />
          </Button>
        )}
        <nav
          aria-label="Breadcrumbs"
          className="text-muted-foreground flex min-w-0 flex-1 items-center gap-1 text-[13px]"
        >
          <Link href={`/app/${orgSlug}/notes`} className="hover:text-foreground shrink-0">
            Files
          </Link>
          {ancestors.map((a) => (
            <span key={a.id} className="flex min-w-0 items-center gap-1">
              <ChevronRight className="size-3.5 shrink-0" aria-hidden="true" />
              <Link
                href={`/app/${orgSlug}/notes/${a.id}`}
                className="hover:text-foreground truncate"
              >
                {a.icon ? `${a.icon} ` : ""}
                {a.title || "Untitled"}
              </Link>
            </span>
          ))}
          <ChevronRight className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="text-foreground truncate font-medium" aria-current="page">
            {icon ? `${icon} ` : ""}
            {title.trim() || "Untitled note"}
          </span>
        </nav>
        <div className="flex flex-wrap items-center gap-2">
          {live && <PresenceBar peers={session.peers} />}
          <SaveIndicator
            label={saveLabel(session, effective)}
            status={effective}
            onRetry={live ? undefined : retry}
          />
          {canEdit ? (
            <Segmented
              label="Editor mode"
              options={[
                { value: "PAGE", label: "Page" },
                { value: "DOCUMENT", label: "Document" },
              ]}
              value={layout}
              onSelect={(v) => {
                const next = v as Layout;
                setLayout(next);
                if (next === "DOCUMENT" && wide) setRailOpen(true);
                saveSettings({ layout: next });
              }}
            />
          ) : (
            <Badge variant="secondary">View only</Badge>
          )}
          {!personal && (
            <ShareNoteDialog
              orgId={orgId}
              orgSlug={orgSlug}
              noteId={note.id}
              title={title}
              sharing={sharing}
            />
          )}
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label={`Comments${openCount ? ` (${openCount} open)` : ""}`}
            title="Comments"
            aria-pressed={showRail && railTab === "comments"}
            onClick={() =>
              showRail && railTab === "comments" ? setRailOpen(false) : openRail("comments")
            }
            className="relative"
          >
            <MessageSquare className="size-4" aria-hidden="true" />
            {openCount > 0 && (
              <span className="bg-brand-accent text-brand-accent-foreground absolute -top-1 -right-1 grid min-w-4 place-items-center rounded-full px-1 text-[10px] font-semibold">
                {openCount}
              </span>
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label="Version history"
            title="Version history"
            // A phone: in the "…" menu, so the note's tools fit one row.
            className="max-md:hidden"
            aria-pressed={showRail && railTab === "history"}
            onClick={() =>
              showRail && railTab === "history" ? setRailOpen(false) : openRail("history")
            }
          >
            <History className="size-4" aria-hidden="true" />
          </Button>
          <ItemMenu
            label="More note actions"
            items={[
              canEdit && {
                label: suggesting ? "Stop suggesting (edit directly)" : "Suggest edits",
                icon: PencilLine,
                onSelect: () => {
                  setSuggestingMode((s) => !s);
                  if (!suggesting) openRail("suggestions");
                },
              },
              canEdit &&
                isDocument && {
                  label:
                    paperSize === "A4"
                      ? "Paper: A4 (switch to Letter)"
                      : "Paper: Letter (switch to A4)",
                  icon: FileText,
                  onSelect: () => {
                    const next = paperSize === "A4" ? "LETTER" : "A4";
                    setPaperSize(next);
                    saveSettings({ paperSize: next });
                  },
                },
              canEdit &&
                isDocument && {
                  label: "Header and footer…",
                  icon: PanelTop,
                  onSelect: () => setBandsOpen(true),
                },
              {
                label: "Download PDF",
                icon: Download,
                onSelect: () => void download("pdf"),
                separated: true,
              },
              {
                label: "Download Word (.docx)",
                icon: Download,
                onSelect: () => void download("docx"),
              },
              { label: "Download Markdown", icon: Download, onSelect: () => void download("md") },
              phone && {
                label: "Version history",
                icon: History,
                onSelect: () => openRail("history"),
                separated: true,
              },
              { label: "Copy link", icon: Link2, onSelect: copyLink, separated: true },
              canMakeTasks && {
                label: "Make tasks from this note",
                icon: ListChecks,
                onSelect: () =>
                  setImportText(
                    [title.trim(), editor ? editor.getText() : contentRef.current.text]
                      .filter(Boolean)
                      .join("\n\n")
                      .slice(0, 20_000),
                  ),
              },
              sharing.canShare && {
                label: "Delete note",
                icon: Trash2,
                destructive: true,
                onSelect: () => void remove(),
              },
            ]}
          />
        </div>
      </div>

      <div
        className={cn(
          "grid items-start gap-6",
          showTree && showRail
            ? "grid-cols-[13.5rem_minmax(0,1fr)_19rem]"
            : showTree
              ? "grid-cols-[13.5rem_minmax(0,1fr)]"
              : showRail
                ? "grid-cols-[minmax(0,1fr)_19rem]"
                : "grid-cols-1",
        )}
      >
        {showTree && (
          <aside className="sticky top-4 max-h-[calc(100dvh-2rem)] overflow-y-auto pb-6">
            {tree}
          </aside>
        )}

        <div className={cn("min-w-0 space-y-4", !isDocument && "mx-auto w-full max-w-3xl")}>
          {status === "conflict" && (
            <Banner
              tone="danger"
              action={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => window.location.reload()}
                >
                  Reload
                </Button>
              }
            >
              This note was updated by someone else — reload to see the latest version.
            </Banner>
          )}
          {session.mode === "interrupted" && (
            <Banner
              tone="danger"
              action={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => window.location.reload()}
                >
                  Reload
                </Button>
              }
            >
              Live editing was interrupted — reload to keep editing.
            </Banner>
          )}
          {suggesting && canType && (
            <Banner
              tone="accent"
              action={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setSuggestingMode(false)}
                >
                  Stop suggesting
                </Button>
              }
            >
              Suggesting: what you type and delete shows as suggestions to accept or reject.
            </Banner>
          )}
          {showBackup && backup && (
            <div className="bg-tint-accent rounded-tile flex flex-wrap items-center gap-3 p-3 text-sm">
              <History className="text-warning size-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                Changes you made {formatDistanceToNow(backup.savedAt, { addSuffix: true })} never
                reached the server. They&apos;re still in this browser.
                {backup.baseVersion < note.version &&
                  " The note has changed since, so restoring them replaces the newer version."}
              </span>
              <Button type="button" size="sm" onClick={restoreBackup}>
                Restore them
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  clearNoteBackup(note.id);
                  setBackupHandled(true);
                }}
              >
                Discard
              </Button>
            </div>
          )}

          {preview ? (
            <VersionPreview
              version={preview}
              currentText={editor ? editor.getText() : note.contentText}
              canRestore={canType}
              onRestore={() => restoreVersion(preview)}
              onClose={() => setPreview(null)}
            />
          ) : (
            <>
              <div
                className={cn(
                  "space-y-4",
                  // Page mode writes on a sheet of its own, like a card in
                  // Files; Document mode's paper is the sheet.
                  !isDocument &&
                    "bg-card text-card-foreground edge rounded-card px-5 py-7 sm:px-12 sm:py-10",
                )}
              >
                <header
                  className={cn("group/note-head space-y-2", isDocument && "mx-auto max-w-[816px]")}
                >
                  <IconPicker
                    icon={icon}
                    disabled={!canType}
                    onChange={(next) => {
                      setIcon(next);
                      saveSettings({ icon: next });
                    }}
                  />
                  {/* A phone: the title wraps onto more lines instead of running off the edge. */}
                  {phone ? (
                    <textarea
                      value={title}
                      disabled={!canType}
                      rows={1}
                      onChange={(e) => {
                        const next = e.target.value.replace(/\n/g, " ");
                        setTitle(next);
                        queueSave({ title: next });
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.preventDefault();
                      }}
                      placeholder="Untitled note"
                      aria-label="Title"
                      className="page-title placeholder:text-muted-foreground [field-sizing:content] w-full resize-none bg-transparent text-[2rem] outline-none disabled:cursor-default"
                    />
                  ) : (
                    <Input
                      value={title}
                      disabled={!canType}
                      onChange={(e) => {
                        setTitle(e.target.value);
                        queueSave({ title: e.target.value });
                      }}
                      placeholder="Untitled note"
                      aria-label="Title"
                      // Set like the page's title: no box, the display face, not faded when read-only.
                      className="page-title h-auto min-w-0 border-none bg-transparent px-0 py-0 text-[2rem] shadow-none focus-visible:shadow-none focus-visible:ring-0 disabled:cursor-default disabled:bg-transparent disabled:opacity-100 md:text-[2.5rem] dark:bg-transparent"
                    />
                  )}
                  <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
                    <span>
                      Edited{" "}
                      {formatDistanceToNow(new Date(workspace.updatedAt), { addSuffix: true })}
                      {workspace.updatedByName ? ` by ${workspace.updatedByName}` : ""}
                    </span>
                    <EventLinkPicker
                      events={events}
                      value={eventId}
                      disabled={!canType}
                      onChange={(id) => {
                        setEventId(id);
                        queueSave({ eventId: id });
                      }}
                    />
                  </div>
                </header>

                {live ? (
                  <NoteEditor
                    // A new session (another Y.Doc) needs a new editor bound to it.
                    key={live.doc.guid}
                    collaboration={{ doc: live.doc, provider: live.provider, user: live.user }}
                    editable={canType}
                    layout={layout}
                    paperSize={paperSize}
                    place={place}
                    canComment
                    onComment={startComment}
                    onEditor={onEditor}
                    onClickThread={(id) => {
                      setActiveThread(id);
                      openRail("comments");
                    }}
                    onCreateSubpage={createSubpage}
                  />
                ) : (
                  <NoteEditor
                    key={`autosave-${restored?.n ?? 0}`}
                    content={restored?.json ?? note.contentJson}
                    editable={canType}
                    layout={layout}
                    paperSize={paperSize}
                    place={place}
                    canComment
                    onComment={startComment}
                    onEditor={onEditor}
                    onClickThread={(id) => {
                      setActiveThread(id);
                      openRail("comments");
                    }}
                    onCreateSubpage={createSubpage}
                    onChange={(json, text) => {
                      contentRef.current = { json, text };
                      queueSave({});
                    }}
                  />
                )}
              </div>

              {(subpages.length > 0 || workspace.backlinks.length > 0) && (
                <footer
                  className={cn(
                    "grid gap-6 pt-4 sm:grid-cols-2",
                    isDocument && "mx-auto max-w-[816px]",
                  )}
                >
                  {subpages.length > 0 && (
                    <PageList title="Pages inside" orgSlug={orgSlug} pages={subpages} />
                  )}
                  {workspace.backlinks.length > 0 && (
                    <PageList title="Linked from" orgSlug={orgSlug} pages={workspace.backlinks} />
                  )}
                </footer>
              )}
            </>
          )}
        </div>

        {showRail && (
          <aside className="sticky top-4 max-h-[calc(100dvh-2rem)] overflow-y-auto pb-6">
            {rail}
          </aside>
        )}
      </div>

      <Sheet open={treeSheet} onOpenChange={setTreeSheet}>
        <SheetContent side="left" className="w-[300px] overflow-y-auto p-3.5 pt-5">
          <SheetTitle className="sr-only">Pages</SheetTitle>
          <SheetDescription className="sr-only">Every page you can see, nested.</SheetDescription>
          {tree}
        </SheetContent>
      </Sheet>
      <Sheet open={sheetRail && !wide} onOpenChange={setSheetRail}>
        <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto p-4 pb-8">
          <SheetTitle className="heading text-base">
            {railTab === "history"
              ? "Version history"
              : railTab === "suggestions"
                ? "Suggestions"
                : "Comments"}
          </SheetTitle>
          <SheetDescription className="sr-only">
            Comments, version history and suggestions.
          </SheetDescription>
          {rail}
        </SheetContent>
      </Sheet>
      {confirmEl}
      {bandsOpen && (
        <HeaderFooterDialog
          headerText={bands.headerText}
          footerText={bands.footerText}
          defaults={{
            header: bandHeader({ title, orgName: workspace.orgName }),
            footer: bandFooter({ title }),
          }}
          onSave={(next) => {
            setBands(next);
            saveSettings(next);
          }}
          onClose={() => setBandsOpen(false)}
        />
      )}
      {importText !== null && (
        <ActionItemsImport
          orgId={orgId}
          orgSlug={orgSlug}
          open
          onOpenChange={(o) => !o && setImportText(null)}
          initialText={importText}
          sourceLabel="this note"
        />
      )}
      <span className="sr-only" aria-live="polite">
        {suggesting && canType ? `Suggesting as ${author}` : ""}
      </span>
    </div>
  );
}

function Banner({
  tone,
  action,
  children,
}: {
  tone: "danger" | "accent";
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-tile flex items-center justify-between gap-3 p-3 text-sm",
        tone === "danger"
          ? "bg-tint-danger text-tint-danger-foreground"
          : "bg-tint-accent text-tint-accent-foreground",
      )}
    >
      <span>{children}</span>
      {action}
    </div>
  );
}

function PageList({
  title,
  orgSlug,
  pages,
}: {
  title: string;
  orgSlug: string;
  pages: { id: string; title: string; icon: string | null }[];
}) {
  return (
    <section className="space-y-2">
      <h2 className="eyebrow text-muted-foreground">{title}</h2>
      <ul className="space-y-0.5">
        {pages.map((p) => (
          <li key={p.id}>
            <Link
              href={`/app/${orgSlug}/notes/${p.id}`}
              className="hover:bg-muted flex h-9 items-center gap-2 rounded-xl px-2.5 text-sm"
            >
              {p.icon ? (
                <span className="w-4 text-center" aria-hidden="true">
                  {p.icon}
                </span>
              ) : (
                <FileText className="text-muted-foreground size-4" aria-hidden="true" />
              )}
              <span className="truncate">{p.title || "Untitled"}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** What the corner of the editor says: the save, or the live connection. */
function saveLabel(session: NoteCollabState, status: SaveStatus): string {
  if (session.mode === "connecting") return "Connecting…";
  if (status === "saving" || status === "pending") return "Saving…";
  if (status === "conflict") return "Conflict";
  if (status === "error") return "Couldn't save — retrying";
  if (session.mode !== "live") return status === "saved" ? "Saved" : "";
  if (session.connection !== "connected") return "Offline — reconnecting…";
  if (session.unsynced > 0) return "Syncing…";
  return session.stored > 0 || status === "saved" ? "Saved" : "Live";
}

function SaveIndicator({
  label,
  status,
  onRetry,
}: {
  label: string;
  status: SaveStatus;
  onRetry?: () => void;
}) {
  if (!label) return null;
  const Icon =
    status === "error"
      ? CloudOff
      : status === "saving" || status === "pending"
        ? Loader2
        : label === "Saved"
          ? Check
          : null;
  return (
    <span
      aria-live="polite"
      className={cn(
        "inline-flex shrink-0 items-center gap-1 text-xs",
        status === "error" ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {Icon && (
        <Icon
          className={cn(
            "size-3.5",
            (status === "saving" || status === "pending") && "animate-spin",
          )}
          aria-hidden="true"
        />
      )}
      {label}
      {status === "error" && onRetry && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRetry}
          className="text-destructive hover:bg-destructive/10 hover:text-destructive ms-1 h-7"
        >
          <RotateCcw aria-hidden="true" />
          Retry now
        </Button>
      )}
    </span>
  );
}

const WIDE = "(min-width: 1024px)";
/** Below md: the phone's layout of the note's tools. */
const PHONE = "(max-width: 767px)";

function subscribeWide(onChange: () => void) {
  if (typeof window.matchMedia !== "function") return () => undefined;
  const query = window.matchMedia(WIDE);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function subscribePhone(onChange: () => void) {
  if (typeof window.matchMedia !== "function") return () => undefined;
  const query = window.matchMedia(PHONE);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function isPhone() {
  return typeof window.matchMedia === "function" && window.matchMedia(PHONE).matches;
}

function isWide() {
  return typeof window.matchMedia !== "function" || window.matchMedia(WIDE).matches;
}
