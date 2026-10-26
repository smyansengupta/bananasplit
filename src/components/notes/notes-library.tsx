"use client";

import { formatDistanceToNow } from "date-fns";
import {
  ArchiveRestore,
  CalendarDays,
  Check,
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
  MoreHorizontal,
  NotebookText,
  Pencil,
  Trash2,
  Users,
} from "@/components/icons";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";

import { deleteNote, restoreNote } from "@/app/app/[orgSlug]/notes/actions";
import {
  removeNoteFileAction,
  restoreNoteFileAction,
} from "@/app/app/[orgSlug]/notes/files-actions";
import {
  deleteFolderAction,
  moveToFolderAction,
  updateFolderAction,
} from "@/app/app/[orgSlug]/notes/folder-actions";
import { EmptyState } from "@/components/empty-state";
import { ItemMenu } from "@/components/item-menu";
import { FILE_ICONS, FILE_LABELS } from "@/components/notes/file-card";
import { NewFolderForm } from "@/components/notes/new-folder-form";
import { PinToggle } from "@/components/pins/pins-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { toast } from "@/components/ui/toaster";
import { familyOf, formatBytes } from "@/lib/files/types";
import { NOTE_TRASH_DAYS } from "@/lib/notes/trash";
import { cn } from "@/lib/utils";

import { FolderCard, folderTone, type FolderCardPeek } from "./folder-card";

const NOTE_MIME = "application/x-bananasplit-note";
const FILE_MIME = "application/x-bananasplit-file";

const COLORS = ["chart-1", "chart-2", "chart-3", "chart-4", "chart-5"] as const;

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

/** Grid or list, as icons only (the names are read out and shown on hover). */
const LAYOUTS = [
  { value: "grid", label: <span className="sr-only">Grid</span>, icon: LayoutGrid, title: "Grid" },
  { value: "list", label: <span className="sr-only">List</span>, icon: List, title: "List" },
];

/**
 * The Files library: folders down the side (drag a note or file onto one to
 * file it), and notes and uploaded files together in one list you can
 * search, filter, sort and see as a grid or a list. Cards show a preview of
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

  function dropOn(folderId: string | null, data: DataTransfer) {
    setOverFolder(null);
    const noteId = data.getData(NOTE_MIME);
    const fileId = data.getData(FILE_MIME);
    if (!noteId && !fileId) return;
    run(() =>
      moveToFolderAction(orgId, noteId ? { noteIds: [noteId] } : { fileIds: [fileId] }, folderId),
    );
  }

  const dropProps = (id: string | null) => ({
    onDragOver: (e: React.DragEvent) => {
      const types = Array.from(e.dataTransfer.types);
      if (!types.includes(NOTE_MIME) && !types.includes(FILE_MIME)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setOverFolder(id ?? "none");
    },
    onDragLeave: () => setOverFolder((f) => (f === (id ?? "none") ? null : f)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      dropOn(id, e.dataTransfer);
    },
  });

  function copyLink(href: string) {
    void navigator.clipboard
      ?.writeText(`${window.location.origin}${href}`)
      .then(() => toast({ title: "Link copied", tone: "success", duration: 3_000 }))
      .catch(() => toast({ title: "Couldn't copy the link", tone: "error" }));
  }

  /** Delete (to "Recently deleted"), with Undo. */
  async function remove(item: Item) {
    const isNote = item.kind === "note";
    const ok = await confirm({
      title: `Delete “${item.name}”?`,
      description: `It moves to Recently deleted for ${NOTE_TRASH_DAYS} days, so you can bring it back.`,
      confirmLabel: isNote ? "Delete note" : "Delete file",
      run: async () =>
        (isNote ? await deleteNote(orgId, item.id) : await removeNoteFileAction(orgId, item.id))
          .error,
    });
    if (!ok) return;
    router.refresh();
    toast({
      title: isNote ? "Note deleted" : "File deleted",
      description: item.name,
      action: {
        label: "Undo",
        run: async () => {
          const result = isNote
            ? await restoreNote(orgId, item.id)
            : await restoreNoteFileAction(orgId, item.id);
          if (result.error) return result.error;
          router.refresh();
        },
      },
    });
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
      toast({ title: `Restored “${name}”`, tone: "success" });
      router.refresh();
    });
  }

  /** Dropping a card on "Recently deleted" deletes it (after the usual question). */
  const trashDropProps = {
    onDragOver: (e: React.DragEvent) => {
      const types = Array.from(e.dataTransfer.types);
      if (!types.includes(NOTE_MIME) && !types.includes(FILE_MIME)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setOverTrash(true);
    },
    onDragLeave: () => setOverTrash(false),
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
          aria-current={active ? "true" : undefined}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2 px-2.5 py-1.5 text-left text-sm",
            active && "font-medium",
          )}
        >
          {icon}
          <span className="truncate">{label}</span>
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
              <Badge variant="secondary">Note</Badge>
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
              {personal ? null : n.visibility === "PRIVATE" ? (
                n.sharedWithMe || n.shareCount > 0 ? (
                  <Users
                    className="text-muted-foreground size-3 shrink-0"
                    aria-label={n.sharedWithMe ? "Shared with you" : "Shared with some people"}
                  />
                ) : (
                  <Lock className="text-muted-foreground size-3 shrink-0" aria-label="Only you" />
                )
              ) : null}
              <span className="truncate">{name}</span>
            </p>
            {view === "grid" && (
              <p className="text-muted-foreground line-clamp-2 min-h-[2.5em] text-[13px] leading-snug">
                {firstLine(n.snippet) || "Empty note"}
              </p>
            )}
            <p
              className={cn(
                "text-muted-foreground flex min-w-0 flex-wrap items-center gap-x-2 pe-16 text-xs",
                view === "list" && "ms-auto flex-nowrap",
              )}
            >
              <span className="truncate">
                {view === "list" ? "Note · " : ""}
                {n.authorName}, {formatDistanceToNow(n.updatedAt, { addSuffix: true })}
              </span>
              {!personal && (n.sharedWithMe || n.shareCount > 0 || n.memberCanEdit) && (
                <span className="truncate">
                  {n.sharedWithMe
                    ? "Shared with you"
                    : n.memberCanEdit
                      ? "Club can edit"
                      : `Shared with ${n.shareCount}`}
                </span>
              )}
              {n.eventTitle && (
                <span className="inline-flex items-center gap-1 truncate">
                  <CalendarDays className="size-3" aria-hidden="true" />
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
                <Badge variant="secondary" className="absolute bottom-2 left-3">
                  {FILE_LABELS[family]}
                </Badge>
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
                <Badge variant="secondary">{FILE_LABELS[family]}</Badge>
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
                <Lock className="text-muted-foreground size-3 shrink-0" aria-label="Only you" />
              )}
              <span className="truncate">{f.name}</span>
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
              {FILE_LABELS[family]} · {formatBytes(f.sizeBytes)} · {f.uploaderName},{" "}
              {formatDistanceToNow(f.createdAt, { addSuffix: true })}
            </p>
          </div>
        </Link>
        <div className={cardActions}>
          <PinToggle href={href} label={f.name} className={pinClass(href)} />
          <ItemMenu
            label={`Actions for ${f.name}`}
            className="rounded-lg"
            items={[
              {
                label: "Download",
                icon: Download,
                onSelect: () => downloadFrom(`${src}?download=1`),
              },
              { label: "Copy link", icon: Link2, onSelect: () => copyLink(href) },
              f.canMove && {
                label: "Move to folder…",
                icon: FolderInput,
                onSelect: () =>
                  setMoving({ kind: "file", id: f.id, name: f.name, folderId: f.folderId }),
              },
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

  /** What an empty list says; how folders and dragging work is told here, not under every list. */
  function emptyCopy(): { title: string; description: string; action?: React.ReactNode } {
    if (params.get("q")) {
      return {
        title: "Nothing matches that search",
        description: "Try fewer or different words.",
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
        description: "Clear them to see everything.",
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
      return {
        title: "No uploads here yet",
        description:
          "Upload PDFs, slides, spreadsheets and images with New › Upload a file. They open right here.",
      };
    }
    if (kind === "notes") {
      return {
        title: "No notes here yet",
        description:
          "Start one with New: blank, from a template, or from a Word document or Google Doc.",
      };
    }
    if (folder === "none")
      return { title: "Everything is in a folder", description: "Nothing is left unfiled." };
    if (folder) {
      return {
        title: "This folder is empty",
        description:
          "Drag notes and files onto it, or use New while it's open: what you make lands here.",
      };
    }
    return {
      title: "Nothing here yet",
      description: "Use New to write a note or upload a file.",
    };
  }

  return (
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
        <div className="space-y-0.5">
          <p
            className="eyebrow text-muted-foreground px-2.5 pb-1"
            title={
              personal
                ? undefined
                : "Folders are shared with the club; private notes stay private inside them."
            }
          >
            Folders
          </p>
          {folders.map((f) =>
            renaming?.id === f.id ? (
              <form
                key={f.id}
                className="px-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  const name = renaming.name;
                  setRenaming(null);
                  run(() => updateFolderAction(orgId, f.id, { name }));
                }}
              >
                <Input
                  autoFocus
                  value={renaming.name}
                  maxLength={80}
                  onChange={(e) => setRenaming({ id: f.id, name: e.target.value })}
                  onBlur={() => setRenaming(null)}
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
                  {f.canEdit ? (
                    // Not an ItemMenu: the colour swatches sit inside the menu.
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`${f.name} options`}
                          className="text-muted-foreground me-0.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 pointer-coarse:opacity-100"
                        >
                          <MoreHorizontal className="size-4" aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setRenaming({ id: f.id, name: f.name })}>
                          <Pencil className="size-4" aria-hidden="true" />
                          Rename
                        </DropdownMenuItem>
                        <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
                          Colour
                        </DropdownMenuLabel>
                        <div className="flex gap-1.5 px-2 pb-2">
                          {[null, ...COLORS].map((c) => (
                            <button
                              key={c ?? "none"}
                              type="button"
                              aria-label={
                                c ? `Colour ${c.replace("chart-", "")}` : "Match the theme"
                              }
                              aria-pressed={f.color === c}
                              onClick={() =>
                                run(() => updateFolderAction(orgId, f.id, { color: c }))
                              }
                              className="grid size-5 place-items-center rounded-md border"
                              style={{ background: folderTone(c) }}
                            >
                              {f.color === c && (
                                <Check className="text-background size-3" aria-hidden="true" />
                              )}
                            </button>
                          ))}
                        </div>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={async () => {
                            const ok = await confirm({
                              title: `Delete the folder “${f.name}”?`,
                              description: "Its notes and files stay, just out of the folder.",
                              confirmLabel: "Delete folder",
                              run: async () => {
                                const result = await deleteFolderAction(orgId, f.id);
                                return result.ok ? undefined : result.error;
                              },
                            });
                            if (!ok) return;
                            if (folder === f.id) go({ folder: null });
                            router.refresh();
                            toast({
                              title: `Folder “${f.name}” deleted`,
                              description: "Everything in it is under Not in a folder.",
                            });
                          }}
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                          Delete folder
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </>,
              )
            ),
          )}
          {folders.length === 0 && (
            <p className="text-muted-foreground px-2.5 text-xs">
              No folders yet. Make one with New › New folder, then drag cards onto it.
            </p>
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
          leading={
            <Segmented
              label="Layout"
              options={LAYOUTS}
              value={view}
              onSelect={(v) => go({ layout: v === "grid" ? null : v })}
              className="[&>button]:gap-0 [&>button]:px-2"
            />
          }
          filterCount={
            (folder ? 1 : 0) +
            ["tab", "visibility", "author"].filter((k) => params.get(k) && params.get(k) !== "all")
              .length
          }
          onFilters={() => setFiltersOpen(true)}
          searchLabel="Search files"
          searchActive={Boolean(params.get("q"))}
          search={
            <form
              role="search"
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
                placeholder="Search files"
                aria-label="Search files"
                autoFocus
              />
            </form>
          }
          onCancelSearch={() => {
            setQ("");
            if (params.get("q")) go({ q: null });
          }}
        />
        <FilterSheet
          open={filtersOpen}
          onOpenChange={setFiltersOpen}
          title="Filter files"
          description="The library shows only what matches."
          canClear={Boolean(
            folder || ["tab", "visibility", "author", "sort"].some((k) => params.get(k)),
          )}
          onClear={() =>
            go({ folder: null, tab: null, visibility: null, author: null, sort: null })
          }
        >
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
        {/* On a phone, which folder you're in (Everything says nothing). */}
        {(folder || error) && (
          <div className="space-y-1 md:hidden">
            {folder && <h2 className="heading truncate text-lg">{heading}</h2>}
            {error && <p className="text-destructive text-xs">{error}</p>}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 max-md:hidden">
          <h2 className="heading mr-auto flex min-w-0 items-center gap-2 text-lg">
            {currentFolder ? (
              <FolderOpen
                className="size-5 shrink-0"
                style={{ color: folderDot(currentFolder.color) }}
                aria-hidden="true"
              />
            ) : null}
            <span className="truncate">{heading}</span>
          </h2>
          {!inTrash && (
            <>
              <form
                role="search"
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
                  placeholder="Search files"
                  aria-label="Search files"
                />
              </form>
              {filters}
              <Segmented
                label="Layout"
                options={LAYOUTS}
                value={view}
                onSelect={(v) => go({ layout: v === "grid" ? null : v })}
                className="[&>button]:gap-0 [&>button]:px-2"
              />
            </>
          )}
        </div>

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
          <TrashView trash={trash} pending={pending} onRestore={restore} />
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
      {confirmEl}
      <MoveDialog
        orgId={orgId}
        item={moving}
        folders={folders}
        onClose={() => setMoving(null)}
        onMove={(item, folderId, newName) => {
          setMoving(null);
          run(() =>
            moveToFolderAction(
              orgId,
              item.kind === "note" ? { noteIds: [item.id] } : { fileIds: [item.id] },
              folderId,
            ),
          );
          const name = folderId
            ? (newName ?? folders.find((f) => f.id === folderId)?.name ?? "the folder")
            : "Not in a folder";
          toast({ title: `Moved to ${name}`, description: item.name, duration: 4_000 });
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
          <DialogDescription className="truncate">{item?.name}</DialogDescription>
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
                  <span className="truncate">{c.name}</span>
                  {current && (
                    <span className="text-muted-foreground ms-auto text-xs">Here now</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="space-y-1.5 border-t pt-3">
          <p className="text-muted-foreground text-xs font-medium">
            {folders.length === 0
              ? "No folders yet. Make one and move it there:"
              : "Or into a new folder:"}
          </p>
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
}: {
  trash: { notes: TrashNote[]; files: TrashFile[] } | null;
  pending: boolean;
  onRestore: (kind: "note" | "file", id: string, name: string) => void;
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
          description={`When you delete a note or a file, it waits here for ${NOTE_TRASH_DAYS} days in case you change your mind.`}
        />
      ) : (
        <>
          <p className="text-muted-foreground text-sm">
            Notes and files deleted in the last {NOTE_TRASH_DAYS} days. Restore puts them back where
            they were; after {NOTE_TRASH_DAYS} days deleted files are gone for good.
          </p>
          <ul className={cn("bg-card edge rounded-tile divide-y", pending && "opacity-70")}>
            {rows.map((r) => (
              <li key={`${r.kind}-${r.id}`} className="flex items-center gap-3 px-3 py-2.5">
                <r.Icon className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{r.name}</p>
                  <p className="text-muted-foreground truncate text-xs">
                    {r.kind === "note" ? "Note" : "File"} · {r.detail} · deleted{" "}
                    {formatDistanceToNow(r.deletedAt, { addSuffix: true })}
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
