"use client";

import { formatDistanceToNow } from "date-fns";
import {
  ArchiveRestore,
  CalendarDays,
  Download,
  Folder,
  FolderInput,
  FolderOpen,
  Inbox,
  LayoutGrid,
  Library,
  Link2,
  List,
  Lock,
  NotebookText,
  Upload,
  Trash2,
  Users,
} from "@/components/icons";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { deleteNote, restoreNote } from "@/app/app/[orgSlug]/notes/actions";
import {
  removeNoteFileAction,
  restoreNoteFileAction,
  updateNoteFileAction,
} from "@/app/app/[orgSlug]/notes/files-actions";
import {
  createFolderAction,
  deleteFolderAction,
  moveToFolderAction,
  updateFolderAction,
} from "@/app/app/[orgSlug]/notes/folder-actions";
import { emptyTrashAction } from "@/app/app/[orgSlug]/settings/plan/storage/actions";
import { AmbientActions } from "@/components/ambient/ambient-button";
import { EmptyState } from "@/components/empty-state";
import { ItemMenu } from "@/components/item-menu";
import { moveToEntries, type MoveTarget } from "@/components/personal/move-to-organization";
import { FILE_ICONS } from "@/components/notes/file-card";
import { NewFolderForm } from "@/components/notes/new-folder-form";
import { isFileDrag, pickFiles, uploadFiles } from "@/components/notes/upload-queue";
import { PinToggle } from "@/components/pins/pins-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SearchField } from "@/components/ui/search-field";
import { FilterChoices, FilterSheet, PhoneToolbar } from "@/components/ui/phone-toolbar";
import { Segmented } from "@/components/ui/segmented";
import { ExpandChip } from "@/components/ui/toolbar-chips";
import { toast, undoable } from "@/components/ui/toaster";
import { familyOf, formatBytes } from "@/lib/files/types";
import { NOTE_TRASH_DAYS } from "@/lib/notes/trash";
import { TAG_COLORS } from "@/lib/tag-colors";
import { cn } from "@/lib/utils";

import { FolderCard, folderTone, type FolderCardPeek } from "./folder-card";

const NOTE_MIME = "application/x-bananasplit-note";
const FILE_MIME = "application/x-bananasplit-file";

/** The folder palette, the same one event kinds and epics use. */
const COLORS = TAG_COLORS;

/** A tile's preview: the first line with words in it. */
function firstLine(text: string) {
  return (
    text
      .split("\n")
      .map((l) => l.trim())
      .find(Boolean) ?? ""
  );
}

export interface LibraryFolder {
  id: string;
  name: string;
  color: string | null;
  noteCount: number;
  fileCount: number;
  /** Its newest few items, for the folder card on Everything (empty elsewhere). */
  peek?: FolderCardPeek[];
  canEdit: boolean;
}

export interface LibraryNote {
  id: string;
  title: string;
  /** The page's icon (an emoji), if it has one. */
  icon?: string | null;
  snippet: string;
  visibility: "PRIVATE" | "ORGANIZATION";
  updatedAt: Date;
  createdAt: Date;
  authorName: string;
  eventTitle: string | null;
  folderId: string | null;
  canMove: boolean;
  /** How many people it's shared with by name. */
  shareCount: number;
  /** A private note someone shared with the viewer. */
  sharedWithMe: boolean;
  /** A club note every member may edit. */
  memberCanEdit: boolean;
}

export interface LibraryFile {
  id: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  visibility: "PRIVATE" | "ORGANIZATION";
  createdAt: Date;
  uploaderName: string;
  excerpt: string | null;
  folderId: string | null;
  canMove: boolean;
  /** Why it should be shared with everyone (src/lib/ambient/files.ts), when it should. */
  share?: string | null;
}

export interface TrashNote {
  id: string;
  title: string;
  visibility: "PRIVATE" | "ORGANIZATION";
  deletedAt: Date;
  authorName: string;
}

export interface TrashFile {
  id: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  deletedAt: Date;
}

/** What a card's menu, a drop on "Recently deleted" or the Move dialog acts on. */
type Item = { kind: "note" | "file"; id: string; name: string; folderId: string | null };

/** Saves a file the API serves as an attachment (a plain link, so no client navigation). */
function downloadFrom(url: string) {
  const link = document.createElement("a");
  link.href = url;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function folderDot(color: string | null) {
  return folderTone(color);
}

/** Grid or list, as People's layouts: an icon and its name (the name hides on a phone). */
const LAYOUTS = [
  { value: "grid", label: "Grid", icon: LayoutGrid, compact: true, title: "Grid" },
  { value: "list", label: "List", icon: List, compact: true, title: "List" },
];

/** What to show, as the bar's icon chips (`tab=files` keeps its old name for links). */
const KINDS = [
  { tab: null, label: "All", icon: Library },
  { tab: "notes", label: "Notes", icon: NotebookText },
  { tab: "files", label: "Uploads", icon: Upload },
] as const;

/**
 * The Files library: folders down the side (drag a note or file onto one to
 * file it, or drop files from the computer onto one to upload them there),
 * and notes and uploaded files together in one list you can search (as you
 * type), filter, sort and see as a grid or a list. Deleting anything is
 * undone from its toast rather than asked about first. Cards show a preview of
 * what's inside and a pin. In Personal everything is its owner's alone, so
 * cards don't mark who can see them.
 *
 * On a phone the folders are a filter instead of a column (PhoneToolbar's
 * sheet, with the kind, audience, author and sort), and search is an icon.
 */
export function NotesLibrary({
  orgId,
  orgSlug,
  kind,
  folders,
  notes,
  files,
  pinnedHrefs,
  totals,
  trash,
  filters,
  sheetFilters,
  personal = false,
  canEmptyTrash = false,
  moveTargets,
}: {
  orgId: string;
  orgSlug: string;
  /** Notes, uploaded files, or both (`?tab=`). */
  kind: "all" | "notes" | "files";
  folders: LibraryFolder[];
  notes: LibraryNote[];
  files: LibraryFile[];
  pinnedHrefs: string[];
  totals: { notes: number; files: number; unfiled: number; trash: number };
  /** The "Recently deleted" view's contents (only when it is open). */
  trash: { notes: TrashNote[]; files: TrashFile[] } | null;
  filters: React.ReactNode;
  /** The same filters for the phone's filter sheet (under the folder). */
  sheetFilters: React.ReactNode;
  /** A Personal space: no sharing, so no lock or "shared" marks. */
  personal?: boolean;
  /** This member may empty the trash for good (owners and admins, or Personal's owner). */
  canEmptyTrash?: boolean;
  /** In Personal: the organizations the viewer runs, each a "Move to ..." in a card's menu. */
  moveTargets?: readonly MoveTarget[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [overFolder, setOverFolder] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [moving, setMoving] = useState<Item | null>(null);
  const [overTrash, setOverTrash] = useState(false);
  const [confirmEl, confirm] = useConfirm();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const folder = params.get("folder");
  // The root of the tree (Everything, not searching): folders shown as tiles,
  // and the list below them is only what is in no folder (the page asks for
  // exactly that).
  const atRoot = !folder && !params.get("q");
  const view = params.get("layout") === "list" ? "list" : "grid";
  const base = `/app/${orgSlug}/notes`;
  const pinned = new Set(pinnedHrefs);

  // Search as you type: the list follows the box a beat after typing stops.
  useEffect(() => {
    const next = q.trim();
    if (next === (params.get("q") ?? "")) return;
    const timer = setTimeout(() => go({ q: next || null }), 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  function go(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  function run(task: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    start(async () => {
      const result = await task();
      if (!result.ok) setError(result.error ?? "That didn't work.");
      router.refresh();
    });
  }

  /** Files a note or file in a folder (null: no folder), with Undo. */
  function move(item: Item, folderId: string | null, folderName?: string) {
    const from = item.folderId;
    if (from === folderId) return;
    const ids = (kind: "note" | "file") =>
      kind === "note" ? { noteIds: [item.id] } : { fileIds: [item.id] };
    const name = folderId
      ? (folderName ?? folders.find((f) => f.id === folderId)?.name ?? "the folder")
      : "Not in a folder";
    void undoable({
      title: folderId ? `Moved to ${name}` : "Taken out of the folder",
      run: async () => {
        const result = await moveToFolderAction(orgId, ids(item.kind), folderId);
        router.refresh();
        if (!result.ok) return result.error ?? "That didn't work.";
      },
      undo: async () => {
        const result = await moveToFolderAction(orgId, ids(item.kind), from);
        router.refresh();
        if (!result.ok) return result.error ?? "That didn't work.";
      },
    });
  }

  function dropOn(folderId: string | null, data: DataTransfer) {
    setOverFolder(null);
    const noteId = data.getData(NOTE_MIME);
    const fileId = data.getData(FILE_MIME);
    const note = noteId ? notes.find((n) => n.id === noteId) : undefined;
    const file = fileId ? files.find((f) => f.id === fileId) : undefined;
    if (note) {
      move({ kind: "note", id: note.id, name: note.title, folderId: note.folderId }, folderId);
    } else if (file) {
      move({ kind: "file", id: file.id, name: file.name, folderId: file.folderId }, folderId);
    }
  }

  const isCardDrag = (e: React.DragEvent) => {
    const types = Array.from(e.dataTransfer.types);
    return types.includes(NOTE_MIME) || types.includes(FILE_MIME);
  };

  // dragleave fires on a target whenever the pointer crosses into one of its
  // own children (the icon, the name, the count), so a highlight cleared on
  // every dragleave blinks off and on as you move over it. Only a leave that
  // really goes outside counts.
  const leftFor = (e: React.DragEvent) =>
    !(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget));

  // A drag that ends anywhere (dropped, cancelled with Escape, let go
  // outside the window) leaves no folder lit.
  useEffect(() => {
    const clear = () => {
      setOverFolder(null);
      setOverTrash(false);
    };
    window.addEventListener("dragend", clear);
    window.addEventListener("drop", clear);
    return () => {
      window.removeEventListener("dragend", clear);
      window.removeEventListener("drop", clear);
    };
  }, []);

  // A folder takes a card (filed there) or files from the computer (uploaded
  // there). preventDefault on the drop tells the page's uploader it's handled.
  const dropProps = (id: string | null) => ({
    onDragOver: (e: React.DragEvent) => {
      const card = isCardDrag(e);
      if (!card && !isFileDrag(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = card ? "move" : "copy";
      setOverFolder(id ?? "none");
    },
    onDragLeave: (e: React.DragEvent) => {
      if (leftFor(e)) setOverFolder((f) => (f === (id ?? "none") ? null : f));
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setOverFolder(null);
      if (!isCardDrag(e)) {
        if (e.dataTransfer.files.length > 0) uploadFiles(Array.from(e.dataTransfer.files), id);
        return;
      }
      dropOn(id, e.dataTransfer);
    },
  });

  function copyLink(href: string) {
    void navigator.clipboard
      ?.writeText(`${window.location.origin}${href}`)
      .then(() => toast({ title: "Copied", tone: "success", duration: 3_000 }))
      .catch(() => toast({ title: "Couldn't copy the link", tone: "error" }));
  }

  /** Delete (to "Recently deleted") at once, with Undo. Nothing asks first. */
  async function remove(item: Item) {
    const isNote = item.kind === "note";
    await undoable({
      title: "Deleted",
      run: async () => {
        const result = isNote
          ? await deleteNote(orgId, item.id)
          : await removeNoteFileAction(orgId, item.id);
        if (result.error) return result.error;
        router.refresh();
      },
      undo: async () => {
        const result = isNote
          ? await restoreNote(orgId, item.id)
          : await restoreNoteFileAction(orgId, item.id);
        if (result.error) return result.error;
        router.refresh();
      },
    });
  }

  /** A folder goes at once; Undo makes it again and files its things back. */
  async function removeFolder(f: LibraryFolder) {
    let held:
      { name: string; color: string | null; noteIds: string[]; fileIds: string[] } | undefined;
    await undoable({
      title: "Folder deleted",
      run: async () => {
        const result = await deleteFolderAction(orgId, f.id);
        if (!result.ok) return result.error;
        held = result.restore;
        if (folder === f.id) go({ folder: null });
        router.refresh();
      },
      undo: async () => {
        if (!held) return "Couldn't bring it back.";
        const made = await createFolderAction(orgId, held.name, held.color);
        if (!made.ok) return made.error;
        if (made.id && (held.noteIds.length > 0 || held.fileIds.length > 0)) {
          const moved = await moveToFolderAction(
            orgId,
            { noteIds: held.noteIds, fileIds: held.fileIds },
            made.id,
          );
          if (!moved.ok) return moved.error;
        }
        router.refresh();
      },
    });
  }

  /** Empties the trash for good: the one thing here that can't be undone, so it asks. */
  async function emptyTrash() {
    const count = totals.trash;
    const ok = await confirm({
      title: "Empty the trash?",
      description: `${count} ${count === 1 ? "item is" : "items are"} deleted for good.`,
      confirmLabel: "Empty trash",
      tone: "destructive",
      run: async () => (await emptyTrashAction(orgId)).error,
    });
    if (!ok) return;
    toast({ title: "Trash emptied", tone: "success", duration: 3_000 });
    router.refresh();
  }

  function restore(kind: "note" | "file", id: string, name: string) {
    setError(null);
    start(async () => {
      const result =
        kind === "note" ? await restoreNote(orgId, id) : await restoreNoteFileAction(orgId, id);
      if (result.error) {
        setError(result.error);
        return;
      }
      toast({ title: "Restored", description: name, tone: "success", duration: 3_000 });
      router.refresh();
    });
  }

  /** Dropping a card on "Recently deleted" deletes it, with Undo. */
  const trashDropProps = {
    onDragOver: (e: React.DragEvent) => {
      const types = Array.from(e.dataTransfer.types);
      if (!types.includes(NOTE_MIME) && !types.includes(FILE_MIME)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setOverTrash(true);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (leftFor(e)) setOverTrash(false);
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setOverTrash(false);
      const noteId = e.dataTransfer.getData(NOTE_MIME);
      const fileId = e.dataTransfer.getData(FILE_MIME);
      const note = noteId ? notes.find((n) => n.id === noteId) : undefined;
      const file = fileId ? files.find((f) => f.id === fileId) : undefined;
      if (note)
        void remove({
          kind: "note",
          id: note.id,
          name: note.title || "Untitled note",
          folderId: note.folderId,
        });
      else if (file)
        void remove({ kind: "file", id: file.id, name: file.name, folderId: file.folderId });
    },
  };

  const railItem = (
    key: string | null,
    label: string,
    icon: React.ReactNode,
    count: number,
    droppable: boolean,
    extra?: React.ReactNode,
    onRename?: () => void,
  ) => {
    const active = (folder ?? null) === key;
    return (
      <div
        key={key ?? "all"}
        {...(droppable ? dropProps(key === "none" ? null : key) : {})}
        className={cn(
          "group flex items-center gap-1 rounded-md transition-colors",
          active ? "bg-muted" : "hover:bg-muted/60",
          overFolder === (key ?? "all") && "ring-primary bg-primary/10 ring-2",
        )}
      >
        <button
          type="button"
          onClick={() => go({ folder: key })}
          onDoubleClick={onRename}
          title={onRename ? "Double-click to rename" : undefined}
          aria-current={active ? "true" : undefined}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2 px-2.5 py-1.5 text-left text-sm",
            active && "font-medium",
          )}
        >
          {icon}
          <span className="min-w-0 break-words">{label}</span>
          <span className="text-muted-foreground ms-auto text-xs tabular-nums">{count}</span>
        </button>
        {extra}
      </div>
    );
  };

  const currentFolder = folders.find((f) => f.id === folder);
  const inTrash = folder === "trash";
  const heading = inTrash
    ? "Recently deleted"
    : folder === "none"
      ? "Not in a folder"
      : (currentFolder?.name ?? "Everything");

  /** The card itself: a link to open it, dragged to file it in a folder. */
  const cardLink = cn(
    "bg-card edge rounded-tile focus-glow flex h-full flex-col overflow-hidden transition-[transform,box-shadow] duration-200 ease-(--ease-ink) hover:-translate-y-0.5 hover:shadow-e2 motion-reduce:hover:translate-y-0",
    view === "list" && "flex-row items-center hover:translate-y-0",
  );
  // Pin and "…" sit on the card's text, at the right: beside the title and
  // details in a grid, centred on the row in a list.
  const cardActions = cn(
    "absolute right-2 flex items-center gap-1",
    view === "grid" ? "top-3" : "top-1/2 -translate-y-1/2",
  );
  const pinClass = (href: string) =>
    cn(
      "border-transparent bg-transparent shadow-none opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100 focus-visible:opacity-100",
      pinned.has(href) && "opacity-100",
    );

  const noteCard = (n: LibraryNote) => {
    const href = `${base}/${n.id}`;
    const name = n.title || "Untitled note";
    return (
      <li key={`note-${n.id}`} className="group relative">
        <Link
          href={href}
          draggable
          onDragStart={(e) => {
            // The address, so it can be dropped on Pinned; the id, to file it in a folder.
            e.dataTransfer.setData("text/uri-list", `${window.location.origin}${href}`);
            e.dataTransfer.setData("text/plain", `${window.location.origin}${href}`);
            if (n.canMove) e.dataTransfer.setData(NOTE_MIME, n.id);
            // Moved into a folder, or linked from Pinned.
            e.dataTransfer.effectAllowed = "all";
          }}
          className={cardLink}
        >
          {view === "grid" && (
            <div className="flex items-center gap-2 px-4 pt-4">
              <span className="bg-muted text-muted-foreground grid size-9 shrink-0 place-items-center rounded-full text-base leading-none">
                {n.icon ? (
                  <span aria-hidden="true">{n.icon}</span>
                ) : (
                  <NotebookText className="size-[18px]" aria-hidden="true" />
                )}
              </span>
            </div>
          )}
          <div
            className={cn(
              "flex min-w-0 flex-1 flex-col gap-1 px-4 pt-3 pb-4",
              view === "list" && "flex-row items-center gap-3 py-2.5",
            )}
          >
            {view === "list" && (
              <NotebookText className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
            )}
            <p className="flex min-w-0 items-center gap-1.5 pe-16 text-sm font-medium">
              {/* Private and shared with nobody: a lock. Shared says so in words below. */}
              {!personal && n.visibility === "PRIVATE" && !n.sharedWithMe && n.shareCount === 0 && (
                <Lock className="text-muted-foreground size-3 shrink-0" aria-label="Private" />
              )}
              <span className="min-w-0 break-words">{name}</span>
            </p>
            {view === "grid" && (
              <p className="text-muted-foreground line-clamp-2 min-h-[2.5em] text-[13px] leading-snug">
                {firstLine(n.snippet)}
              </p>
            )}
            <p
              className={cn(
                "text-muted-foreground flex min-w-0 flex-wrap items-center gap-x-2 pe-16 text-xs",
                view === "list" && "ms-auto flex-nowrap",
              )}
            >
              <span>
                {n.authorName}, {formatDistanceToNow(n.updatedAt, { addSuffix: true })}
              </span>
              {!personal && (n.sharedWithMe || n.shareCount > 0 || n.memberCanEdit) && (
                <span>
                  {n.sharedWithMe
                    ? "Shared with you"
                    : n.memberCanEdit
                      ? "Org can edit"
                      : `Shared with ${n.shareCount}`}
                </span>
              )}
              {n.eventTitle && (
                <span className="inline-flex min-w-0 items-center gap-1 break-words">
                  <CalendarDays className="size-3 shrink-0" aria-hidden="true" />
                  {n.eventTitle}
                </span>
              )}
            </p>
          </div>
        </Link>
        <div className={cardActions}>
          <PinToggle href={href} label={n.title || "note"} className={pinClass(href)} />
          <ItemMenu
            label={`Actions for ${name}`}
            className="rounded-lg"
            items={[
              { label: "Copy link", icon: Link2, onSelect: () => copyLink(href) },
              n.canMove && {
                label: "Move to folder…",
                icon: FolderInput,
                onSelect: () => setMoving({ kind: "note", id: n.id, name, folderId: n.folderId }),
              },
              ...(n.canMove
                ? moveToEntries(moveTargets, { kind: "note", id: n.id }, () => router.refresh())
                : []),
              n.canMove && {
                label: "Delete",
                icon: Trash2,
                destructive: true,
                onSelect: () => void remove({ kind: "note", id: n.id, name, folderId: n.folderId }),
              },
            ]}
          />
        </div>
      </li>
    );
  };

  const fileCard = (f: LibraryFile) => {
    const href = `${base}/files/${f.id}`;
    const family = familyOf(f.contentType);
    const Icon = FILE_ICONS[family];
    const src = `/api/orgs/${encodeURIComponent(orgId)}/files/${encodeURIComponent(f.id)}`;
    return (
      <li key={`file-${f.id}`} className="group relative">
        <Link
          href={href}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData("text/uri-list", `${window.location.origin}${href}`);
            e.dataTransfer.setData("text/plain", `${window.location.origin}${href}`);
            if (f.canMove) e.dataTransfer.setData(FILE_MIME, f.id);
            e.dataTransfer.effectAllowed = "all";
          }}
          className={cardLink}
        >
          {view === "grid" &&
            (family === "image" ? (
              <div className="bg-muted relative h-32 overflow-hidden">
                {/* Not draggable itself, so the card drags (an image drag carries the
                    picture as a file, and the page would upload it again). */}
                {/* eslint-disable-next-line @next/next/no-img-element -- a private, permission-checked file */}
                <img
                  src={src}
                  alt=""
                  loading="lazy"
                  draggable={false}
                  className="size-full object-cover"
                />
              </div>
            ) : (
              <div className="flex items-center gap-2 px-4 pt-4">
                <span
                  className={cn(
                    "grid size-9 shrink-0 place-items-center rounded-full",
                    family === "pdf"
                      ? "bg-tint-danger text-tint-danger-foreground"
                      : "bg-tint-info text-tint-info-foreground",
                  )}
                >
                  <Icon className="size-[18px]" aria-hidden="true" />
                </span>
              </div>
            ))}
          <div
            className={cn(
              "flex min-w-0 flex-1 flex-col gap-1 px-4 pt-3 pb-4",
              view === "list" && "flex-row items-center gap-3 py-2.5",
            )}
          >
            {view === "list" && (
              <Icon className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
            )}
            <p className="flex min-w-0 items-center gap-1.5 pe-16 text-sm font-medium">
              {!personal && f.visibility === "PRIVATE" && (
                <Lock className="text-muted-foreground size-3 shrink-0" aria-label="Private" />
              )}
              <span className="min-w-0 break-words">{f.name}</span>
            </p>
            {view === "grid" && family !== "image" && (
              <p className="text-muted-foreground line-clamp-2 min-h-[2.5em] text-[13px] leading-snug">
                {firstLine(f.excerpt ?? "") || formatBytes(f.sizeBytes)}
              </p>
            )}
            <p
              className={cn(
                "text-muted-foreground pe-16 text-xs",
                view === "list" && "ms-auto whitespace-nowrap",
              )}
            >
              {formatBytes(f.sizeBytes)}, {f.uploaderName},{" "}
              {formatDistanceToNow(f.createdAt, { addSuffix: true })}
            </p>
            {f.share && (
              <AmbientActions
                className="mt-1 items-start"
                actions={[
                  {
                    key: "share",
                    label: "Share with everyone",
                    icon: Users,
                    reason: f.share,
                    ariaLabel: `Share ${f.name} with everyone`,
                    run: () => updateNoteFileAction(orgId, f.id, { visibility: "ORGANIZATION" }),
                    done: "Everyone in the organization can open it now",
                  },
                ]}
              />
            )}
          </div>
        </Link>
        <div className={cardActions}>
          <button
            type="button"
            aria-label={`Download ${f.name}`}
            title="Download"
            onClick={() => downloadFrom(`${src}?download=1`)}
            className={cn(
              "text-muted-foreground hover:text-foreground hover:bg-muted focus-glow grid size-8 place-items-center rounded-full outline-none",
              "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100",
            )}
          >
            <Download className="size-4" aria-hidden="true" />
          </button>
          <PinToggle href={href} label={f.name} className={pinClass(href)} />
          <ItemMenu
            label={`Actions for ${f.name}`}
            className="rounded-lg"
            items={[
              { label: "Copy link", icon: Link2, onSelect: () => copyLink(href) },
              f.canMove && {
                label: "Move to folder…",
                icon: FolderInput,
                onSelect: () =>
                  setMoving({ kind: "file", id: f.id, name: f.name, folderId: f.folderId }),
              },
              ...(f.canMove
                ? moveToEntries(moveTargets, { kind: "file", id: f.id }, () => router.refresh())
                : []),
              f.canMove && {
                label: "Delete",
                icon: Trash2,
                destructive: true,
                onSelect: () =>
                  void remove({ kind: "file", id: f.id, name: f.name, folderId: f.folderId }),
              },
            ]}
          />
        </div>
      </li>
    );
  };

  // Notes and files in one list. Each comes sorted from the server; mixed,
  // they're sorted again the same way (a file's last edit is its upload).
  const sort = params.get("sort") ?? "edited";
  const entries = [
    ...(kind === "files"
      ? []
      : notes.map((n) => ({
          name: n.title || "Untitled note",
          edited: n.updatedAt,
          created: n.createdAt,
          card: () => noteCard(n),
        }))),
    ...(kind === "notes"
      ? []
      : files.map((f) => ({
          name: f.name,
          edited: f.createdAt,
          created: f.createdAt,
          card: () => fileCard(f),
        }))),
  ];
  if (kind === "all") {
    entries.sort((a, b) =>
      sort === "title"
        ? a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
        : sort === "created"
          ? b.created.getTime() - a.created.getTime()
          : b.edited.getTime() - a.edited.getTime(),
    );
  }

  const uploadButton = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => pickFiles(folder && folder !== "none" && folder !== "trash" ? folder : null)}
    >
      Upload
    </Button>
  );

  /** What an empty list says: a title and, where it helps, the one thing to do. */
  function emptyCopy(): { title: string; description: string; action?: React.ReactNode } {
    if (params.get("q")) {
      return {
        title: "Nothing matches that search",
        description: "",
        action: (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setQ("");
              go({ q: null });
            }}
          >
            Clear search
          </Button>
        ),
      };
    }
    if (params.get("visibility") || params.get("author")) {
      return {
        title: "Nothing matches these filters",
        description: "",
        // The same reset as Filter › Clear filters.
        action: (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => go({ tab: null, visibility: null, author: null })}
          >
            Clear filters
          </Button>
        ),
      };
    }
    if (kind === "files") {
      return { title: "No uploads yet", description: "", action: uploadButton };
    }
    if (kind === "notes") {
      return { title: "No notes yet", description: "" };
    }
    if (folder === "none") return { title: "Everything is in a folder", description: "" };
    if (folder) return { title: "Empty. Drag files here.", description: "", action: uploadButton };
    return { title: "Nothing here yet", description: "", action: uploadButton };
  }

  const searching = Boolean(params.get("q"));
  const filtering = ["visibility", "author"].some((k) => params.get(k) && params.get(k) !== "all");

  const searchForm = (phone: boolean) => (
    <form
      role="search"
      className={phone ? undefined : "w-full sm:max-w-56"}
      onSubmit={(e) => {
        e.preventDefault();
        go({ q: q.trim() || null });
      }}
    >
      <SearchField
        value={q}
        onValueChange={(v) => {
          setQ(v);
          if (!v) go({ q: null });
        }}
        onClear={() => {
          setQ("");
          go({ q: null });
        }}
        placeholder="Search"
        aria-label="Search files"
        className={phone ? undefined : "sm:w-full"}
        autoComplete="off"
        autoFocus={phone}
      />
    </form>
  );

  const layoutSwitch = (
    <Segmented
      label="Layout"
      options={LAYOUTS}
      value={view}
      onSelect={(v) => go({ layout: v === "grid" ? null : v })}
    />
  );

  return (
    <div className="space-y-4">
      {/*
        The bar every list page has (Tasks, People): the layout, what to
        show (all, notes, uploads) as icons that say what they are on hover,
        one Filters chip (the order, access, who added it), then the search
        at the right. The trash is a plain list, so none of it.
      */}
      {!inTrash && (
        <div className="@container/toolbar flex flex-wrap items-center gap-2 max-md:hidden">
          <Segmented
            label="Layout"
            options={LAYOUTS}
            value={view}
            onSelect={(v) => go({ layout: v === "grid" ? null : v })}
            labelsFrom="sr-only @[44rem]/toolbar:not-sr-only"
            className="shrink-0"
          />
          <div className="flex shrink-0 items-center gap-1" role="group" aria-label="Show">
            {KINDS.map((k) => (
              <ExpandChip
                key={k.label}
                icon={k.icon}
                label={k.label}
                active={(kind === "all" ? null : kind) === k.tab}
                onClick={() => go({ tab: k.tab })}
              />
            ))}
          </div>
          {filters}
          <div className="ms-auto flex min-w-48 flex-1 items-center justify-end gap-2">
            {(searching || filtering) && (
              <span className="text-muted-foreground text-[13px]" role="status" aria-live="polite">
                {entries.length} found
              </span>
            )}
            {searchForm(false)}
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
        {/* Not on a phone: there the folder is a filter (the toolbar's sheet). */}
        <aside className="space-y-4 max-md:hidden lg:sticky lg:top-20 lg:self-start">
          <div className="space-y-0.5">
            {railItem(
              null,
              "Everything",
              <Library className="size-4 shrink-0" aria-hidden="true" />,
              totals.notes + totals.files,
              false,
            )}
            {railItem(
              "none",
              "Not in a folder",
              <Inbox className="size-4 shrink-0" aria-hidden="true" />,
              totals.unfiled,
              true,
            )}
          </div>
          <div className="space-y-0.5 border-t pt-3">
            {folders.map((f) =>
              renaming?.id === f.id ? (
                <form
                  key={f.id}
                  className="px-1"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const name = renaming.name.trim();
                    setRenaming(null);
                    if (name && name !== f.name)
                      run(() => updateFolderAction(orgId, f.id, { name }));
                  }}
                >
                  <Input
                    autoFocus
                    value={renaming.name}
                    maxLength={80}
                    onChange={(e) => setRenaming({ id: f.id, name: e.target.value })}
                    onBlur={(e) => e.currentTarget.form?.requestSubmit()}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setRenaming(null);
                    }}
                    aria-label="Folder name"
                  />
                </form>
              ) : (
                railItem(
                  f.id,
                  f.name,
                  folder === f.id ? (
                    <FolderOpen
                      className="size-4 shrink-0"
                      style={{ color: folderDot(f.color) }}
                      aria-hidden="true"
                    />
                  ) : (
                    <Folder
                      className="size-4 shrink-0"
                      style={{ color: folderDot(f.color) }}
                      aria-hidden="true"
                    />
                  ),
                  f.noteCount + f.fileCount,
                  true,
                  <>
                    <PinToggle
                      href={`${base}?folder=${f.id}`}
                      label={`folder ${f.name}`}
                      className="rounded-lg border-transparent bg-transparent opacity-0 shadow-none group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
                    />
                    {f.canEdit && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Delete ${f.name}`}
                        title="Delete"
                        onClick={() => void removeFolder(f)}
                        className="text-muted-foreground hover:text-tint-danger-foreground me-0.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                      </Button>
                    )}
                  </>,
                  f.canEdit ? () => setRenaming({ id: f.id, name: f.name }) : undefined,
                )
              ),
            )}
            {folders.length === 0 && (
              <p className="text-muted-foreground px-2.5 text-xs">No folders yet.</p>
            )}
          </div>
          <div
            {...trashDropProps}
            className={cn(
              "rounded-md border-t pt-3",
              overTrash && "ring-destructive bg-destructive/10 ring-2",
            )}
          >
            {railItem(
              "trash",
              "Recently deleted",
              <Trash2 className="size-4 shrink-0" aria-hidden="true" />,
              totals.trash,
              false,
            )}
            {overTrash && <p className="text-destructive px-2.5 pt-1 text-xs">Drop to delete</p>}
          </div>
          {error && <p className="text-destructive px-2 text-xs">{error}</p>}
        </aside>

        <div className="min-w-0 space-y-4">
          <PhoneToolbar
            leading={layoutSwitch}
            filterCount={
              (folder ? 1 : 0) +
              ["visibility", "author"].filter((k) => params.get(k) && params.get(k) !== "all")
                .length
            }
            onFilters={() => setFiltersOpen(true)}
            searchLabel="Search files"
            searchActive={searching}
            search={searchForm(true)}
            onCancelSearch={() => {
              setQ("");
              if (params.get("q")) go({ q: null });
            }}
          />
          <FilterSheet
            open={filtersOpen}
            onOpenChange={setFiltersOpen}
            title="Filters"
            description=""
            canClear={Boolean(
              folder || ["visibility", "author", "sort", "tab"].some((k) => params.get(k)),
            )}
            onClear={() =>
              go({ folder: null, visibility: null, author: null, sort: null, tab: null })
            }
          >
            <FilterChoices
              title="Show"
              value={kind === "all" ? "" : kind}
              onPick={(v) => go({ tab: v || null })}
              options={KINDS.map((k) => ({ value: k.tab ?? "", label: k.label }))}
            />
            <FilterChoices
              title="Folder"
              value={folder ?? ""}
              onPick={(v) => go({ folder: v || null })}
              options={[
                { value: "", label: "Everything" },
                { value: "none", label: "Not in a folder" },
                ...folders.map((f) => ({
                  value: f.id,
                  label: f.name,
                  color: f.color ? folderDot(f.color) : undefined,
                })),
                { value: "trash", label: "Recently deleted" },
              ]}
            />
            {sheetFilters}
          </FilterSheet>
          {/* Where you are, inside a folder or the trash (Everything says nothing). */}
          {(folder || error) && (
            <div className="space-y-1">
              {folder && (
                <h2 className="heading flex min-w-0 items-center gap-2 text-lg">
                  {currentFolder ? (
                    <FolderOpen
                      className="size-5 shrink-0"
                      style={{ color: folderDot(currentFolder.color) }}
                      aria-hidden="true"
                    />
                  ) : null}
                  <span className="min-w-0 break-words">{heading}</span>
                </h2>
              )}
              {error && <p className="text-destructive text-xs">{error}</p>}
            </div>
          )}

          {/*
          Everything is the root of the tree: its folders first, as tiles you
          open or drop a file onto, then whatever is in no folder. A search
          looks everywhere instead, so the tiles step aside for it.
        */}
          {atRoot && folders.length > 0 && (
            <section aria-label="Folders" className="space-y-6">
              <ul className="grid [grid-template-columns:repeat(auto-fill,minmax(13rem,1fr))] gap-x-4 gap-y-5">
                {folders.map((f) => (
                  <li key={f.id}>
                    <FolderCard
                      name={f.name}
                      color={f.color}
                      noteCount={f.noteCount}
                      fileCount={f.fileCount}
                      peek={f.peek ?? []}
                      colors={COLORS}
                      onColor={
                        f.canEdit
                          ? (c) => run(() => updateFolderAction(orgId, f.id, { color: c }))
                          : undefined
                      }
                      onRename={
                        f.canEdit
                          ? (name) => run(() => updateFolderAction(orgId, f.id, { name }))
                          : undefined
                      }
                      onDelete={f.canEdit ? () => void removeFolder(f) : undefined}
                      dropping={overFolder === f.id}
                      onOpen={() => go({ folder: f.id })}
                      dropProps={dropProps(f.id)}
                    />
                  </li>
                ))}
              </ul>
              {entries.length > 0 && (
                <h3 className="heading flex items-center gap-2 text-[17px]">
                  Not in a folder <Badge variant="secondary">{entries.length}</Badge>
                </h3>
              )}
            </section>
          )}

          {inTrash ? (
            <TrashView
              trash={trash}
              pending={pending}
              onRestore={restore}
              onEmpty={canEmptyTrash && totals.trash > 0 ? () => void emptyTrash() : undefined}
            />
          ) : entries.length === 0 ? (
            atRoot && folders.length > 0 ? null : (
              <EmptyState {...emptyCopy()} />
            )
          ) : (
            <ul
              className={cn(
                view === "grid"
                  ? "grid [grid-template-columns:repeat(auto-fill,minmax(14rem,1fr))] gap-[18px]"
                  : "space-y-2",
                pending && "opacity-70",
              )}
            >
              {entries.map((e) => e.card())}
            </ul>
          )}
        </div>
      </div>
      {confirmEl}
      <MoveDialog
        orgId={orgId}
        item={moving}
        folders={folders}
        onClose={() => setMoving(null)}
        onMove={(item, folderId, newName) => {
          setMoving(null);
          move(item, folderId, newName);
        }}
      />
    </div>
  );
}

function MoveDialog({
  orgId,
  item,
  folders,
  onClose,
  onMove,
}: {
  orgId: string;
  item: Item | null;
  folders: LibraryFolder[];
  onClose: () => void;
  /** `name`: the folder's name, when it was just made (it isn't in `folders` yet). */
  onMove: (item: Item, folderId: string | null, name?: string) => void;
}) {
  const choices: { id: string | null; name: string; color: string | null }[] = [
    { id: null, name: "Not in a folder", color: null },
    ...folders.map((f) => ({ id: f.id, name: f.name, color: f.color })),
  ];
  return (
    <Dialog open={item !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Move to a folder</DialogTitle>
          <DialogDescription className="break-words">{item?.name}</DialogDescription>
        </DialogHeader>
        <ul className="-mx-1 max-h-72 space-y-0.5 overflow-y-auto">
          {choices.map((c) => {
            const current = (item?.folderId ?? null) === c.id;
            return (
              <li key={c.id ?? "none"}>
                <button
                  type="button"
                  disabled={current}
                  onClick={() => item && onMove(item, c.id)}
                  className="hover:bg-muted flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm disabled:opacity-60"
                >
                  {c.id ? (
                    <Folder
                      className="size-4 shrink-0"
                      style={{ color: folderDot(c.color) }}
                      aria-hidden="true"
                    />
                  ) : (
                    <Inbox className="size-4 shrink-0" aria-hidden="true" />
                  )}
                  <span className="min-w-0 break-words">{c.name}</span>
                  {current && (
                    <span className="text-muted-foreground ms-auto text-xs">Here now</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="space-y-1.5 border-t pt-3">
          <p className="text-muted-foreground text-xs font-medium">New folder</p>
          <NewFolderForm
            orgId={orgId}
            submitLabel="Create and move"
            onCreated={(folder) => item && onMove(item, folder.id, folder.name)}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TrashView({
  trash,
  pending,
  onRestore,
  onEmpty,
}: {
  trash: { notes: TrashNote[]; files: TrashFile[] } | null;
  pending: boolean;
  onRestore: (kind: "note" | "file", id: string, name: string) => void;
  /** Set for whoever may empty it for good. */
  onEmpty?: () => void;
}) {
  const rows = [
    ...(trash?.notes ?? []).map((n) => ({
      kind: "note" as const,
      id: n.id,
      name: n.title || "Untitled note",
      detail: n.authorName,
      deletedAt: n.deletedAt,
      Icon: NotebookText,
    })),
    ...(trash?.files ?? []).map((f) => ({
      kind: "file" as const,
      id: f.id,
      name: f.name,
      detail: formatBytes(f.sizeBytes),
      deletedAt: f.deletedAt,
      Icon: FILE_ICONS[familyOf(f.contentType)],
    })),
  ].sort((a, b) => b.deletedAt.getTime() - a.deletedAt.getTime());

  return (
    <div className="space-y-3">
      {rows.length === 0 ? (
        <EmptyState
          title="Nothing here"
          description={`Deleted items stay ${NOTE_TRASH_DAYS} days.`}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-muted-foreground text-sm">Kept {NOTE_TRASH_DAYS} days.</p>
            {onEmpty && (
              <Button type="button" variant="outline" size="sm" onClick={onEmpty}>
                <Trash2 className="size-4" aria-hidden="true" />
                Empty trash
              </Button>
            )}
          </div>
          <ul className={cn("bg-card edge rounded-tile divide-y", pending && "opacity-70")}>
            {rows.map((r) => (
              <li key={`${r.kind}-${r.id}`} className="flex items-center gap-3 px-3 py-2.5">
                <r.Icon className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium break-words">{r.name}</p>
                  <p className="text-muted-foreground text-xs">
                    {r.detail}, deleted {formatDistanceToNow(r.deletedAt, { addSuffix: true })}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() => onRestore(r.kind, r.id, r.name)}
                >
                  <ArchiveRestore className="size-4" aria-hidden="true" />
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
